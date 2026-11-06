import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngineClient, type WorkerLike } from './engineClient';
import { SIGNAL_FAMILIES, type TrainResult } from './engine';
import { seedStorageForTest } from '../lib/storage';
import { ServerUnavailableError, type ServerJob, type ServerJobs, type ServerJobSummary } from '../lib/serverJobs';
import { highlights, synth } from './engine/synthetic';
import type { Reply, Request } from './protocol';
import type { FindInputs } from './run';
import type { SweepInput, SweepLoad, SweepResult } from './sweep/types';

const inputs: FindInputs = {
  direction: 'long',
  families: ['donchian'],
  risk: { feeBps: 10, slippageBps: 5, stopLossPct: null, takeProfitPct: null },
  targets: {},
};

class StubWorker implements WorkerLike {
  sent: Request[] = [];
  terminated = false;
  onmessage: ((ev: { data: Reply }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  postMessage(m: Request): void {
    this.sent.push(m);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(r: Reply): void {
    this.onmessage?.({ data: r });
  }
}

afterEach(() => vi.useRealTimers());

describe('without a Worker (the page runs the engine)', () => {
  const candles = synth(4000, 7);
  const trades = highlights(candles, 3);

  it('finds a strategy, reporting progress in order and saying it runs on the page', async () => {
    const client = createEngineClient({ makeWorker: () => null });
    const seen: Array<[number, string, boolean]> = [];
    const out = await client.find([{ candles, trades }], inputs, { onProgress: (p, s, page) => seen.push([p, s, page]) });
    expect(out.kind).toBe('ok');
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.map((x) => x[0])).toEqual([...seen.map((x) => x[0])].sort((a, b) => a - b));
    expect(seen.every((x) => x[2])).toBe(true);
    expect(seen[0][1]).toBe('Training');
    const t = await client.trades(candles, { strategyId: 'sma_cross', params: { fast: 8, slow: 34, direction: 1 } }, inputs);
    expect(t.length).toBeGreaterThan(5);
    client.dispose();
  }, 60_000);

  it('cancel rejects with an AbortError and stops reporting progress', async () => {
    const client = createEngineClient({ makeWorker: () => null });
    const ctl = new AbortController();
    const seen: number[] = [];
    const run = client.find([{ candles, trades }], { ...inputs, families: [...SIGNAL_FAMILIES] }, {
      signal: ctl.signal,
      onProgress: (p) => {
        seen.push(p);
        if (seen.length === 2) ctl.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    const n = seen.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(seen.length).toBe(n);
    client.dispose();
  }, 60_000);

  it('a signal that is already aborted rejects at once', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(createEngineClient({ makeWorker: () => null }).find([], inputs, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('train', () => {
  const series = [{ candles: [], trades: [] }];

  it('on the page, trains alone and reports a Training stage only', async () => {
    const candles = synth(4000, 7);
    const client = createEngineClient({ makeWorker: () => null });
    const stages = new Set<string>();
    const out = await client.train([{ candles, trades: highlights(candles, 3) }], { onProgress: (_p, s) => stages.add(s) });
    expect(out.kind).toBe('trained');
    expect([...stages]).toEqual(['Training']);
    client.dispose();
  }, 60_000);

  it('on the page, cancel rejects with an AbortError', async () => {
    const candles = synth(4000, 7);
    const client = createEngineClient({ makeWorker: () => null });
    const ctl = new AbortController();
    const run = client.train([{ candles, trades: highlights(candles, 3) }], { signal: ctl.signal, onProgress: () => ctl.abort() });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    client.dispose();
  }, 60_000);

  it('sends a train request, and its cancel, to the worker', async () => {
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const ok = client.train(series);
    expect(w.sent[0]).toMatchObject({ v: 1, type: 'train', series });
    w.reply({ v: 1, id: w.sent[0].id, type: 'result', outcome: { kind: 'too-few', have: 0, need: 30 } });
    await expect(ok).resolves.toEqual({ kind: 'too-few', have: 0, need: 30 });
    const ctl = new AbortController();
    const run = client.train(series, { signal: ctl.signal });
    const id = w.sent[1].id;
    ctl.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.sent[2]).toEqual({ v: 1, id, type: 'cancel' });
  });

  it('a find carries the model it is given, and none otherwise', () => {
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const model = { kind: 'ok' } as never;
    void client.find(series, inputs, { model }).catch(() => undefined);
    void client.find(series, inputs).catch(() => undefined);
    expect(w.sent.filter((m) => m.type === 'find').map((m) => 'model' in m)).toEqual([true, false]);
    expect(w.sent[0]).toMatchObject({ model });
  });
});

describe('with a worker', () => {
  const series = [{ candles: [], trades: [] }];

  it('sends a versioned find request, forwards progress and resolves the result', async () => {
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const got: Array<[number, string, boolean]> = [];
    const run = client.find(series, inputs, { onProgress: (p, s, page) => got.push([p, s, page]) });
    expect(w.sent).toHaveLength(1);
    const req = w.sent[0];
    expect(req).toMatchObject({ v: 1, type: 'find', inputs });
    w.reply({ v: 1, id: req.id, type: 'progress', pct: 0.5, stage: 'Training' });
    w.reply({ v: 1, id: req.id, type: 'progress', pct: 0.3, stage: 'Training' });
    w.reply({ v: 1, id: req.id, type: 'result', outcome: { kind: 'too-few', have: 1, need: 30 } });
    await expect(run).resolves.toEqual({ kind: 'too-few', have: 1, need: 30 });
    expect(got).toEqual([
      [0.5, 'Training', false],
      [0.5, 'Training', false],
    ]);
  });

  it('cancel rejects with an AbortError, posts a cancel and ignores later progress for that id', async () => {
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const ctl = new AbortController();
    const onProgress = vi.fn();
    const run = client.find(series, inputs, { signal: ctl.signal, onProgress });
    const id = w.sent[0].id;
    ctl.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.sent[1]).toEqual({ v: 1, id, type: 'cancel' });
    w.reply({ v: 1, id, type: 'progress', pct: 0.9, stage: 'Searching' });
    w.reply({ v: 1, id, type: 'result', outcome: { kind: 'refused', reason: 'late' } });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('a new find cancels the previous one', async () => {
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const first = client.find(series, inputs);
    const second = client.find(series, inputs);
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.sent.map((m) => m.type)).toEqual(['find', 'cancel', 'find']);
    w.reply({ v: 1, id: w.sent[2].id, type: 'result', outcome: { kind: 'refused', reason: 'x' } });
    await expect(second).resolves.toEqual({ kind: 'refused', reason: 'x' });
  });

  it('ends and replaces a worker that does not answer a cancel within one second', async () => {
    vi.useFakeTimers();
    const made: StubWorker[] = [];
    const client = createEngineClient({ makeWorker: () => (made.push(new StubWorker()), made[made.length - 1]) });
    const ctl = new AbortController();
    const run = client.find(series, inputs, { signal: ctl.signal });
    const settled = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    ctl.abort();
    await settled;
    vi.advanceTimersByTime(999);
    expect(made[0].terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(made[0].terminated).toBe(true);
    void client.find(series, inputs).catch(() => undefined);
    expect(made).toHaveLength(2);
    expect(made[1].sent[0]).toMatchObject({ type: 'find' });
  });

  it('a find started right after a cancel runs on the replacement worker', async () => {
    vi.useFakeTimers();
    const made: StubWorker[] = [];
    const client = createEngineClient({ makeWorker: () => (made.push(new StubWorker()), made[made.length - 1]) });
    const ctl = new AbortController();
    const a = client.find(series, inputs, { signal: ctl.signal });
    const aSettled = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    ctl.abort();
    await aSettled;
    const b = client.find(series, inputs);
    vi.advanceTimersByTime(1000);
    expect(made[0].terminated).toBe(true);
    expect(made).toHaveLength(2);
    const req = made[1].sent[0];
    expect(req).toMatchObject({ type: 'find' });
    made[1].reply({ v: 1, id: req.id, type: 'result', outcome: { kind: 'refused', reason: 'x' } });
    await expect(b).resolves.toEqual({ kind: 'refused', reason: 'x' });
  });

  it('keeps a worker that answers the cancel', async () => {
    vi.useFakeTimers();
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const ctl = new AbortController();
    const run = client.find(series, inputs, { signal: ctl.signal });
    const settled = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    ctl.abort();
    await settled;
    w.reply({ v: 1, id: w.sent[0].id, type: 'error', message: 'Cancelled', cancelled: true });
    vi.advanceTimersByTime(5000);
    expect(w.terminated).toBe(false);
  });

  it('runs the same request on the page when the worker crashes', async () => {
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const candles = synth(4000, 7);
    const run = client.find([{ candles, trades: highlights(candles, 3) }], inputs, { onProgress: () => undefined });
    w.onerror?.(new Event('error'));
    expect(w.terminated).toBe(true);
    await expect(run).resolves.toMatchObject({ kind: 'ok' });
    client.dispose();
  }, 60_000);

  it('a worker error reply rejects with its message', async () => {
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const run = client.find(series, inputs);
    w.reply({ v: 1, id: w.sent[0].id, type: 'error', message: 'boom' });
    await expect(run).rejects.toThrow('boom');
  });
});

describe('sweep', () => {
  const sweepInput: SweepInput = {
    markets: [{ provider: 'test', symbol: 'AAA' }, { provider: 'test', symbol: 'BBB' }],
    timeframes: ['1d'],
    families: ['sma_cross'],
    direction: 'long',
    targetSets: [{ minHitRatePct: 0 }],
    risk: { initialCapital: 1000, riskPct: 2, feeBps: 10, slippageBps: 5 },
    exits: { stopMults: [1, 2], tpMults: [1, 2] },
    space: {
      sma_cross: [
        { key: 'fast', from: 8, to: 8, step: 1 },
        { key: 'slow', from: 34, to: 34, step: 1 },
      ],
    },
  };
  const empty: SweepResult = { candidates: [], closest: [], skipped: [], tried: 0, met: 0, held: 0 };

  it('on the page, reports progress in order and resolves a result', async () => {
    const candles = synth(4000, 7);
    const load: SweepLoad = async () => candles;
    const client = createEngineClient({ makeWorker: () => null, load });
    const seen: Array<[number, boolean]> = [];
    const out = await client.sweep(sweepInput, { onProgress: (p, page) => seen.push([p.pct, page]) });
    expect(out.tried).toBe(8);
    expect(out.held).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.map((x) => x[0])).toEqual([...seen.map((x) => x[0])].sort((a, b) => a - b));
    expect(seen.every((x) => x[1])).toBe(true);
    client.dispose();
  });

  it('on the page, a cancel during the load rejects with an AbortError within a second', async () => {
    const load: SweepLoad = (_m, _t, signal) =>
      new Promise((_r, reject) => signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))));
    const client = createEngineClient({ makeWorker: () => null, load });
    const ctl = new AbortController();
    const t = Date.now();
    const run = client.sweep(sweepInput, { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 10);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - t).toBeLessThan(1000);
    client.dispose();
  });

  it('on the page, an over-budget run rejects with the count and never loads', async () => {
    const load = vi.fn<SweepLoad>();
    const client = createEngineClient({ makeWorker: () => null, load });
    const markets = Array.from({ length: 500 }, (_, i) => ({ provider: 'p', symbol: `S${i}` }));
    await expect(client.sweep({ ...sweepInput, markets, space: undefined, families: ['macd_cross', 'sma_cross', 'ema_cross'], timeframes: ['1d', '1w'] })).rejects.toThrow(/combinations; the limit is/);
    expect(load).not.toHaveBeenCalled();
  });

  it('through a worker, sends a sweep, forwards progress in order and resolves the result', async () => {
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const got: Array<[number, string, boolean]> = [];
    const run = client.sweep(sweepInput, { onProgress: (p, page) => got.push([p.pct, p.label, page]) });
    const req = w.sent[0];
    expect(req).toMatchObject({ v: 1, type: 'sweep', input: sweepInput });
    w.reply({ v: 1, id: req.id, type: 'sweep-progress', progress: { pct: 0.5, label: 'AAA 1d' } });
    w.reply({ v: 1, id: req.id, type: 'sweep-progress', progress: { pct: 0.3, label: 'AAA 1d' } });
    w.reply({ v: 1, id: req.id, type: 'sweep-result', result: empty });
    await expect(run).resolves.toEqual(empty);
    expect(got).toEqual([
      [0.5, 'AAA 1d', false],
      [0.5, 'AAA 1d', false],
    ]);
  });

  it('through a worker, a cancel rejects with an AbortError and posts a cancel', async () => {
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const ctl = new AbortController();
    const onProgress = vi.fn();
    const run = client.sweep(sweepInput, { signal: ctl.signal, onProgress });
    const id = w.sent[0].id;
    ctl.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.sent[1]).toEqual({ v: 1, id, type: 'cancel' });
    w.reply({ v: 1, id, type: 'sweep-progress', progress: { pct: 0.9, label: 'x' } });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('a new find stops a sweep', async () => {
    const w = new StubWorker();
    const client = createEngineClient({ makeWorker: () => w });
    const sweep = client.sweep(sweepInput);
    void client.find([{ candles: [], trades: [] }], inputs).catch(() => undefined);
    await expect(sweep).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.sent.map((m) => m.type)).toEqual(['sweep', 'cancel', 'find']);
  });
});

describe('on the server', () => {
  type Sum = ServerJobSummary;
  const summary = (id: string, state: Sum['state'], extra: Partial<Sum> = {}): Sum => ({
    id,
    kind: 'find',
    scope: 'strategy-maker',
    state,
    progress: 0,
    created: 1,
    ...extra,
  });

  /** A jobs API that records its calls and lets the test push summaries to the followers. */
  function fakeJobs(opts: { startError?: Error } = {}) {
    const started: Array<{ kind: string; request: unknown; scope: string; placement: unknown }> = [];
    const cancelled: string[] = [];
    const followers = new Map<string, (s: Sum) => void>();
    const stopped: string[] = [];
    const results = new Map<string, ServerJob>();
    let n = 0;
    const jobs: ServerJobs = {
      async startJob(kind, request, scope, placement) {
        if (opts.startError) throw opts.startError;
        started.push({ kind, request, scope, placement });
        return summary(`job${++n}`, 'queued', { kind });
      },
      followJob(id, fn) {
        followers.set(id, fn);
        return () => void stopped.push(id);
      },
      async getJob(id) {
        return results.get(id) ?? null;
      },
      async cancelJob(id) {
        cancelled.push(id);
      },
      async listJobs() {
        return [];
      },
    };
    return {
      jobs,
      started,
      cancelled,
      stopped,
      push: (s: Sum, result?: unknown) => {
        if (result !== undefined) results.set(s.id, { ...s, result });
        followers.get(s.id)?.(s);
      },
      setResult: (s: Sum, result: unknown) => results.set(s.id, { ...s, result }),
    };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const okOutcome = { kind: 'refused', reason: 'x' } as const;
  const server = (jobs: ServerJobs, worker = new StubWorker()) => ({
    worker,
    client: createEngineClient({ makeWorker: () => worker, place: () => 'server', jobs }),
  });

  it('starts a find, train and sweep job with the request and the strategy-maker scope, and posts nothing to the worker', async () => {
    const f = fakeJobs();
    const { client, worker } = server(f.jobs);
    const series = [{ candles: [], trades: [] }];
    void client.find(series, inputs).catch(() => undefined);
    await tick();
    void client.train(series).catch(() => undefined);
    await tick();
    const input = { markets: [] } as unknown as SweepInput;
    void client.sweep(input).catch(() => undefined);
    await tick();
    expect(f.started.map((s) => [s.kind, s.scope, s.placement])).toEqual([
      ['find', 'strategy-maker', { where: 'server', reason: 'setting' }],
      ['train', 'strategy-maker', { where: 'server', reason: 'setting' }],
      ['sweep', 'strategy-maker', { where: 'server', reason: 'setting' }],
    ]);
    expect(f.started[0].request).toEqual({ series, inputs });
    expect(f.started[1].request).toEqual({ series });
    expect(f.started[2].request).toEqual({ input });
    expect(worker.sent).toEqual([]);
    client.dispose();
  });

  it('sends the model of a find that reuses one', async () => {
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const model = { kind: 'ok' } as unknown as TrainResult;
    void client.find([], inputs, { model }).catch(() => undefined);
    await tick();
    expect(f.started[0].request).toEqual({ series: [], inputs, model });
    client.dispose();
  });

  it('trades still goes to the worker', async () => {
    const f = fakeJobs();
    const { client, worker } = server(f.jobs);
    void client.trades([], { strategyId: 's', params: {} }, inputs).catch(() => undefined);
    expect(worker.sent.map((m) => m.type)).toEqual(['trades']);
    expect(f.started).toEqual([]);
    client.dispose();
  });

  it('reports progress without decreasing, with the stage, on the server, and resolves with the outcome', async () => {
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const seen: Array<[number, string, boolean]> = [];
    const run = client.find([], inputs, { onProgress: (p, s, page) => seen.push([p, s, page]) });
    await tick();
    f.push(summary('job1', 'running', { progress: 0.4, stage: 'Searching' }));
    f.push(summary('job1', 'running', { progress: 0.2, stage: 'Validating' }));
    f.push(summary('job1', 'running', { progress: 0.5 }));
    f.push(summary('job1', 'done', { progress: 1 }), { type: 'result', outcome: okOutcome });
    await expect(run).resolves.toEqual(okOutcome);
    expect(seen).toEqual([
      [0.4, 'Searching', false],
      [0.4, 'Validating', false],
      [0.5, 'Validating', false],
    ]);
    expect(f.stopped).toEqual(['job1']);
  });

  it('a sweep reports its stage as the label and resolves with the result', async () => {
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const seen: Array<[number, string, boolean]> = [];
    const run = client.sweep({} as SweepInput, { onProgress: (p, page) => seen.push([p.pct, p.label, page]) });
    await tick();
    f.push(summary('job1', 'running', { progress: 0.3, stage: 'BTC 1h' }));
    f.push(summary('job1', 'running', { progress: 0.1 }));
    const result = { rows: [] } as unknown as SweepResult;
    f.push(summary('job1', 'done', { progress: 1 }), { type: 'sweep-result', result });
    await expect(run).resolves.toBe(result);
    expect(seen).toEqual([
      [0.3, 'BTC 1h', false],
      [0.3, '', false],
    ]);
  });

  it('a train resolves with its outcome', async () => {
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const run = client.train([]);
    await tick();
    f.push(summary('job1', 'done'), { type: 'result', outcome: { kind: 'too-few', have: 1, need: 5 } });
    await expect(run).resolves.toEqual({ kind: 'too-few', have: 1, need: 5 });
  });

  it('rejects with the server error on failed, the restart on interrupted, and an AbortError on cancelled', async () => {
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const a = client.find([], inputs);
    await tick();
    f.push(summary('job1', 'failed', { error: 'boom' }));
    await expect(a).rejects.toThrow('boom');
    const b = client.find([], inputs);
    await tick();
    f.push(summary('job2', 'interrupted'));
    await expect(b).rejects.toThrow('stopped: the server restarted');
    const c = client.find([], inputs);
    await tick();
    f.push(summary('job3', 'cancelled'));
    await expect(c).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.cancelled).toEqual([]);
  });

  it('aborting rejects at once, without a timer, and cancels the job once', async () => {
    vi.useFakeTimers();
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const ctl = new AbortController();
    const run = client.find([], inputs, { signal: ctl.signal });
    const caught = run.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(0);
    ctl.abort();
    ctl.abort();
    expect(await caught).toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
    expect(f.cancelled).toEqual(['job1']);
    expect(f.stopped).toEqual(['job1']);
  });

  it('an abort before the server has answered cancels the job when it is accepted', async () => {
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const ctl = new AbortController();
    const run = client.find([], inputs, { signal: ctl.signal });
    ctl.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await tick();
    expect(f.cancelled).toEqual(['job1']);
  });

  it('a newer run cancels the server job', async () => {
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const first = client.find([], inputs);
    const caught = first.catch((e: Error) => e);
    await tick();
    void client.train([]).catch(() => undefined);
    expect(await caught).toMatchObject({ name: 'AbortError' });
    await tick();
    expect(f.cancelled).toEqual(['job1']);
    expect(f.started.map((s) => s.kind)).toEqual(['find', 'train']);
    client.dispose();
  });

  it('dispose lets go of the job without cancelling it', async () => {
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const run = client.find([], inputs);
    const caught = run.catch((e: Error) => e);
    await tick();
    client.dispose();
    expect(await caught).toMatchObject({ name: 'AbortError' });
    expect(f.cancelled).toEqual([]);
    expect(f.stopped).toEqual(['job1']);
  });

  it('reports the job id once the server has it', async () => {
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const ids: string[] = [];
    void client.find([], inputs, { onServerJob: (id) => ids.push(id) }).catch(() => undefined);
    await tick();
    expect(ids).toEqual(['job1']);
    client.dispose();
  });

  it('runs on the worker and says why when the server cannot take the job', async () => {
    const f = fakeJobs({ startError: new ServerUnavailableError('the server cannot be reached') });
    const { client, worker } = server(f.jobs);
    const reasons: string[] = [];
    const run = client.find([{ candles: [], trades: [] }], inputs, { onFallback: (r) => reasons.push(r) });
    await tick();
    expect(reasons).toEqual(['the server cannot be reached']);
    expect(worker.sent.map((m) => m.type)).toEqual(['find']);
    worker.reply({ v: 1, id: worker.sent[0].id, type: 'result', outcome: okOutcome });
    await expect(run).resolves.toEqual(okOutcome);
  });

  it('resume follows a running job to its result, with progress', async () => {
    const f = fakeJobs();
    const { client, worker } = server(f.jobs);
    const seen: number[] = [];
    const run = client.resume('find', 'job9', { onProgress: (p) => seen.push(p) });
    await tick();
    f.push(summary('job9', 'running', { progress: 0.6, stage: 'Searching' }));
    f.push(summary('job9', 'done'), { type: 'result', outcome: okOutcome });
    await expect(run).resolves.toEqual(okOutcome);
    expect(seen).toEqual([0.6]);
    expect(f.started).toEqual([]);
    expect(worker.sent).toEqual([]);
  });

  it('resume of a finished job resolves at once, and can be cancelled like a fresh run', async () => {
    const f = fakeJobs();
    const { client } = server(f.jobs);
    const done = summary('job9', 'done');
    f.setResult(done, { type: 'sweep-result', result: { rows: [] } });
    const run = client.resume('sweep', 'job9');
    await tick();
    f.push(done);
    await expect(run).resolves.toEqual({ rows: [] });
    const ctl = new AbortController();
    const again = client.resume('find', 'job8', { signal: ctl.signal });
    await tick();
    ctl.abort();
    await expect(again).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.cancelled).toEqual(['job8']);
  });

  it('with the browser chosen, no job is started', async () => {
    const f = fakeJobs();
    const worker = new StubWorker();
    const client = createEngineClient({ makeWorker: () => worker, place: () => 'browser', jobs: f.jobs });
    const run = client.find([], inputs);
    worker.reply({ v: 1, id: worker.sent[0].id, type: 'result', outcome: okOutcome });
    await run;
    void client.sweep({} as SweepInput).catch(() => undefined);
    expect(f.started).toEqual([]);
    client.dispose();
  });

  it('reads the Settings choice at the start of each run by default', async () => {
    const f = fakeJobs();
    const worker = new StubWorker();
    const client = createEngineClient({ makeWorker: () => worker, jobs: f.jobs });
    void client.find([], inputs).catch(() => undefined);
    await tick();
    expect(f.started).toEqual([]);
    expect(worker.sent.map((m) => m.type)).toEqual(['find']);
    seedStorageForTest({ 'prefs.v1': { jobPlace: 'server' } });
    void client.find([], inputs).catch(() => undefined);
    await tick();
    expect(f.started.map((x) => x.kind)).toEqual(['find']);
    client.dispose();
    seedStorageForTest();
  });
});
