import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from '../types';
import { seedStorageForTest } from '../lib/storage';

/** A fake jobs server that runs the real engine handler on each request, so a server job gives the engine's real reply. */
const server = vi.hoisted(() => ({
  jobs: new Map<string, Record<string, any>>(),
  followers: new Map<string, (s: any) => void>(),
  n: 0,
  hold: false,
  unavailable: false,
  cancelled: [] as string[],
  started: [] as string[],
}));
vi.mock('../lib/serverJobs', async (orig) => {
  const actual = await orig<typeof import('../lib/serverJobs')>();
  const { createBacktestHandler } = await import('../lib/workers/backtestHandler');
  const notify = (id: string) => {
    const { result: _r, ...summary } = server.jobs.get(id)!;
    server.followers.get(id)?.(summary);
  };
  return {
    ...actual,
    serverJobs: {
      async startJob(kind: string, request: Record<string, unknown>, scope: string) {
        if (server.unavailable) throw new actual.ServerUnavailableError('engine bundle missing');
        const id = `job${++server.n}`;
        server.started.push(kind);
        const job = { id, kind, scope, state: 'running', progress: 0, created: 1 };
        server.jobs.set(id, job);
        const handle = createBacktestHandler((m: any) => {
          if (m.type === 'progress') {
            job.progress = m.pct;
            return;
          }
          if (server.jobs.get(id)!.state !== 'running') return;
          Object.assign(job, { state: 'done', progress: 1, result: JSON.parse(JSON.stringify(m)) });
          notify(id);
        });
        if (!server.hold) setTimeout(() => handle({ ...request, id, type: kind } as never), 0);
        return { ...job };
      },
      followJob(id: string, fn: (s: any) => void) {
        server.followers.set(id, fn);
        return () => void server.followers.delete(id);
      },
      async getJob(id: string) {
        const j = server.jobs.get(id);
        return j ? { ...j } : null;
      },
      async cancelJob(id: string) {
        server.cancelled.push(id);
      },
      async listJobs() {
        return [];
      },
    },
  };
});

import { createBacktestHandler } from '../lib/workers/backtestHandler';
import { demoProvider } from '../lib/providers';
import { createChartStore, defaultChartInitial, type ChartEnv } from './chart';
import type { JobPlace } from './jobs';
import { putJobRecord } from './jobRecord';
import { defaultBacktestConfig } from '../lib/backtest/types';

const T0 = 1_700_000_000;
const bars: Candle[] = Array.from({ length: 160 }, (_, i) => {
  const close = 100 + 10 * Math.sin(i / 7) + (i % 5);
  return { time: T0 + i * 3600, open: close - 1, high: close + 2, low: close - 2, close, volume: 10 };
});

function make(place: JobPlace, id = 'chart-1', provider = 'fake') {
  const toasts: string[] = [];
  const messages: string[] = [];
  const env: ChartEnv = {
    pushToast: (_k, t) => void toasts.push(t),
    pushMessage: (_s, _v, t) => void messages.push(t),
    timeZone: () => 'UTC',
    buildTimeframes: () => false,
    historyLoading: () => 'all',
    pineHigherBars: () => 'forming',
    jobPlace: () => place,
    datasets: () => [],
    addDataset: () => {},
    removeDataset: () => {},
    onPrefsChange: () => {},
    onSync: () => {},
  };
  const store = createChartStore(id, { ...defaultChartInitial(), providerId: provider, symbol: 'AAA', timeframe: '1h', bars: 160 }, env);
  if (provider === 'fake') store.setState({ candles: bars, historyStart: true });
  return { store, toasts, messages };
}
/** A Worker that runs the engine handler in place, so the browser path works under Node. */
class InlineWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  private handle = createBacktestHandler((m) => setTimeout(() => this.onmessage?.({ data: m }), 0));
  postMessage(msg: never) {
    this.handle(msg);
  }
  terminate() {}
}
const flush = () => new Promise((r) => setTimeout(r, 10));
const same = (a: unknown, b: unknown) => expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  seedStorageForTest();
  Object.assign(server, { jobs: new Map(), followers: new Map(), n: 0, hold: false, unavailable: false, cancelled: [], started: [] });
});

describe('server jobs from the chart', () => {
  it('a backtest on the server gives the browser result and says where it ran', async () => {
    const browser = make('browser');
    await browser.store.getState().runBacktest();
    const onServer = make('server');
    await onServer.store.getState().runBacktest();
    expect(server.started).toEqual(['run']);
    expect(onServer.store.getState().btResult).not.toBeNull();
    same(onServer.store.getState().btResult, browser.store.getState().btResult);
    expect(onServer.store.getState().btRunning).toBe(false);
    expect(onServer.toasts[0]).toMatch(/^Backtest finished on the server in \d+ ms/);
    expect(browser.toasts[0]).toMatch(/^Backtest finished in the browser in \d+ ms/);
  });

  it('an optimizer run on the server gives the browser rows and the same context', async () => {
    vi.stubGlobal('Worker', InlineWorker);
    const browser = make('browser');
    await browser.store.getState().runOptimizer();
    const onServer = make('server');
    await onServer.store.getState().runOptimizer();
    expect(server.started).toEqual(['optimize']);
    const a = onServer.store.getState().optResult!;
    const b = browser.store.getState().optResult!;
    expect(a.rows.length).toBeGreaterThan(0);
    same(a, b);
    expect(a.context.strategyId).toBe(b.context.strategyId);
    expect(onServer.toasts.some((t) => t.startsWith('Optimizer finished on the server'))).toBe(true);
  });

  it('Monte Carlo on the server gives the browser result', async () => {
    const browser = make('browser');
    await browser.store.getState().runBacktest();
    await browser.store.getState().runMonteCarlo();
    const onServer = make('server');
    await onServer.store.getState().runBacktest();
    await onServer.store.getState().runMonteCarlo();
    expect(server.started).toEqual(['run', 'montecarlo']);
    same(onServer.store.getState().mcResult?.result, browser.store.getState().mcResult?.result);
    expect(onServer.store.getState().mcRunning).toBe(false);
  });

  it('Cancel during a server optimizer run sends DELETE and restores the previous result', async () => {
    const t = make('server');
    await t.store.getState().runOptimizer();
    const previous = t.store.getState().optResult;
    expect(previous).not.toBeNull();
    server.hold = true;
    const run = t.store.getState().runOptimizer();
    await flush();
    expect(t.store.getState().optRunning).toBe(true);
    t.store.getState().cancelOptimizer();
    await run;
    expect(server.cancelled).toEqual(['job2']);
    expect(t.store.getState().optRunning).toBe(false);
    expect(t.store.getState().optResult).toBe(previous);
    expect(t.toasts.at(-1)).toBe('Optimizer cancelled');
  });

  it('a restarted server ends the backtest with its own message', async () => {
    const t = make('server');
    server.hold = true;
    const run = t.store.getState().runBacktest();
    await flush();
    Object.assign(server.jobs.get('job1')!, { state: 'interrupted' });
    server.followers.get('job1')!({ ...server.jobs.get('job1')! });
    await run;
    expect(t.toasts.at(-1)).toBe('Backtest stopped: the server restarted');
    expect(t.store.getState().btRunning).toBe(false);
    expect(t.store.getState().btResult).toBeNull();
  });

  it('an unavailable server runs the job in the browser with one toast and one inbox message', async () => {
    server.unavailable = true;
    const t = make('server');
    await t.store.getState().runBacktest();
    expect(t.store.getState().btResult).not.toBeNull();
    const text = 'Server jobs unavailable (engine bundle missing); running in the browser';
    expect(t.toasts.filter((x) => x === text)).toHaveLength(1);
    expect(t.messages).toEqual([text]);
    expect(t.toasts.some((x) => x.startsWith('Backtest finished in the browser'))).toBe(true);
  });

  it('a Pine strategy stays in the browser on Server', async () => {
    const t = make('server');
    t.store.getState().setBtConfig({ strategyId: 'pine' });
    await t.store.getState().runBacktest();
    expect(server.started).toEqual([]);
  });
});

describe('reattach on load', () => {
  it('a reopened chart shows the run that finished while it was closed, and notes it once', async () => {
    const first = make('server');
    await first.store.getState().runBacktest();
    const expected = first.store.getState().btResult;
    // The tab closed before the job ended: nothing followed it to the end.
    putJobRecord('chart-1', 'run', { id: 'job1', symbol: 'AAA', timeframe: '1h', strategyId: first.store.getState().btConfig.strategyId, started: 1, seen: false });
    const reopened = make('browser');
    reopened.store.setState({ btResult: null });
    await flush();
    same(reopened.store.getState().btResult, expected);
    expect(reopened.messages).toEqual(['Backtest finished on the server while Vost was closed']);
    const third = make('browser');
    await flush();
    expect(third.messages).toEqual([]);
    same(third.store.getState().btResult, expected);
  });

  it('a finished result restored before the bars arrive survives the bars loading', async () => {
    const first = make('server');
    await first.store.getState().runBacktest();
    const expected = first.store.getState().btResult;
    putJobRecord('chart-1', 'run', { id: 'job1', symbol: 'AAA', timeframe: '1h', strategyId: first.store.getState().btConfig.strategyId, started: 1, seen: false });
    vi.spyOn(demoProvider, 'fetchHistory').mockImplementation(() => new Promise((r) => setTimeout(() => r(bars), 30)));
    const reopened = make('browser', 'chart-1', demoProvider.id);
    const loading = reopened.store.getState().loadData();
    await flush();
    same(reopened.store.getState().btResult, expected);
    await loading;
    same(reopened.store.getState().btResult, expected);
    vi.restoreAllMocks();
  });

  it('a run still going shows its progress and the result when it ends', async () => {
    const first = make('server');
    server.hold = true;
    void first.store.getState().runBacktest();
    await flush();
    const reopened = make('browser');
    await flush();
    expect(reopened.store.getState().btRunning).toBe(true);
    const job = server.jobs.get('job1')!;
    server.followers.get('job1')!({ ...job, progress: 0.5 });
    expect(reopened.store.getState().btProgress).toBe(0.5);
    const { createBacktestHandler } = await import('../lib/workers/backtestHandler');
    createBacktestHandler((m: any) => {
      if (m.type === 'result') Object.assign(job, { state: 'done', progress: 1, result: JSON.parse(JSON.stringify(m)) });
    })({ type: 'run', id: 'x', candles: bars, config: { ...defaultBacktestConfig(), ...reopened.store.getState().btConfig } });
    await flush();
    server.followers.get('job1')!({ ...job, result: undefined });
    await flush();
    expect(reopened.store.getState().btRunning).toBe(false);
    expect(reopened.store.getState().btResult).not.toBeNull();
    expect(reopened.messages).toEqual([]);
  });

  it('a chart on another symbol ignores the record', async () => {
    const first = make('server');
    await first.store.getState().runBacktest();
    const other = createChartStore('chart-1', { ...defaultChartInitial(), providerId: 'fake', symbol: 'BBB', timeframe: '1h', bars: 160 }, {
      pushToast: () => {}, pushMessage: () => {}, timeZone: () => 'UTC', buildTimeframes: () => false, historyLoading: () => 'all', pineHigherBars: () => 'forming',
      jobPlace: () => 'browser', datasets: () => [], addDataset: () => {}, removeDataset: () => {}, onPrefsChange: () => {}, onSync: () => {},
    });
    await flush();
    expect(other.getState().btResult).toBeNull();
  });
});
