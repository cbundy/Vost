import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngineClient, type WorkerLike } from './engineClient';
import { SIGNAL_FAMILIES } from './engine';
import { highlights, synth } from './engine/synthetic';
import type { Reply, Request } from './protocol';
import type { FindInputs } from './run';

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
