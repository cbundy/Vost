import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seedStorageForTest } from '../lib/storage';

vi.mock('./worker', async (importOriginal) => {
  const real = await importOriginal<typeof import('./worker')>();
  return {
    ...real,
    workerCall: vi.fn(async () => ({ id: 'w', type: 'result', result: { from: 'browser' } })),
    optimizerCall: vi.fn(() => ({ promise: Promise.resolve({ id: 'w', type: 'optimizeResult', rows: [] }), cancel: vi.fn() })),
  };
});

import { CancelledError, optimizerCall, workerCall } from './worker';
import { reattachJobs, runJob, runOptimizerJob, ServerRestartedError, type ReattachTarget } from './jobs';
import { getJobRecord, putJobRecord } from './jobRecord';
import { ServerUnavailableError, type ServerJob, type ServerJobs, type ServerJobSummary } from './serverJobs';
import { defaultBacktestConfig } from '../lib/backtest/types';
import type { Candle } from '../types';

const candles = [] as Candle[];
const config = (strategyId: string) => ({ ...defaultBacktestConfig(), strategyId });
const runReq = (strategyId = 'sma-cross') => ({ type: 'run' as const, candles, config: config(strategyId) });
const optReq = (strategyId = 'sma-cross') => ({ type: 'optimize' as const, candles, config: config(strategyId), optimize: {} as never });
const mcReq = { type: 'montecarlo' as const, trades: [], initialCapital: 1000, options: { iterations: 10, method: 'shuffle' as const, seed: 1 } };
const REC = { symbol: 'BTCUSDT', timeframe: '1h', strategyId: 'sma-cross' };

/** An in-memory jobs API the test drives by hand. */
function fakeApi() {
  const jobs = new Map<string, ServerJob>();
  const followers = new Map<string, (s: ServerJobSummary) => void>();
  let n = 0;
  let startError: Error | null = null;
  const api = {
    startJob: vi.fn(async (kind: ServerJobSummary['kind'], _request: unknown, scope: string, _placement?: unknown) => {
      if (startError) throw startError;
      const job: ServerJob = { id: `job${++n}`, kind, scope, state: 'running', progress: 0, created: 1 };
      jobs.set(job.id, job);
      return { ...job };
    }),
    followJob: vi.fn((id: string, fn: (s: ServerJobSummary) => void) => {
      followers.set(id, fn);
      return () => void followers.delete(id);
    }),
    getJob: vi.fn(async (id: string) => (jobs.has(id) ? { ...jobs.get(id)! } : null)),
    cancelJob: vi.fn(async () => {}),
    listJobs: vi.fn(async () => []),
  } satisfies ServerJobs;
  return {
    api: api as ServerJobs,
    spies: api,
    jobs,
    failStart: (e: Error) => void (startError = e),
    push(id: string, patch: Partial<ServerJob>) {
      const job = Object.assign(jobs.get(id)!, patch);
      const { result: _result, ...summary } = job;
      followers.get(id)?.(summary);
    },
    following: (id: string) => followers.has(id),
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  seedStorageForTest();
  vi.clearAllMocks();
});

describe('where a job goes', () => {
  it('on Browser nothing touches the server', async () => {
    const f = fakeApi();
    const run = runJob('browser', 'chart-1', runReq(), undefined, { api: f.api });
    await run.promise;
    expect(run.place()).toBe('browser');
    expect(workerCall).toHaveBeenCalledTimes(1);
    const opt = runOptimizerJob('browser', 'chart-1', optReq(), undefined, { api: f.api });
    await opt.promise;
    expect(optimizerCall).toHaveBeenCalledTimes(1);
    expect(f.spies.startJob).not.toHaveBeenCalled();
    expect(f.spies.getJob).not.toHaveBeenCalled();
  });

  it('on Server a built-in strategy run, optimizer run and Monte Carlo run go to the server', async () => {
    const f = fakeApi();
    runJob('server', 'chart-1', runReq(), undefined, { api: f.api });
    runOptimizerJob('server', 'chart-1', optReq(), undefined, { api: f.api });
    runJob('server', 'chart-1', mcReq, undefined, { api: f.api, record: REC });
    await flush();
    expect(f.spies.startJob.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['run', 'chart-1'],
      ['optimize', 'chart-1'],
      ['montecarlo', 'chart-1'],
    ]);
    expect(workerCall).not.toHaveBeenCalled();
    expect(f.spies.startJob.mock.calls[0][3]).toEqual({ where: 'server', reason: 'setting' });
  });

  it('pine and custom strategies stay in the browser without any request', async () => {
    const f = fakeApi();
    for (const id of ['pine', 'custom']) {
      await runJob('server', 'chart-1', runReq(id), undefined, { api: f.api }).promise;
      await runOptimizerJob('server', 'chart-1', optReq(id), undefined, { api: f.api }).promise;
    }
    await runJob('server', 'chart-1', mcReq, undefined, { api: f.api, record: { ...REC, strategyId: 'pine' } }).promise;
    expect(workerCall).toHaveBeenCalledTimes(3);
    expect(optimizerCall).toHaveBeenCalledTimes(2);
    expect(f.spies.startJob).not.toHaveBeenCalled();
    expect(f.spies.getJob).not.toHaveBeenCalled();
  });
});

describe('a server job', () => {
  it('reports progress and stage, saves a record, and resolves with the stored result', async () => {
    const f = fakeApi();
    const onProgress = vi.fn();
    const onStarted = vi.fn();
    const run = runJob('server', 'chart-1', runReq(), onProgress, { api: f.api, record: REC, onStarted });
    await flush();
    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ id: 'job1' }));
    expect(getJobRecord('chart-1', 'run')).toMatchObject({ id: 'job1', ...REC, seen: false });
    f.push('job1', { progress: 0.4, stage: 'simulating' });
    expect(onProgress).toHaveBeenCalledWith(0.4, 'simulating');
    f.jobs.get('job1')!.result = { type: 'result', result: { from: 'server' } };
    f.push('job1', { state: 'done', progress: 1 });
    const msg = await run.promise;
    expect(msg).toMatchObject({ type: 'result', result: { from: 'server' } });
    expect(run.place()).toBe('server');
    expect(f.following('job1')).toBe(false);
    expect(getJobRecord('chart-1', 'run')).toMatchObject({ id: 'job1', seen: true });
  });

  it('a failed job rejects with the server message and clears its record', async () => {
    const f = fakeApi();
    const run = runJob('server', 'chart-1', runReq(), undefined, { api: f.api, record: REC });
    await flush();
    f.push('job1', { state: 'failed', error: 'boom' });
    await expect(run.promise).rejects.toThrow('boom');
    expect(getJobRecord('chart-1', 'run')).toBeNull();
  });

  it('an interrupted job says the server restarted and clears its record', async () => {
    const f = fakeApi();
    const run = runOptimizerJob('server', 'chart-1', optReq(), undefined, { api: f.api, record: REC });
    await flush();
    f.push('job1', { state: 'interrupted' });
    const err = await run.promise.catch((e) => e);
    expect(err).toBeInstanceOf(ServerRestartedError);
    expect(err.message).toBe('Optimizer stopped: the server restarted');
    expect(getJobRecord('chart-1', 'optimize')).toBeNull();
  });

  it('cancel sends DELETE, rejects with CancelledError and clears the record', async () => {
    const f = fakeApi();
    const run = runOptimizerJob('server', 'chart-1', optReq(), undefined, { api: f.api, record: REC });
    await flush();
    run.cancel();
    await expect(run.promise).rejects.toBeInstanceOf(CancelledError);
    expect(f.spies.cancelJob).toHaveBeenCalledWith('job1');
    expect(getJobRecord('chart-1', 'optimize')).toBeNull();
    expect(f.following('job1')).toBe(false);
  });

  it('cancel before the server answered still stops the job', async () => {
    const f = fakeApi();
    const run = runOptimizerJob('server', 'chart-1', optReq(), undefined, { api: f.api, record: REC });
    run.cancel();
    await expect(run.promise).rejects.toBeInstanceOf(CancelledError);
    expect(f.spies.cancelJob).toHaveBeenCalledWith('job1');
  });

  it('an unavailable server falls back to the browser with the reason, once', async () => {
    const f = fakeApi();
    f.failStart(new ServerUnavailableError('engine bundle missing'));
    const onFallback = vi.fn();
    const run = runJob('server', 'chart-1', runReq(), undefined, { api: f.api, record: REC, onFallback });
    const msg = await run.promise;
    expect(msg).toMatchObject({ result: { from: 'browser' } });
    expect(run.place()).toBe('browser');
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith('engine bundle missing');
    expect(getJobRecord('chart-1', 'run')).toBeNull();
  });

  it('any other refusal is a normal failure, not a fallback', async () => {
    const f = fakeApi();
    f.failStart(new Error('bad request'));
    const run = runJob('server', 'chart-1', runReq(), undefined, { api: f.api });
    await expect(run.promise).rejects.toThrow('bad request');
    expect(workerCall).not.toHaveBeenCalled();
  });

  it('a browser run clears the older server record of its kind', async () => {
    putJobRecord('chart-1', 'run', { id: 'old', ...REC, started: 1, seen: true });
    await runJob('browser', 'chart-1', runReq(), undefined, {}).promise;
    expect(getJobRecord('chart-1', 'run')).toBeNull();
  });
});

describe('reattachJobs', () => {
  function target(f: ReturnType<typeof fakeApi>, over: Partial<ReturnType<ReattachTarget['current']>> = {}) {
    const t = {
      chartId: 'chart-1',
      api: f.api,
      current: () => ({ ...REC, runId: null, ...over }),
      running: vi.fn(),
      done: vi.fn(),
      failed: vi.fn(),
      note: vi.fn(),
    } satisfies ReattachTarget;
    return t;
  }
  const saved = (id: string, seen = false) => putJobRecord('chart-1', 'run', { id, ...REC, started: 1, seen });

  it('with no record there is no request', async () => {
    const f = fakeApi();
    await reattachJobs(target(f));
    expect(f.spies.getJob).not.toHaveBeenCalled();
    expect(f.spies.listJobs).not.toHaveBeenCalled();
  });

  it('a job still running shows its progress, follows it, and shows the result at the end without a note', async () => {
    const f = fakeApi();
    f.jobs.set('j9', { id: 'j9', kind: 'run', scope: 'chart-1', state: 'running', progress: 0.3, stage: 'signals', created: 1 });
    saved('j9');
    const t = target(f);
    await reattachJobs(t);
    expect(t.running).toHaveBeenCalledWith('run', 0.3, 'signals', expect.any(Function));
    f.push('j9', { progress: 0.6 });
    expect(t.running).toHaveBeenLastCalledWith('run', 0.6, 'signals', expect.any(Function));
    f.jobs.get('j9')!.result = { type: 'result', result: 1 };
    f.push('j9', { state: 'done', progress: 1 });
    await flush();
    expect(t.done).toHaveBeenCalledWith('run', expect.objectContaining({ id: 'j9' }), { type: 'result', result: 1 });
    expect(t.note).not.toHaveBeenCalled();
    expect(getJobRecord('chart-1', 'run')?.seen).toBe(true);
  });

  it('a job that finished while closed shows its result and adds the note once', async () => {
    const f = fakeApi();
    f.jobs.set('j9', { id: 'j9', kind: 'run', scope: 'chart-1', state: 'done', progress: 1, created: 1, result: { type: 'result' } });
    saved('j9');
    const first = target(f);
    await reattachJobs(first);
    expect(first.done).toHaveBeenCalledTimes(1);
    expect(first.note).toHaveBeenCalledWith('Backtest finished on the server while Vost was closed');
    const second = target(f);
    await reattachJobs(second);
    expect(second.done).toHaveBeenCalledTimes(1);
    expect(second.note).not.toHaveBeenCalled();
  });

  it('a record for another symbol, timeframe or strategy does nothing', async () => {
    const f = fakeApi();
    f.jobs.set('j9', { id: 'j9', kind: 'run', scope: 'chart-1', state: 'done', progress: 1, created: 1, result: {} });
    saved('j9');
    for (const other of [{ symbol: 'ETHUSDT' }, { timeframe: '4h' }, { strategyId: 'rsi' }]) {
      const t = target(f, other);
      await reattachJobs(t);
      expect(t.done).not.toHaveBeenCalled();
      expect(t.running).not.toHaveBeenCalled();
    }
    expect(f.spies.getJob).not.toHaveBeenCalled();
    expect(getJobRecord('chart-1', 'run')).not.toBeNull();
  });

  it('an unknown job id drops the record silently', async () => {
    const f = fakeApi();
    saved('pruned');
    const t = target(f);
    await reattachJobs(t);
    expect(getJobRecord('chart-1', 'run')).toBeNull();
    expect(t.done).not.toHaveBeenCalled();
    expect(t.failed).not.toHaveBeenCalled();
    expect(t.note).not.toHaveBeenCalled();
  });

  it('an interrupted job is reported as a restart and its record cleared', async () => {
    const f = fakeApi();
    f.jobs.set('j9', { id: 'j9', kind: 'run', scope: 'chart-1', state: 'interrupted', progress: 0.5, created: 1 });
    saved('j9');
    const t = target(f);
    await reattachJobs(t);
    expect(t.failed).toHaveBeenCalledWith('run', expect.any(ServerRestartedError));
    expect(getJobRecord('chart-1', 'run')).toBeNull();
  });

  it('a Monte Carlo record reattaches only for the backtest it ran on', async () => {
    const f = fakeApi();
    f.jobs.set('m1', { id: 'm1', kind: 'montecarlo', scope: 'chart-1', state: 'done', progress: 1, created: 1, result: { type: 'monteCarloResult' } });
    putJobRecord('chart-1', 'montecarlo', { id: 'm1', ...REC, started: 1, seen: true, sourceRunId: 'j1' });
    const wrong = target(f, { runId: 'j2' });
    await reattachJobs(wrong);
    expect(wrong.done).not.toHaveBeenCalled();
    const none = target(f, { runId: null });
    await reattachJobs(none);
    expect(none.done).not.toHaveBeenCalled();
    const right = target(f, { runId: 'j1' });
    await reattachJobs(right);
    expect(right.done).toHaveBeenCalledWith('montecarlo', expect.objectContaining({ id: 'm1' }), { type: 'monteCarloResult' });
  });

  it('cancelling a reattached running job sends DELETE and clears the record', async () => {
    const f = fakeApi();
    f.jobs.set('j9', { id: 'j9', kind: 'run', scope: 'chart-1', state: 'running', progress: 0.3, created: 1 });
    saved('j9');
    const t = target(f);
    await reattachJobs(t);
    t.running.mock.calls[0][3]();
    expect(f.spies.cancelJob).toHaveBeenCalledWith('j9');
    expect(getJobRecord('chart-1', 'run')).toBeNull();
    expect(f.following('j9')).toBe(false);
  });
});
