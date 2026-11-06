import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocStore } from '../settings/store.ts';
import { createJobs, KEEP_FINISHED, type JobSummary, type Jobs } from './jobs.ts';
import { UNAVAILABLE } from './pool.ts';

interface Call {
  request: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  isFinal: (m: unknown) => boolean;
  onMessage?: (m: unknown) => void;
  resolve: (m: unknown) => void;
  reject: (e: Error) => void;
  cancelled: boolean;
}

function fakePool(size: number) {
  const calls: Call[] = [];
  return {
    calls,
    size,
    close: () => undefined,
    run(request: unknown, isFinal: (m: unknown) => boolean, onMessage?: (m: unknown) => void) {
      const call = { request, isFinal, onMessage, cancelled: false } as Call;
      const done = new Promise<unknown>((resolve, reject) => {
        call.resolve = resolve;
        call.reject = reject;
      });
      calls.push(call);
      return {
        done,
        cancel() {
          call.cancelled = true;
          call.reject(new Error('Cancelled'));
        },
      };
    },
  };
}

let dir = '';
let logs: string[] = [];
let clock = 1000;
let seq = 0;
let pool: ReturnType<typeof fakePool>;

const flush = () => new Promise((r) => setTimeout(r, 20));
const config = { strategyId: 'sma_cross', params: {} };
const btInput = (extra: Record<string, unknown> = {}) => ({ kind: 'run', scope: 'chart:1', request: { candles: [{ time: 1 }], config, ...extra } });
const files = async () => (await readdir(path.join(dir, 'jobs')).catch(() => [])).filter((f) => f.endsWith('.json')).sort();

async function make(size = 1, opts: { bundle?: boolean } = {}): Promise<Jobs> {
  pool = fakePool(size);
  const store = createDocStore({ dir: path.join(dir, 'jobs'), log: (l) => logs.push(l), now: () => 5 });
  const jobs = createJobs({ store, pool, bundleExists: () => opts.bundle ?? true, now: () => clock, newId: () => `job-${++seq}`, log: (l) => logs.push(l) });
  await jobs.start();
  return jobs;
}
async function create(jobs: Jobs, input: Record<string, unknown> = btInput()): Promise<JobSummary> {
  const r = await jobs.create(input as never);
  if (!r.ok) throw new Error(r.error);
  return r.summary;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-jobs-'));
  logs = [];
  clock = 1000;
  seq = 0;
});
afterEach(async () => {
  await flush(); // let the manager's background record writes land before the folder goes
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

describe('job manager', () => {
  it('runs queued -> running -> done, stores the result and never the request', async () => {
    const jobs = await make(1);
    const events: JobSummary[] = [];
    jobs.subscribe((s) => events.push(s));
    const made = await create(jobs);
    expect(made).toMatchObject({ id: 'job-1', state: 'queued', progress: 0, created: 1000, scope: 'chart:1' });
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].request).toEqual({ proto: 'backtest', msg: { candles: [{ time: 1 }], config, id: 'job-1', type: 'run' } });
    expect(jobs.list()[0]).toMatchObject({ state: 'running', started: 1000 });
    clock = 1500;
    pool.calls[0].resolve({ proto: 'backtest', msg: { id: 'job-1', type: 'result', metrics: { a: 1 } } });
    await flush();
    const got = await jobs.get('job-1');
    expect(got).toMatchObject({ state: 'done', progress: 1, finished: 1500, result: { type: 'result', metrics: { a: 1 } } });
    expect(events.map((e) => e.state)).toEqual(['queued', 'running', 'done']);
    const text = await readFile(path.join(dir, 'jobs', 'job-1.json'), 'utf8');
    expect(text).not.toContain('candles');
    expect(JSON.parse(text).summary.state).toBe('done');
    expect(logs.some((l) => l === '[jobs] job-1 run done in 500 ms (queued 0 ms)')).toBe(true);
  });

  it('keeps jobs beyond pool.size queued and starts them in order', async () => {
    const jobs = await make(1);
    await create(jobs);
    await create(jobs);
    await create(jobs);
    expect(pool.calls).toHaveLength(1);
    expect(jobs.list().map((s) => s.state).sort()).toEqual(['queued', 'queued', 'running']);
    pool.calls[0].resolve({ proto: 'backtest', msg: { type: 'result' } });
    await flush();
    expect(pool.calls).toHaveLength(2);
    expect(pool.calls[1].request.msg.id).toBe('job-2');
    pool.calls[1].resolve({ proto: 'backtest', msg: { type: 'result' } });
    await flush();
    expect(pool.calls[2].request.msg.id).toBe('job-3');
  });

  it('progress updates the summary but writes the record on state changes only', async () => {
    const jobs = await make(1);
    await create(jobs);
    await flush();
    const file = path.join(dir, 'jobs', 'job-1.json');
    const before = await readFile(file, 'utf8');
    pool.calls[0].onMessage!({ proto: 'backtest', msg: { id: 'job-1', type: 'progress', pct: 0.4, stage: 'Running' } });
    expect(jobs.list()[0]).toMatchObject({ progress: 0.4, stage: 'Running' });
    pool.calls[0].onMessage!({ proto: 'maker', msg: { v: 1, id: 'job-1', type: 'sweep-progress', progress: { pct: 0.6, label: 'Sweep' } } });
    expect(jobs.list()[0]).toMatchObject({ progress: 0.6, stage: 'Sweep' });
    await flush();
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('throttles progress events to one per 250 ms per job, and always sends state changes', async () => {
    const jobs = await make(1);
    const events: JobSummary[] = [];
    jobs.subscribe((s) => events.push(s));
    await create(jobs);
    const n = () => events.length;
    const base = n(); // queued, running
    const prog = (pct: number) => pool.calls[0].onMessage!({ proto: 'backtest', msg: { type: 'progress', pct } });
    prog(0.1);
    expect(n()).toBe(base); // right after the running event
    clock += 100;
    prog(0.2);
    expect(n()).toBe(base);
    clock += 150;
    prog(0.3);
    expect(n()).toBe(base + 1);
    clock += 10;
    prog(0.4);
    expect(n()).toBe(base + 1);
    pool.calls[0].resolve({ proto: 'backtest', msg: { type: 'result' } });
    await flush();
    expect(events[events.length - 1].state).toBe('done');
  });

  it('fails the job on an engine error final and on a pool rejection', async () => {
    const jobs = await make(2);
    await create(jobs);
    await create(jobs);
    pool.calls[0].resolve({ proto: 'backtest', msg: { type: 'error', message: 'bad config' } });
    pool.calls[1].reject(new Error('engine worker crashed: boom'));
    await flush();
    expect(await jobs.get('job-1')).toMatchObject({ state: 'failed', error: 'bad config' });
    expect(await jobs.get('job-2')).toMatchObject({ state: 'failed', error: 'engine worker crashed: boom' });
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(path.join(dir, 'jobs', 'job-1.json'), 'utf8')).summary.state).toBe('failed');
    });
  });

  it('cancels a queued job without calling the pool, and a running one through its handle', async () => {
    const jobs = await make(1);
    await create(jobs);
    await create(jobs);
    const queued = await jobs.remove('job-2');
    expect(queued).toMatchObject({ state: 'cancelled' });
    expect(pool.calls).toHaveLength(1);
    const running = await jobs.remove('job-1');
    expect(running).toMatchObject({ state: 'cancelled', finished: 1000 });
    expect(pool.calls[0].cancelled).toBe(true);
    await flush();
    expect(pool.calls).toHaveLength(1);
    expect((await jobs.get('job-1'))?.state).toBe('cancelled');
    await create(jobs);
    expect(pool.calls).toHaveLength(2);
  });

  it('removes a finished job and its file; unknown ids give undefined', async () => {
    const jobs = await make(1);
    await create(jobs);
    pool.calls[0].resolve({ proto: 'backtest', msg: { type: 'result' } });
    await flush();
    expect(await files()).toEqual(['job-1.json']);
    expect(await jobs.remove('job-1')).toBe('removed');
    expect(await files()).toEqual([]);
    expect(await jobs.get('job-1')).toBeUndefined();
    expect(await jobs.remove('nope')).toBeUndefined();
  });

  it('keeps the newest finished jobs and removes the rest', async () => {
    const jobs = await make(1);
    for (let i = 0; i < KEEP_FINISHED + 3; i += 1) {
      await create(jobs);
      clock += 10;
      pool.calls[i].resolve({ proto: 'backtest', msg: { type: 'result' } });
      await flush();
    }
    expect(jobs.list()).toHaveLength(KEEP_FINISHED);
    expect(await files()).toHaveLength(KEEP_FINISHED);
    expect(await jobs.get('job-1')).toBeUndefined();
    expect(await jobs.get(`job-${KEEP_FINISHED + 3}`)).toBeDefined();
  });

  it('marks queued and running records interrupted at start, and survives a bad file', async () => {
    await mkdir(path.join(dir, 'jobs'), { recursive: true });
    const rec = (id: string, state: string) => JSON.stringify({ summary: { id, kind: 'run', scope: 's', state, progress: 0.3, created: 1 } });
    await writeFile(path.join(dir, 'jobs', 'a.json'), rec('a', 'queued'));
    await writeFile(path.join(dir, 'jobs', 'b.json'), rec('b', 'running'));
    await writeFile(path.join(dir, 'jobs', 'c.json'), rec('c', 'done'));
    await writeFile(path.join(dir, 'jobs', 'bad.json'), '{not json');
    const jobs = await make(1);
    expect(jobs.list().map((s) => [s.id, s.state]).sort()).toEqual([['a', 'interrupted'], ['b', 'interrupted'], ['c', 'done']]);
    expect(JSON.parse(await readFile(path.join(dir, 'jobs', 'a.json'), 'utf8')).summary).toMatchObject({ state: 'interrupted', finished: 1000 });
    expect((await readdir(path.join(dir, 'jobs'))).some((f) => f.startsWith('bad.json.bad-'))).toBe(true);
    expect(pool.calls).toHaveLength(0);
  });

  it('wraps maker kinds as proto maker with v 1 and backtest kinds as proto backtest', async () => {
    const jobs = await make(3);
    await create(jobs, { kind: 'find', scope: 'strategy-maker', request: { series: [], inputs: {} } });
    await create(jobs, { kind: 'sweep', scope: 'strategy-maker', request: { input: {} } });
    await create(jobs, { kind: 'optimize', scope: 'x', request: { candles: [], config, optimize: {} } });
    expect(pool.calls[0].request).toEqual({ proto: 'maker', msg: { series: [], inputs: {}, v: 1, id: 'job-1', type: 'find' } });
    expect(pool.calls[1].request.msg).toMatchObject({ v: 1, type: 'sweep' });
    expect(pool.calls[2].request).toMatchObject({ proto: 'backtest', msg: { id: 'job-3', type: 'optimize' } });
    // finals per protocol
    expect(pool.calls[0].isFinal({ proto: 'maker', msg: { type: 'result' } })).toBe(true);
    expect(pool.calls[1].isFinal({ proto: 'maker', msg: { type: 'sweep-result' } })).toBe(true);
    expect(pool.calls[1].isFinal({ proto: 'maker', msg: { type: 'sweep-progress' } })).toBe(false);
    expect(pool.calls[2].isFinal({ proto: 'backtest', msg: { type: 'optimizeResult' } })).toBe(true);
    expect(pool.calls[2].isFinal({ proto: 'backtest', msg: { type: 'progress' } })).toBe(false);
  });

  it('refuses pine and custom strategies, bad input and a missing bundle', async () => {
    const jobs = await make(1);
    for (const strategyId of ['pine', 'custom']) {
      for (const kind of ['run', 'optimize']) {
        const r = await jobs.create({ kind, scope: 's', request: { config: { strategyId } } });
        expect(r).toMatchObject({ ok: false, status: 422 });
        expect((r as { error: string }).error).toContain('runs in the browser');
      }
    }
    const bad = [
      { kind: 'nope', scope: 's', request: {} },
      { kind: 'run', scope: 's', request: null },
      { kind: 'run', scope: 's', request: [] },
      { kind: 'run', scope: '', request: {} },
      { kind: 'run', scope: 'x'.repeat(201), request: {} },
      { kind: 'run', scope: 's', request: {}, placement: { where: 'moon', reason: 'auto' } },
      { kind: 'run', scope: 's', request: {}, placement: { where: 'server', reason: 'auto', benchmarkMs: 'x' } },
    ];
    for (const b of bad) expect(await jobs.create(b as never)).toMatchObject({ ok: false, status: 400 });
    expect(pool.calls).toHaveLength(0);
    const none = await make(1, { bundle: false });
    expect(await none.create(btInput() as never)).toEqual({ ok: false, status: 503, error: UNAVAILABLE });
  });

  it('stores a valid placement as given and filters the list by scope', async () => {
    const jobs = await make(3);
    const p = { where: 'server', reason: 'auto', benchmarkMs: 12 };
    const a = await create(jobs, { ...btInput(), placement: p });
    await create(jobs, { ...btInput(), scope: 'other' });
    expect(a.placement).toEqual(p);
    expect(jobs.list('other')).toHaveLength(1);
    expect(jobs.list()).toHaveLength(2);
  });

  it('does not write a running job failed on close', async () => {
    const jobs = await make(1);
    await create(jobs);
    jobs.close();
    pool.calls[0].reject(new Error('the job pool is closed'));
    await flush();
    expect(JSON.parse(await readFile(path.join(dir, 'jobs', 'job-1.json'), 'utf8')).summary.state).toBe('running');
  });
});
