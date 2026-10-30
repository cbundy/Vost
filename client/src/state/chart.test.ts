import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fmtTime } from '../lib/format';
import type { Candle } from '../types';
import * as providersModule from '../lib/providers';
import { createChartStore, defaultChartInitial, type ChartEnv } from './chart';
import { afterEachCleanup, chartOf, stubStorage, track, snap } from './stateTestKit';

afterEach(afterEachCleanup);

describe('pine indicators', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  async function setup() {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { candlesFromCsvText } = await import('../lib/csv');
    const text = readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8');
    const candles = candlesFromCsvText(text).candles;
    const { useStore } = await import('./store');
    track(useStore);
    chartOf(useStore).setState({ candles });
    return { useStore, candles };
  }

  const settle = async (useStore: Awaited<ReturnType<typeof setup>>['useStore'], id: string) => {
    await vi.waitFor(() => {
      const run = chartOf(useStore).getState().pineRuns[id];
      expect(run && !run.running).toBe(true);
    }, { timeout: 20000 });
    return chartOf(useStore).getState().pineRuns[id];
  };
  const pineId = (useStore: Awaited<ReturnType<typeof setup>>['useStore']) =>
    chartOf(useStore).getState().indicators.find((i) => i.kind === 'pine')!.id;

  it('adds a pine indicator, runs it, and recomputes when an input changes', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().addIndicator('pine');
    const id = pineId(useStore);
    const first = await settle(useStore, id);
    expect(first.error).toBeUndefined();
    expect(first.result!.inputs.map((i) => i.name)).toEqual(['Fast', 'Slow']);
    expect(first.result!.plots[0].values).toHaveLength(candles.length);

    chartOf(useStore).getState().updateIndicator(id, { inputs: { Fast: 3 } });
    await vi.waitFor(() => expect(chartOf(useStore).getState().pineRuns[id].result).not.toBe(first.result), { timeout: 20000 });
    const second = await settle(useStore, id);
    const spec = chartOf(useStore).getState().indicators.find((i) => i.id === id)!;
    expect(spec.inputs).toEqual({ Fast: 3 });
    // a 3-bar EMA has a value from bar 3 on; a 9-bar one does not
    expect(first.result!.plots[0].values[4]).toBeNull();
    expect(second.result!.plots[0].values[4]).not.toBeNull();
  });

  it('shows a compile error on the entry and leaves other indicators alone', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { useStore } = await setup();
    const bad = readFileSync(fileURLToPath(new URL('../lib/pine/fixtures/syntax-error.pine', import.meta.url)), 'utf8');
    chartOf(useStore).getState().addIndicator('pine');
    const id = pineId(useStore);
    await settle(useStore, id);
    chartOf(useStore).getState().updateIndicator(id, { source: bad });
    await vi.waitFor(() => expect(chartOf(useStore).getState().pineRuns[id].error).toBeDefined(), { timeout: 20000 });
    const run = await settle(useStore, id);
    expect(run.error!.message).toBeTruthy();
    expect(run.error!.line).toBeTypeOf('number');
    const { computeIndicator } = await import('../lib/indicatorCompute');
    const sma = chartOf(useStore).getState().indicators.find((i) => i.kind === 'sma')!;
    expect(computeIndicator(sma, chartOf(useStore).getState().candles)[0].data.length).toBeGreaterThan(0);
  });

  it('persists source and inputs; old prefs without pine entries still load', async () => {
    vi.useFakeTimers();
    try {
      const { useStore } = await setup();
      chartOf(useStore).getState().addIndicator('pine');
      const id = pineId(useStore);
      chartOf(useStore).getState().updateIndicator(id, { source: '//@version=6\nindicator("X")\nplot(close)\n', inputs: { Fast: 4 } });
      vi.advanceTimersByTime(1000);
      const raw = localStorage.getItem('vost.prefs.v1');
      expect(raw).not.toBeNull();
      // Reload: a fresh store reads the same prefs back.
      vi.resetModules();
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const fresh = track((await import('./store')).useStore);
      fresh.getState().init();
      const pine = chartOf(fresh).getState().indicators.find((i) => i.id === id)!;
      expect(pine.kind).toBe('pine');
      expect(pine.source).toContain('plot(close)');
      expect(pine.inputs).toEqual({ Fast: 4 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads old saved prefs that have no pine entries', async () => {
    localStorage.setItem(
      'vost.prefs.v1',
      JSON.stringify({
        providerId: 'binance',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        bars: 100,
        indicators: [{ id: 'old1', kind: 'sma', params: { length: 5 }, color: '#fff', visible: true }],
      }),
    );
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const { useStore } = await import('./store');
    track(useStore);
    useStore.getState().init();
    expect(chartOf(useStore).getState().indicators.map((i) => i.id)).toEqual(['old1']);
    expect(chartOf(useStore).getState().pineRuns).toEqual({});
  });
});


describe('openWatchItem', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  it('sets provider and symbol together and loads once', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    const seen: Array<{ providerId: string; symbol: string }> = [];
    const loadData = vi.fn().mockImplementation(async () => {
      const { providerId, symbol } = snap(useStore);
      seen.push({ providerId, symbol });
    });
    chartOf(useStore).setState({ loadData });
    chartOf(useStore).getState().openWatchItem('kraken', 'XBTUSD');
    expect(seen).toEqual([{ providerId: 'kraken', symbol: 'XBTUSD' }]);
    expect(chartOf(useStore).getState().providerId).toBe('kraken');
    expect(chartOf(useStore).getState().symbol).toBe('XBTUSD');
    expect(loadData).toHaveBeenCalledTimes(1);
  });
});


describe('btRange', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  async function setup() {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { candlesFromCsvText } = await import('../lib/csv');
    const text = readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8');
    const candles = candlesFromCsvText(text).candles;
    const { useStore } = await import('./store');
    track(useStore);
    chartOf(useStore).setState({ candles });
    return { useStore, candles };
  }

  const freshFromPrefs = async (btRange: unknown) => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1h', bars: 100, btRange }));
    vi.resetModules();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const fresh = track((await import('./store')).useStore);
    fresh.getState().init();
    return fresh;
  };

  it('runMonteCarlo matches the engine, and its result goes stale with the backtest it came from', async () => {
    const { runMonteCarlo } = await import('../lib/backtest/monteCarlo');
    const { useStore } = await setup();
    const st = () => chartOf(useStore).getState();
    await st().runBacktest();
    const source = st().btResult!;
    expect(source.trades.length).toBeGreaterThanOrEqual(2);
    st().setMcConfig({ iterations: 200, method: 'bootstrap', seed: 5 });
    await st().runMonteCarlo();
    const mc = st().mcResult!;
    expect(mc.source).toBe(source);
    expect(mc.result).toEqual(
      runMonteCarlo({ trades: source.trades, initialCapital: source.metrics.initialCapital }, { iterations: 200, method: 'bootstrap', seed: 5 }),
    );
    expect(st().mcRunning).toBe(false);
    // a second backtest and Clear both leave the old result's source behind
    await st().runBacktest();
    expect(st().mcResult!.source).not.toBe(st().btResult);
    st().clearBacktest();
    expect(st().btResult).toBeNull();
    expect(st().mcResult!.source).not.toBe(st().btResult);
  });

  it('runMonteCarlo drops a reply that lands after the backtest was replaced', async () => {
    const { useStore } = await setup();
    const st = () => chartOf(useStore).getState();
    await st().runBacktest();
    const pending = st().runMonteCarlo();
    st().clearBacktest(); // replaced while the run is in flight
    await pending;
    expect(st().mcResult).toBeNull();
    expect(st().mcRunning).toBe(false);
  });

  it('runBacktest only sees in-range bars', async () => {
    const { useStore, candles } = await setup();
    const from = candles[20].time;
    const to = candles[80].time;
    chartOf(useStore).getState().setBtRange({ from, to });
    await chartOf(useStore).getState().runBacktest();
    const r = chartOf(useStore).getState().btResult!;
    expect(r).not.toBeNull();
    expect(r.equity[0].time).toBe(from);
    expect(r.equity[r.equity.length - 1].time).toBe(to);
    for (const t of r.trades) {
      expect(t.entryTime).toBeGreaterThanOrEqual(from);
      expect(t.exitTime).toBeLessThanOrEqual(to);
    }
  });

  it('runOptimizer sends only in-range bars to the worker', async () => {
    const { useStore, candles } = await setup();
    const sent: { candles: { time: number }[] }[] = [];
    class FakeWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      terminate() {}
      postMessage(req: { id: string; candles: { time: number }[] }) {
        sent.push(req);
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: req.id, type: 'optimizeResult', rows: [], keys: [], metric: 'sharpe', combos: 0, errored: 0 } }),
        );
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const from = candles[10].time;
    const to = candles[40].time;
    chartOf(useStore).getState().setBtRange({ from, to });
    await chartOf(useStore).getState().runOptimizer();
    expect(sent).toHaveLength(1);
    expect(sent[0].candles).toHaveLength(31);
    expect(sent[0].candles[0].time).toBe(from);
    expect(sent[0].candles[30].time).toBe(to);
  });

  describe('monte-carlo validation', () => {
    it('sends the setting to the worker and keeps it in the run context', async () => {
      const { useStore } = await setup();
      const st = () => chartOf(useStore).getState();
      const posts: Array<{ id: string; optimize?: unknown }> = [];
      class FakeW {
        onmessage: ((ev: { data: unknown }) => void) | null = null;
        onerror: (() => void) | null = null;
        postMessage(req: { id: string }) {
          posts.push(req);
          const validation = { method: 'monte-carlo', topN: 5, iterations: 500, mcMethod: 'bootstrap', seed: 4, checks: [], failed: 0 };
          queueMicrotask(() => this.onmessage?.({ data: { id: req.id, type: 'optimizeResult', rows: [], keys: ['slow'], metric: 'sharpe', combos: 7, errored: 0, validation } }));
        }
        terminate() {}
      }
      vi.stubGlobal('Worker', FakeW);
      const mc = { method: 'monte-carlo', topN: 5, iterations: 500, mcMethod: 'bootstrap', seed: 4 } as const;
      st().setOptConfig({ validation: mc });
      await st().runOptimizer();
      expect((posts[0].optimize as { validation: unknown }).validation).toEqual(mc);
      expect(st().optResult!.context.validation).toEqual(mc);
    });
  });

  describe('split validation', () => {
    const split = { method: 'split', inSamplePct: 70, topN: 3 } as const;
    function fakeWorker(reply: boolean) {
      const posts: Array<{ id: string; type: string; candles: unknown[]; optimize?: unknown }> = [];
      const made: Array<{ terminated: boolean }> = [];
      class FakeW {
        onmessage: ((ev: { data: unknown }) => void) | null = null;
        onerror: (() => void) | null = null;
        terminated = false;
        constructor() {
          made.push(this);
        }
        postMessage(req: { id: string; type: string; candles: unknown[] }) {
          posts.push(req);
          if (reply) {
            const validation = { method: 'split', inSamplePct: 70, topN: 3, inSample: { from: 1, to: 2, bars: 5 }, heldOut: { from: 3, to: 4, bars: 2 }, checks: [], failed: 0 };
            queueMicrotask(() =>
              this.onmessage?.({ data: { id: req.id, type: 'optimizeResult', rows: [], keys: ['slow'], metric: 'sharpe', combos: 7, errored: 0, validation } }),
            );
          }
        }
        terminate() {
          this.terminated = true;
        }
      }
      vi.stubGlobal('Worker', FakeW);
      return { posts, made };
    }

    it('sends the whole range with the setting and keeps validation and its context', async () => {
      const { useStore, candles } = await setup();
      const st = () => chartOf(useStore).getState();
      const { posts } = fakeWorker(true);
      st().setOptConfig({ validation: split });
      await st().runOptimizer();
      expect(posts).toHaveLength(1);
      expect(posts[0].candles).toHaveLength(candles.length);
      expect((posts[0].optimize as { validation: unknown }).validation).toEqual(split);
      const r = st().optResult!;
      expect(r.validation?.method).toBe('split');
      const cut = Math.floor((candles.length * 70) / 100);
      expect(r.context.validation).toEqual({
        method: 'split',
        inSamplePct: 70,
        topN: 3,
        inSample: { from: candles[0].time, to: candles[cut - 1].time, bars: cut },
        heldOut: { from: candles[cut].time, to: candles[candles.length - 1].time, bars: candles.length - cut },
      });
    });

    it('a robustness run sends the setting and keeps it in the context', async () => {
      const { useStore, candles } = await setup();
      const st = () => chartOf(useStore).getState();
      const posts: Array<{ id: string; candles: unknown[]; optimize?: unknown }> = [];
      class FakeW {
        onmessage: ((ev: { data: unknown }) => void) | null = null;
        onerror: (() => void) | null = null;
        postMessage(req: { id: string; candles: unknown[] }) {
          posts.push(req);
          const validation = { method: 'robustness', radius: 2, rankByScore: true, scores: [] };
          queueMicrotask(() => this.onmessage?.({ data: { id: req.id, type: 'optimizeResult', rows: [], keys: ['slow'], metric: 'sharpe', combos: 7, errored: 0, validation } }));
        }
        terminate() {}
      }
      vi.stubGlobal('Worker', FakeW);
      const robust = { method: 'robustness', radius: 2, rankByScore: true } as const;
      st().setOptConfig({ validation: robust });
      await st().runOptimizer();
      expect(posts).toHaveLength(1);
      expect(posts[0].candles).toHaveLength(candles.length);
      expect((posts[0].optimize as { validation: unknown }).validation).toEqual(robust);
      expect(st().optResult!.validation?.method).toBe('robustness');
      expect(st().optResult!.context.validation).toEqual(robust);
    });

    it('a bad neighbourhood toasts and posts nothing', async () => {
      const { useStore } = await setup();
      const st = () => chartOf(useStore).getState();
      const { posts } = fakeWorker(true);
      st().setOptConfig({ validation: { method: 'robustness', radius: 0, rankByScore: false } });
      await st().runOptimizer();
      expect(posts).toHaveLength(0);
      expect(snap(useStore).toasts.some((t) => t.kind === 'error' && /Neighbourhood/.test(t.text))).toBe(true);
    });

    it('an invalid split toasts and posts nothing', async () => {
      const { useStore } = await setup();
      const st = () => chartOf(useStore).getState();
      const { posts } = fakeWorker(true);
      st().setOptConfig({ validation: { method: 'split', inSamplePct: 99, topN: 3 } });
      await st().runOptimizer();
      expect(posts).toHaveLength(0);
      expect(st().optRunning).toBe(false);
      expect(snap(useStore).toasts.some((t) => t.kind === 'error' && /In-sample %/.test(t.text))).toBe(true);
    });

    it('cancel during a split run brings back the previous result', async () => {
      const { useStore } = await setup();
      const st = () => chartOf(useStore).getState();
      fakeWorker(true);
      await st().runOptimizer();
      const earlier = st().optResult;
      expect(earlier).not.toBeNull();
      const { made } = fakeWorker(false);
      st().setOptConfig({ validation: split });
      const run = st().runOptimizer();
      expect(st().optResult).toBeNull();
      st().cancelOptimizer();
      await run;
      expect(made[0].terminated).toBe(true);
      expect(st().optResult).toBe(earlier);
      expect(st().optRunning).toBe(false);
    });
  });

  describe('walk-forward validation', () => {
    const walk = { method: 'walk-forward', windows: 3, inSamplePct: 70, anchored: false } as const;
    function fakeWorker(reply: boolean) {
      const posts: Array<{ id: string; type: string; candles: unknown[]; optimize?: unknown }> = [];
      const made: Array<{ terminated: boolean }> = [];
      class FakeW {
        onmessage: ((ev: { data: unknown }) => void) | null = null;
        onerror: (() => void) | null = null;
        terminated = false;
        constructor() {
          made.push(this);
        }
        postMessage(req: { id: string; type: string; candles: unknown[] }) {
          posts.push(req);
          if (reply) {
            const walkForward = { method: 'walk-forward', windows: 3, inSamplePct: 70, anchored: false, spans: [], results: [], incomplete: 0, failed: 0, combined: null, equity: [] };
            queueMicrotask(() =>
              this.onmessage?.({ data: { id: req.id, type: 'optimizeResult', rows: [], keys: ['slow'], metric: 'sharpe', combos: 7, errored: 0, walkForward } }),
            );
          }
        }
        terminate() {
          this.terminated = true;
        }
      }
      vi.stubGlobal('Worker', FakeW);
      return { posts, made };
    }

    it('posts the setting and keeps the result with the per-window spans', async () => {
      const { useStore, candles } = await setup();
      const st = () => chartOf(useStore).getState();
      const { posts } = fakeWorker(true);
      st().setOptConfig({ validation: walk });
      await st().runOptimizer();
      expect(posts).toHaveLength(1);
      expect((posts[0].optimize as { validation: unknown }).validation).toEqual(walk);
      const r = st().optResult!;
      expect(r.walkForward?.method).toBe('walk-forward');
      expect(r.validation).toBeUndefined();
      const w = r.context.walkForward!;
      expect(w).toMatchObject({ method: 'walk-forward', windows: 3, inSamplePct: 70, anchored: false });
      expect(w.spans).toHaveLength(3);
      const n = candles.length;
      const oos = Math.floor(n / (3 + 70 / 30));
      expect(w.spans[2].heldOut).toEqual({ from: candles[n - oos].time, to: candles[n - 1].time, bars: oos });
      expect(w.spans[0].inSample.bars).toBe(n - 3 * oos);
    });

    it('an invalid setting toasts and posts nothing', async () => {
      const { useStore } = await setup();
      const st = () => chartOf(useStore).getState();
      const { posts } = fakeWorker(true);
      st().setOptConfig({ validation: { ...walk, windows: 1 } });
      await st().runOptimizer();
      expect(posts).toHaveLength(0);
      expect(st().optRunning).toBe(false);
      expect(snap(useStore).toasts.some((t) => t.kind === 'error' && /Windows/.test(t.text))).toBe(true);
    });

    it('cancel during a walk-forward run brings back the previous result', async () => {
      const { useStore } = await setup();
      const st = () => chartOf(useStore).getState();
      fakeWorker(true);
      await st().runOptimizer();
      const earlier = st().optResult;
      expect(earlier).not.toBeNull();
      const { made } = fakeWorker(false);
      st().setOptConfig({ validation: walk });
      const run = st().runOptimizer();
      expect(st().optResult).toBeNull();
      st().cancelOptimizer();
      await run;
      expect(made[0].terminated).toBe(true);
      expect(st().optResult).toBe(earlier);
      expect(st().optRunning).toBe(false);
    });
  });

  describe('cancelOptimizer', () => {
    function stubWorkers(answer: boolean) {
      const made: FakeW[] = [];
      class FakeW {
        onmessage: ((ev: { data: unknown }) => void) | null = null;
        onerror: (() => void) | null = null;
        terminated = false;
        posts: Array<{ id: string; type: string }> = [];
        constructor() {
          made.push(this);
        }
        postMessage(req: { id: string; type: string }) {
          this.posts.push(req);
          if (req.type === 'optimize' && answer)
            queueMicrotask(() =>
              this.onmessage?.({ data: { id: req.id, type: 'optimizeResult', rows: [], keys: ['slow'], metric: 'sharpe', combos: 7, errored: 0 } }),
            );
        }
        terminate() {
          this.terminated = true;
        }
      }
      vi.stubGlobal('Worker', FakeW);
      return made;
    }

    it('restores the earlier result, pushes no error, terminates only that worker, ignores late messages', async () => {
      const { useStore } = await setup();
      const st = () => chartOf(useStore).getState();
      const made = stubWorkers(true);
      await st().runOptimizer();
      expect(made).toHaveLength(1);
      expect(made[0].terminated).toBe(true); // an answered run terminates its dedicated worker
      const earlier = st().optResult;
      expect(earlier?.combos).toBe(7);

      // the run's settings are kept with the result; later edits do not change them
      const ctx = earlier!.context;
      expect(ctx.strategyId).toBe(st().btConfig.strategyId);
      expect(ctx.initialCapital).toBe(st().btConfig.initialCapital);
      expect(ctx.bars).toBe(st().candles.length);
      expect(ctx.sweeps).toEqual(st().optConfig.sweeps);
      const before = JSON.stringify(ctx);
      const startCapital = st().btConfig.initialCapital;
      st().setBtConfig({ initialCapital: startCapital + 5000, feeBps: 77 });
      st().setBtRange({ from: st().candles[3].time, to: null });
      st().setOptConfig({ sweeps: [{ key: 'slow', from: 1, to: 2, step: 1 }] });
      expect(st().optResult!.context).toBe(ctx);
      expect(JSON.stringify(ctx)).toBe(before);
      expect(ctx.initialCapital).toBe(startCapital);
      expect(ctx.feeBps).not.toBe(77);

      const made2 = stubWorkers(false);
      const run = st().runOptimizer();
      expect(st().optRunning).toBe(true);
      expect(st().optResult).toBeNull();
      const lateHandler = made2[0].onmessage;
      const lateId = made2[0].posts[0].id;
      expect(lateHandler).not.toBeNull();
      st().cancelOptimizer();
      await run;
      expect(made2).toHaveLength(1);
      expect(made2[0].terminated).toBe(true);
      expect(st().optRunning).toBe(false);
      expect(st().optProgress).toBe(0);
      expect(st().optResult).toBe(earlier);
      expect(st().optResult!.context.initialCapital).toBe(startCapital); // its own context, not the cancelled run's
      expect(snap(useStore).toasts.some((t) => t.kind === 'error')).toBe(false);

      // a late message from the cancelled worker (its real handler, the run's real id) changes nothing
      lateHandler?.({ data: { id: lateId, type: 'optimizeResult', rows: [], keys: [], metric: 'sharpe', combos: 99, errored: 0 } });
      expect(st().optResult).toBe(earlier);
      expect(st().optRunning).toBe(false);

      // the next run builds a fresh worker and posts its request to it
      const made3 = stubWorkers(false);
      void st().runOptimizer();
      expect(made3).toHaveLength(1);
      expect(made3[0].posts.map((q) => q.type)).toEqual(['optimize']);
      expect(made3[0].posts[0].id).not.toBe(lateId);
      st().cancelOptimizer();
    });

    it('does not touch the shared worker: a backtest in flight during the cancel still resolves', async () => {
      const { useStore } = await setup();
      const st = () => chartOf(useStore).getState();
      const made: Array<{ terminated: boolean; onmessage: ((ev: { data: unknown }) => void) | null; last?: { id: string } }> = [];
      class FakeW {
        onmessage: ((ev: { data: unknown }) => void) | null = null;
        onerror: (() => void) | null = null;
        terminated = false;
        last?: { id: string };
        constructor() {
          made.push(this);
        }
        postMessage(req: { id: string; type: string }) {
          this.last = req;
        }
        terminate() {
          this.terminated = true;
        }
      }
      vi.stubGlobal('Worker', FakeW);
      const bt = st().runBacktest();
      const shared = made[0];
      void st().runOptimizer();
      expect(made).toHaveLength(2);
      st().cancelOptimizer();
      expect(shared.terminated).toBe(false);
      expect(made[1].terminated).toBe(true);
      const { runFullBacktest } = await import('../lib/backtest/runner');
      const result = runFullBacktest(st().candles, st().btConfig);
      shared.onmessage?.({ data: { id: shared.last!.id, type: 'result', result } });
      await bt;
      expect(st().btResult).not.toBeNull();
    });
  });

  it('applyOptimizeRow sets exactly the row params and the next backtest equals the row metrics', async () => {
    const { useStore } = await setup();
    const { runOptimize } = await import('../lib/backtest/optimizer');
    const st = () => chartOf(useStore).getState();
    st().setBtConfig({ feeBps: 0, slippageBps: 0 });
    const out = runOptimize(chartOf(useStore).getState().candles, st().btConfig, {
      sweeps: [{ key: 'slow', from: 20, to: 40, step: 10 }],
      metric: 'totalReturnPct',
    });
    const row = out.rows[out.rows.length - 1];
    expect(Object.keys(row.params)).toEqual(['slow']);
    const before = { ...st().btConfig.params };
    await st().applyOptimizeRow(row);
    expect(st().btConfig.params).toEqual({ ...before, ...row.params });
    expect(st().btResult!.metrics).toEqual(row.metrics);
  });

  it('From later than To starts nothing and pushes an error toast', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().setBtRange({ from: candles[50].time, to: candles[10].time });
    await chartOf(useStore).getState().runBacktest();
    await chartOf(useStore).getState().runOptimizer();
    const s = snap(useStore);
    expect(s.btRunning).toBe(false);
    expect(s.optRunning).toBe(false);
    expect(s.btResult).toBeNull();
    expect(s.toasts.some((t) => t.kind === 'error' && t.text.includes('From is later than To'))).toBe(true);
  });

  it('a range with fewer than 3 bars starts nothing', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().setBtRange({ from: candles[5].time, to: candles[6].time });
    await chartOf(useStore).getState().runBacktest();
    expect(chartOf(useStore).getState().btResult).toBeNull();
    expect(useStore.getState().toasts.some((t) => t.text.includes('Fewer than 3 bars'))).toBe(true);
  });

  it('persists setBtRange and a fresh store reads it back', async () => {
    vi.useFakeTimers();
    try {
      const { useStore } = await setup();
      chartOf(useStore).getState().setBtRange({ from: 100, to: null });
      vi.advanceTimersByTime(1000);
      expect(JSON.parse(localStorage.getItem('vost.prefs.v1')!).btRange).toEqual({ from: 100, to: null });
      const fresh = await freshFromPrefs(JSON.parse(localStorage.getItem('vost.prefs.v1')!).btRange);
      expect(chartOf(fresh).getState().btRange).toEqual({ from: 100, to: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('old prefs and malformed values fall back to an open range', async () => {
    for (const stored of [undefined, 'x', { from: 'a' }, { from: 1 }, null]) {
      const fresh = await freshFromPrefs(stored);
      expect(chartOf(fresh).getState().btRange).toEqual({ from: null, to: null });
    }
  });

  it('keeps the range across a new data load', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().setBtRange({ from: 5, to: 9 });
    const id = chartOf(useStore).getState().addDataset({
      name: 'd1',
      candles,
      source: 'csv',
      description: 'd1',
      barSeconds: 86400,
      barLabel: '1d',
    });
    chartOf(useStore).getState().activateDataset(id);
    expect(chartOf(useStore).getState().dataLabel).toBeTruthy();
    expect(chartOf(useStore).getState().btRange).toEqual({ from: 5, to: 9 });
  });
});

describe('chartRange', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  async function setup() {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { candlesFromCsvText } = await import('../lib/csv');
    const text = readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8');
    const candles = candlesFromCsvText(text).candles;
    const { useStore } = await import('./store');
    track(useStore);
    chartOf(useStore).setState({ candles, liveWanted: false }); // these tests crop and clear locally; live has its own tests below
    return { useStore, candles };
  }

  const errorCount = (s: { messages: { severity: string }[] }) => s.messages.filter((m) => m.severity === 'error').length;

  it('crops inclusively, keeps the full bars and leaves btRange alone', async () => {
    const { useStore, candles } = await setup();
    const key = chartOf(useStore).getState().dataKey;
    const from = candles[20].time;
    const to = candles[80].time;
    await chartOf(useStore).getState().setChartRange({ from, to });
    const s = snap(useStore);
    expect(s.candles).toHaveLength(61);
    expect(s.candles[0].time).toBe(from);
    expect(s.candles[60].time).toBe(to);
    expect(s.fullCandles).toEqual(candles);
    expect(s.chartRange).toEqual({ from, to });
    expect(s.dataKey).not.toBe(key);
    expect(s.btRange).toEqual({ from: null, to: null });
  });

  it('setBtRange leaves chartRange untouched', async () => {
    const { useStore, candles } = await setup();
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    chartOf(useStore).getState().setBtRange({ from: candles[30].time, to: null });
    expect(chartOf(useStore).getState().chartRange).toEqual({ from: candles[20].time, to: candles[80].time });
  });

  it('pauses live and crops when a range is picked on a live chart, then clearing resumes live', async () => {
    const { useStore, candles } = await setup();
    const startLive = vi.fn(() => ({ stop: vi.fn() }));
    const stub = vi.spyOn(await import('../lib/providers'), 'getProvider').mockReturnValue({
      ...(await import('../lib/providers')).demoProvider,
      supportsLive: true,
      startLive,
      fetchHistory: async () => candles,
    } as never);
    chartOf(useStore).setState({ live: true, liveStatus: 'live', liveWanted: true });
    const before = useStore.getState().toasts.length;
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    const s = snap(useStore);
    expect(s.chartRange).not.toBeNull();
    expect(s.candles).toHaveLength(61);
    expect(s.live).toBe(false);
    expect(chartOf(useStore).getState().liveWanted).toBe(true);
    const info = s.toasts.slice(before).filter((x) => x.kind === 'info');
    expect(info.map((x) => x.text)).toEqual(['Live is paused while the chart is cropped. Clear the range to go live again.']);
    expect(startLive).not.toHaveBeenCalled();
    await chartOf(useStore).getState().clearChartRange();
    expect(chartOf(useStore).getState().chartRange).toBeNull();
    expect(startLive).toHaveBeenCalledOnce();
    stub.mockRestore();
  });

  it('clicking Live with a range active clears it and opens exactly one stream', async () => {
    const { useStore, candles } = await setup();
    const startLive = vi.fn(() => ({ stop: vi.fn() }));
    const stub = vi.spyOn(await import('../lib/providers'), 'getProvider').mockReturnValue({
      ...(await import('../lib/providers')).demoProvider,
      supportsLive: true,
      startLive,
      fetchHistory: async () => candles,
    } as never);
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    chartOf(useStore).getState().setLive(true);
    await vi.waitFor(() => expect(startLive).toHaveBeenCalledOnce());
    await new Promise((r) => setTimeout(r, 20));
    expect(startLive).toHaveBeenCalledOnce();
    expect(chartOf(useStore).getState().chartRange).toBeNull();
    chartOf(useStore).getState().setLive(false);
    stub.mockRestore();
  });

  it('clearing with live turned off restores the crop locally without a reload', async () => {
    const { useStore, candles } = await setup();
    const fetchHistory = vi.fn(async () => candles);
    const stub = vi.spyOn(await import('../lib/providers'), 'getProvider').mockReturnValue({ ...(await import('../lib/providers')).demoProvider, supportsLive: true, startLive: vi.fn(), fetchHistory } as never);
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    await chartOf(useStore).getState().clearChartRange();
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(chartOf(useStore).getState().candles).toBe(candles);
    stub.mockRestore();
  });

  it('a second apply slices from the full set', async () => {
    const { useStore, candles } = await setup();
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[30].time });
    await chartOf(useStore).getState().setChartRange({ from: candles[10].time, to: candles[90].time });
    expect(chartOf(useStore).getState().candles).toHaveLength(81);
    expect(chartOf(useStore).getState().fullCandles).toEqual(candles);
  });

  it('refusals add one error and change nothing', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).setState({ activeDatasetId: 'local' }); // a local dataset cannot fetch more
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    const before = snap(useStore);
    const cases: [{ from: number | null; to: number | null }, string][] = [
      [{ from: candles[0].time - 1, to: null }, 'Range is outside this dataset'],
      [{ from: null, to: candles[candles.length - 1].time + 1 }, 'Range is outside this dataset'],
      [{ from: candles[50].time, to: candles[10].time }, 'From is later than To'],
      [{ from: candles[5].time, to: candles[5].time }, 'Fewer than 2 bars in the chart range'],
    ];
    let n = errorCount(before);
    for (const [range, text] of cases) {
      await chartOf(useStore).getState().setChartRange(range);
      const s = snap(useStore);
      expect(errorCount(s)).toBe(++n);
      expect(s.toasts.some((t) => t.kind === 'error' && t.text === text)).toBe(true);
      expect(s.candles).toBe(before.candles);
      expect(s.dataKey).toBe(before.dataKey);
      expect(s.chartRange).toBe(before.chartRange);
    }
  });

  it('refusals on uncropped data change nothing', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).setState({ activeDatasetId: 'local' });
    const key = chartOf(useStore).getState().dataKey;
    await chartOf(useStore).getState().setChartRange({ from: candles[0].time - 5, to: null });
    const s = snap(useStore);
    expect(s.chartRange).toBeNull();
    expect(s.fullCandles).toBeNull();
    expect(s.candles).toBe(candles);
    expect(s.dataKey).toBe(key);
  });

  it('clearChartRange restores the bars without fetching', async () => {
    const { useStore, candles } = await setup();
    const fetchSpy = vi.fn(() => {
      throw new Error('no fetch expected');
    });
    vi.stubGlobal('fetch', fetchSpy);
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    const key = chartOf(useStore).getState().dataKey;
    await chartOf(useStore).getState().clearChartRange();
    const s = snap(useStore);
    expect(s.candles).toBe(candles);
    expect(s.fullCandles).toBeNull();
    expect(s.chartRange).toBeNull();
    expect(s.dataKey).not.toBe(key);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an open range acts as Clear', async () => {
    const { useStore, candles } = await setup();
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    await chartOf(useStore).getState().setChartRange({ from: null, to: null });
    expect(chartOf(useStore).getState().candles).toBe(candles);
    expect(chartOf(useStore).getState().chartRange).toBeNull();
  });

  it('activateDataset, addDataset and clearData reset the range', async () => {
    const { useStore, candles } = await setup();
    const input = { name: 'd1', candles, source: 'csv', description: 'd1', barSeconds: 86400, barLabel: '1d' };
    const range = { from: candles[20].time, to: candles[80].time };
    await chartOf(useStore).getState().setChartRange(range);
    const id = chartOf(useStore).getState().addDataset(input);
    expect(chartOf(useStore).getState().chartRange).toBeNull();
    expect(chartOf(useStore).getState().fullCandles).toBeNull();
    await chartOf(useStore).getState().setChartRange(range);
    chartOf(useStore).getState().activateDataset(id);
    expect(chartOf(useStore).getState().chartRange).toBeNull();
    expect(chartOf(useStore).getState().candles).toHaveLength(candles.length);
    await chartOf(useStore).getState().setChartRange(range);
    chartOf(useStore).getState().clearData();
    expect(chartOf(useStore).getState().chartRange).toBeNull();
    expect(chartOf(useStore).getState().fullCandles).toBeNull();
  });

  it('loadData resets the range', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).setState({ providerId: 'demo', bars: 200 });
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    await chartOf(useStore).getState().loadData();
    expect(chartOf(useStore).getState().loadState).toBe('ready');
    expect(chartOf(useStore).getState().chartRange).toBeNull();
    expect(chartOf(useStore).getState().fullCandles).toBeNull();
  });

  it('setLive(true) restores the full candles first', async () => {
    const { useStore, candles } = await setup();
    const { getProvider } = await import('../lib/providers');
    const provider = getProvider('binance');
    const orig = provider.startLive;
    provider.startLive = () => ({ stop() {} });
    try {
      await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
      chartOf(useStore).getState().setLive(true);
      expect(chartOf(useStore).getState().candles).toBe(candles);
      expect(chartOf(useStore).getState().chartRange).toBeNull();
      chartOf(useStore).getState().setLive(false);
    } finally {
      provider.startLive = orig;
    }
  });

  it('runBacktest runs only on the cropped bars', async () => {
    const { useStore, candles } = await setup();
    const from = candles[20].time;
    const to = candles[80].time;
    await chartOf(useStore).getState().setChartRange({ from, to });
    await chartOf(useStore).getState().runBacktest();
    const r = chartOf(useStore).getState().btResult!;
    expect(r.equity[0].time).toBe(from);
    expect(r.equity[r.equity.length - 1].time).toBe(to);
  });

  it('saveCurrentDataset stores the full candles', async () => {
    const { useStore, candles } = await setup();
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    chartOf(useStore).getState().saveCurrentDataset('full');
    const saved = useStore.getState().datasets.find((d) => d.name === 'full')!;
    expect(saved.candles).toHaveLength(candles.length);
  });

  it('is not persisted and a fresh store has no range', async () => {
    vi.useFakeTimers();
    try {
      const { useStore, candles } = await setup();
      await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
      chartOf(useStore).getState().setBars(300);
      vi.advanceTimersByTime(1000);
      expect(localStorage.getItem('vost.prefs.v1')).not.toContain('chartRange');
      vi.resetModules();
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const fresh = track((await import('./store')).useStore);
      fresh.getState().init();
      expect(chartOf(fresh).getState().chartRange).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('chartRange fetched from the provider', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  const DAY = 86400;
  const mk = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({ time: from + i * DAY, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));

  async function setup() {
    const { useStore } = await import('./store');
    track(useStore);
    const { demoProvider } = await import('../lib/providers');
    const base = mk(1_600_000_000 - (1_600_000_000 % DAY), 100);
    chartOf(useStore).setState({ providerId: 'demo', symbol: 'DEMO', timeframe: '1d', bars: 100, candles: base, activeDatasetId: null });
    const calls: { from?: number; to?: number; bars: number }[] = [];
    let handler: (req: { from?: number; to?: number; bars: number }) => Promise<ReturnType<typeof mk>> = async (req) =>
      mk(req.from!, Math.floor((req.to! - req.from!) / DAY) + 1);
    const spy = vi.spyOn(demoProvider, 'fetchHistory').mockImplementation(async (req) => {
      calls.push({ from: req.from, to: req.to, bars: req.bars });
      return handler(req);
    });
    return { useStore, base, calls, spy, setHandler: (h: typeof handler) => (handler = h) };
  }

  it('fetches a span outside the loaded bars, then crops inside it without a request', async () => {
    const { useStore, base, calls } = await setup();
    const from = base[0].time - 50 * DAY;
    const to = base[0].time - 20 * DAY;
    const key = chartOf(useStore).getState().dataKey;
    expect(await chartOf(useStore).getState().setChartRange({ from, to })).toBe(true);
    const s = snap(useStore);
    expect(calls).toEqual([{ from, to, bars: 100 }]);
    expect(s.candles).toHaveLength(31);
    expect(s.fullCandles).toHaveLength(31);
    expect(s.chartRange).toEqual({ from, to });
    expect(s.chartRangeFetched).toBe(true);
    expect(s.dataKey).not.toBe(key);
    expect(s.loadState).toBe('ready');
    const { fmtDataRange } = await import('../lib/format');
    expect(fmtDataRange(s.candles[0].time, s.candles[30].time, s.candles.length, { timeZone: 'UTC' })).toContain('31');
    // inside the fetched span: crop only
    expect(await chartOf(useStore).getState().setChartRange({ from: from + 5 * DAY, to: from + 10 * DAY })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(chartOf(useStore).getState().candles).toHaveLength(6);
    // outside the fetched span: fetch again
    expect(await chartOf(useStore).getState().setChartRange({ from: from - 10 * DAY, to })).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('a range inside the loaded bars crops with no request', async () => {
    const { useStore, base, calls } = await setup();
    expect(await chartOf(useStore).getState().setChartRange({ from: base[10].time, to: base[20].time })).toBe(true);
    expect(calls).toHaveLength(0);
    expect(chartOf(useStore).getState().chartRangeFetched).toBe(false);
  });

  it('an open From sends to and the current bars; an open To sends only from', async () => {
    const { useStore, base, calls } = await setup();
    await chartOf(useStore).getState().setChartRange({ from: null, to: base[99].time + 10 * DAY });
    expect(calls[0]).toEqual({ from: undefined, to: base[99].time + 10 * DAY, bars: 100 });
    await chartOf(useStore).getState().setChartRange({ from: base[0].time - 10 * DAY, to: null });
    expect(calls[1]).toEqual({ from: base[0].time - 10 * DAY, to: undefined, bars: 100 });
  });

  it('from after to is refused before any request', async () => {
    const { useStore, base, calls } = await setup();
    expect(await chartOf(useStore).getState().setChartRange({ from: base[0].time - DAY, to: base[0].time - 5 * DAY })).toBe(false);
    expect(calls).toHaveLength(0);
    expect(useStore.getState().toasts.some((t) => t.text === 'From is later than To')).toBe(true);
  });

  it('clearChartRange after a fetch reloads the latest bars and resets the flag', async () => {
    const { useStore, base, calls, setHandler } = await setup();
    await chartOf(useStore).getState().setChartRange({ from: base[0].time - 50 * DAY, to: base[0].time - 20 * DAY });
    setHandler(async () => base);
    await chartOf(useStore).getState().clearChartRange();
    expect(calls[1]).toEqual({ from: undefined, to: undefined, bars: 100 });
    const s = snap(useStore);
    expect(s.candles).toEqual(base);
    expect(s.chartRange).toBeNull();
    expect(s.fullCandles).toBeNull();
    expect(s.chartRangeFetched).toBe(false);
  });

  it('a provider error toasts once, keeps the data and resolves false', async () => {
    const { useStore, base, setHandler } = await setup();
    setHandler(async () => {
      throw new Error('boom');
    });
    const before = snap(useStore);
    expect(await chartOf(useStore).getState().setChartRange({ from: base[0].time - 50 * DAY, to: base[0].time - 20 * DAY })).toBe(false);
    const s = snap(useStore);
    expect(s.candles).toBe(before.candles);
    expect(s.chartRange).toBeNull();
    expect(s.loadState).toBe('ready');
    expect(s.toasts.filter((t) => t.kind === 'error').map((t) => t.text)).toEqual(['Could not load range: boom']);
    expect(s.messages.filter((m) => m.severity === 'error')).toHaveLength(1);
  });

  it('fewer than 2 bars returned is refused', async () => {
    const { useStore, base, setHandler } = await setup();
    setHandler(async (req) => mk(req.from!, 1));
    expect(await chartOf(useStore).getState().setChartRange({ from: base[0].time - 50 * DAY, to: base[0].time - 20 * DAY })).toBe(false);
    expect(chartOf(useStore).getState().candles).toBe(base);
    expect(useStore.getState().toasts.some((t) => t.text === 'Fewer than 2 bars in the chart range')).toBe(true);
  });

  it('a result arriving after a symbol change or a newer load is dropped', async () => {
    const { useStore, base, setHandler } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setHandler(async (req) => {
      await gate;
      return mk(req.from!, 31);
    });
    const p = chartOf(useStore).getState().setChartRange({ from: base[0].time - 50 * DAY, to: base[0].time - 20 * DAY });
    expect(chartOf(useStore).getState().loadState).toBe('loading');
    chartOf(useStore).setState({ symbol: 'DEMO-BEAR' });
    release();
    expect(await p).toBe(false);
    expect(chartOf(useStore).getState().candles).toBe(base);
    expect(chartOf(useStore).getState().chartRangeFetched).toBe(false);
    expect(useStore.getState().toasts).toHaveLength(0);

    // a newer loadData wins over an older range fetch
    chartOf(useStore).setState({ symbol: 'DEMO' });
    let release2!: () => void;
    const gate2 = new Promise<void>((r) => (release2 = r));
    setHandler(async (req) => {
      if (req.from == null) return base;
      await gate2;
      return mk(req.from, 31);
    });
    const p2 = chartOf(useStore).getState().setChartRange({ from: base[0].time - 50 * DAY, to: base[0].time - 20 * DAY });
    await chartOf(useStore).getState().loadData();
    release2();
    expect(await p2).toBe(false);
    expect(chartOf(useStore).getState().candles).toBe(base);
    expect(chartOf(useStore).getState().chartRange).toBeNull();
    expect(chartOf(useStore).getState().loadState).toBe('ready');
  });

  it('partial coverage adds an inbox warning and an info toast naming the first date', async () => {
    const { useStore, base, setHandler } = await setup();
    const from = base[0].time - 50 * DAY;
    setHandler(async () => mk(from + 10 * DAY, 21));
    useStore.setState({ timeZone: 'UTC' });
    expect(await chartOf(useStore).getState().setChartRange({ from, to: from + 30 * DAY })).toBe(true);
    const s = snap(useStore);
    expect(s.messages.filter((m) => m.severity === 'warning')).toHaveLength(1);
    const firstDate = fmtTime(from + 10 * DAY, { timeZone: 'UTC' });
    expect(s.messages.find((m) => m.severity === 'warning')!.text).toContain(`only from ${firstDate}`);
    expect(s.toasts.filter((t) => t.kind === 'info')).toHaveLength(1);
  });

  it('a local dataset refuses with the dataset wording and no request', async () => {
    const { useStore, base, calls } = await setup();
    chartOf(useStore).setState({ activeDatasetId: 'local' });
    expect(await chartOf(useStore).getState().setChartRange({ from: base[0].time - 50 * DAY, to: base[0].time - 20 * DAY })).toBe(false);
    expect(calls).toHaveLength(0);
    expect(useStore.getState().toasts.some((t) => t.text === 'Range is outside this dataset')).toBe(true);
  });
});


describe('replay', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  async function setup() {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { candlesFromCsvText } = await import('../lib/csv');
    const text = readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8');
    const candles = candlesFromCsvText(text).candles;
    const { useStore } = await import('./store');
    track(useStore);
    chartOf(useStore).setState({ candles });
    return { useStore, candles };
  }
  type Store = Awaited<ReturnType<typeof setup>>['useStore'];

  const start = (useStore: Store, index: number, candles: { time: number }[]) => {
    chartOf(useStore).getState().startReplayPick();
    expect(chartOf(useStore).getState().replay?.phase).toBe('picking');
    expect(chartOf(useStore).getState().startReplayAt(candles[index].time)).toBe(true);
  };

  /** A Worker whose pine runs take `delayMs` and queue one after another, like the real single worker. */
  function stubSlowWorker(delayMs: number, onRun?: (source: string) => void) {
    class FakeWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      private tail: Promise<void> = Promise.resolve();
      postMessage(req: { id: string; type: string; source: string; candles: Candle[]; inputs: Record<string, unknown> }) {
        onRun?.(req.source);
        this.tail = this.tail.then(async () => {
          const { runPine } = await import('../lib/pine/runtime');
          const outcome = await runPine(req.source, req.candles, req.inputs as never);
          await new Promise((r) => setTimeout(r, delayMs));
          this.onmessage?.({ data: { id: req.id, type: 'pineResult', outcome } } as MessageEvent);
        });
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
  }

  it('lands Pine results while a replay plays, even when a run is slower than the tick', async () => {
    stubSlowWorker(150);
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().addIndicator('pine');
    chartOf(useStore).getState().addIndicator('pine');
    const ids = chartOf(useStore).getState().indicators.filter((i) => i.kind === 'pine').map((i) => i.id);
    chartOf(useStore).getState().updateIndicator(ids[1], { source: '//@version=5\nindicator("rsi", overlay=false)\nplot(ta.rsi(close, 14))\n' });
    await vi.waitFor(() => {
      for (const id of ids) expect(chartOf(useStore).getState().pineRuns[id]?.running).toBe(false);
    }, { timeout: 20000 });
    start(useStore, 40, candles);
    chartOf(useStore).getState().setReplaySpeed(10);
    chartOf(useStore).getState().playReplay();
    await vi.waitFor(() => {
      const s = snap(useStore);
      expect(s.replay!.playing).toBe(true);
      for (const id of ids) {
        const run = s.pineRuns[id];
        expect(run.candles!.length).toBeGreaterThan(41);
        expect(run.candles!.length).toBeLessThanOrEqual(s.candles.length);
      }
    }, { timeout: 15000 });
    chartOf(useStore).getState().pauseReplay();
  }, 30000);

  it('drops a run whose source changed while it was in flight', async () => {
    stubSlowWorker(100);
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().addIndicator('pine');
    const id = chartOf(useStore).getState().indicators.find((i) => i.kind === 'pine')!.id;
    await vi.waitFor(() => expect(chartOf(useStore).getState().pineRuns[id]?.running).toBe(false), { timeout: 20000 });
    start(useStore, 40, candles);
    await vi.waitFor(() => expect(chartOf(useStore).getState().pineRuns[id]?.running).toBe(false), { timeout: 20000 });
    chartOf(useStore).getState().stepReplay(1);
    const src = '//@version=5\nindicator("b", overlay=false)\nplot(ta.rsi(close, 14), title="NEWSRC")\n';
    chartOf(useStore).getState().updateIndicator(id, { source: src });
    const before = chartOf(useStore).getState().pineRuns[id].result;
    await vi.waitFor(() => {
      const r = chartOf(useStore).getState().pineRuns[id];
      expect(!r.running && r.result !== before).toBe(true);
      expect(r.result!.plots[0].name).toBe('NEWSRC');
    }, { timeout: 20000 });
  }, 30000);

  it('does not store a run longer than the visible bars after stepping back', async () => {
    stubSlowWorker(100);
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().addIndicator('pine');
    const id = chartOf(useStore).getState().indicators.find((i) => i.kind === 'pine')!.id;
    await vi.waitFor(() => expect(chartOf(useStore).getState().pineRuns[id]?.running).toBe(false), { timeout: 20000 });
    start(useStore, 40, candles);
    chartOf(useStore).getState().stepReplay(-5);
    const seen: number[] = [];
    const unsub = chartOf(useStore).subscribe((s) => {
      const r = s.pineRuns[id];
      if (r?.candles && r.candles.length > s.candles.length && r.candles.length < candles.length) seen.push(r.candles.length);
    });
    await vi.waitFor(() => {
      const r = chartOf(useStore).getState().pineRuns[id];
      expect(!r.running && r.candles!.length === chartOf(useStore).getState().candles.length).toBe(true);
    }, { timeout: 20000 });
    unsub();
    expect(seen).toEqual([]);
  }, 30000);

  it('shows only the bars up to the picked time and keeps the source', async () => {
    const { useStore, candles } = await setup();
    start(useStore, 40, candles);
    const s = snap(useStore);
    expect(s.replay).toMatchObject({ phase: 'active', cursor: 40, playing: false, speed: 1 });
    expect(s.replay!.source).toBe(candles);
    expect(s.candles).toEqual(candles.slice(0, 41));
    expect(s.candles.at(-1)!.time).toBeLessThanOrEqual(candles[40].time + 1);
  });

  it('picks the last bar at or before a time between bars and refuses one outside the data', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().startReplayPick();
    expect(chartOf(useStore).getState().startReplayAt(candles[0].time - 1)).toBe(false);
    expect(chartOf(useStore).getState().replay?.phase).toBe('picking');
    expect(useStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true);
    expect(chartOf(useStore).getState().startReplayAt(candles[10].time + 5)).toBe(true);
    expect(chartOf(useStore).getState().replay!.cursor).toBe(10);
  });

  it('cancelReplay leaves the picking phase and does nothing once active', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().startReplayPick();
    chartOf(useStore).getState().cancelReplay();
    expect(chartOf(useStore).getState().replay).toBeNull();
    start(useStore, 10, candles);
    chartOf(useStore).getState().cancelReplay();
    expect(chartOf(useStore).getState().replay?.phase).toBe('active');
  });

  it('reselectReplayStart returns to picking with all bars, then restarts at an earlier bar', async () => {
    const { useStore, candles } = await setup();
    start(useStore, 40, candles);
    const source = chartOf(useStore).getState().replay!.source;
    chartOf(useStore).getState().setReplaySpeed(10);
    chartOf(useStore).getState().stepReplay(3);
    chartOf(useStore).getState().reselectReplayStart();
    const rp = chartOf(useStore).getState().replay!;
    expect(rp.phase).toBe('picking');
    expect(rp.resumeCursor).toBe(43);
    expect(chartOf(useStore).getState().candles).toBe(source);
    expect(chartOf(useStore).getState().startReplayAt(source[20].time)).toBe(true);
    const after = chartOf(useStore).getState().replay!;
    expect(after.phase).toBe('active');
    expect(after.cursor).toBe(20);
    expect(after.speed).toBe(10);
    expect(after.resumeCursor).toBeUndefined();
    expect(chartOf(useStore).getState().candles).toEqual(source.slice(0, 21));
  });

  it('reselectReplayStart stops playback', async () => {
    vi.useFakeTimers();
    try {
      const { useStore, candles } = await setup();
      start(useStore, 20, candles);
      chartOf(useStore).getState().playReplay();
      vi.advanceTimersByTime(1500);
      chartOf(useStore).getState().reselectReplayStart();
      const cursor = chartOf(useStore).getState().replay!.cursor;
      vi.advanceTimersByTime(5000);
      expect(chartOf(useStore).getState().replay!.cursor).toBe(cursor);
      expect(chartOf(useStore).getState().replay!.playing).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelReplay after reselecting resumes the replay where it was', async () => {
    const { useStore, candles } = await setup();
    start(useStore, 40, candles);
    chartOf(useStore).getState().setReplaySpeed(10);
    chartOf(useStore).getState().stepReplay(2);
    chartOf(useStore).getState().reselectReplayStart();
    chartOf(useStore).getState().cancelReplay();
    const rp = chartOf(useStore).getState().replay!;
    expect(rp.phase).toBe('active');
    expect(rp.cursor).toBe(42);
    expect(rp.playing).toBe(false);
    expect(rp.speed).toBe(10);
    expect(rp.resumeCursor).toBeUndefined();
    expect(chartOf(useStore).getState().candles).toEqual(rp.source.slice(0, 43));
  });

  it('keeps live bars that arrive while re-picking', async () => {
    const { useStore, candles } = await setup();
    const { getProvider } = await import('../lib/providers');
    const provider = getProvider('binance');
    const orig = provider.startLive;
    let opts: Parameters<NonNullable<typeof provider.startLive>>[0] | undefined;
    provider.startLive = (o) => {
      opts = o;
      return { stop() {} };
    };
    try {
      chartOf(useStore).getState().setLive(true);
      start(useStore, 30, candles);
      chartOf(useStore).getState().reselectReplayStart();
      const last = candles.at(-1)!;
      const next = { ...last, time: last.time + 86400, close: 123 };
      opts!.onKline(next, true);
      expect(chartOf(useStore).getState().candles).toHaveLength(candles.length + 1);
      chartOf(useStore).getState().cancelReplay();
      expect(chartOf(useStore).getState().replay!.source).toHaveLength(candles.length + 1);
      chartOf(useStore).getState().reselectReplayStart();
      expect(chartOf(useStore).getState().startReplayAt(candles[10].time)).toBe(true);
      expect(chartOf(useStore).getState().replay!.source).toHaveLength(candles.length + 1);
      chartOf(useStore).getState().setLive(false);
    } finally {
      provider.startLive = orig;
    }
  });

  it('exitReplay from a re-pick leaves replay with the full bars; reselect is a no-op otherwise', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().reselectReplayStart();
    expect(chartOf(useStore).getState().replay).toBeNull();
    chartOf(useStore).getState().startReplayPick();
    chartOf(useStore).getState().reselectReplayStart();
    expect(chartOf(useStore).getState().replay!.resumeCursor).toBeUndefined();
    chartOf(useStore).getState().cancelReplay();
    start(useStore, 30, candles);
    chartOf(useStore).getState().reselectReplayStart();
    chartOf(useStore).getState().exitReplay();
    expect(chartOf(useStore).getState().replay).toBeNull();
    expect(chartOf(useStore).getState().candles).toBe(candles);
  });

  it('steps within the bounds and pauses play', async () => {
    const { useStore, candles } = await setup();
    start(useStore, 20, candles);
    chartOf(useStore).getState().stepReplay(1);
    expect(chartOf(useStore).getState().candles).toHaveLength(22);
    chartOf(useStore).getState().stepReplay(-3);
    expect(chartOf(useStore).getState().candles).toHaveLength(19);
    chartOf(useStore).getState().stepReplay(-1000);
    expect(chartOf(useStore).getState().candles).toHaveLength(2);
    chartOf(useStore).getState().stepReplay(100000);
    expect(chartOf(useStore).getState().candles).toHaveLength(candles.length);
  });

  it('plays at the chosen speed, takes a speed change on the next tick and stops at the last bar', async () => {
    vi.useFakeTimers();
    const { useStore, candles } = await setup();
    start(useStore, candles.length - 20, candles);
    const base = chartOf(useStore).getState().candles.length;
    chartOf(useStore).getState().setReplaySpeed(3);
    chartOf(useStore).getState().playReplay();
    expect(chartOf(useStore).getState().replay!.playing).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(chartOf(useStore).getState().candles).toHaveLength(base + 3);
    chartOf(useStore).getState().setReplaySpeed(10);
    vi.advanceTimersByTime(334); // the pending 3x tick, then 10x ticks follow
    const after = chartOf(useStore).getState().candles.length;
    expect(after).toBeGreaterThanOrEqual(base + 4);
    vi.advanceTimersByTime(1000);
    expect(chartOf(useStore).getState().candles.length).toBeGreaterThan(after + 8);
    vi.advanceTimersByTime(10_000);
    expect(chartOf(useStore).getState().candles).toHaveLength(candles.length);
    expect(chartOf(useStore).getState().replay!.playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pause stops the timer and a step pauses play', async () => {
    vi.useFakeTimers();
    const { useStore, candles } = await setup();
    start(useStore, 20, candles);
    chartOf(useStore).getState().playReplay();
    vi.advanceTimersByTime(1000);
    expect(chartOf(useStore).getState().candles).toHaveLength(22);
    chartOf(useStore).getState().pauseReplay();
    vi.advanceTimersByTime(5000);
    expect(chartOf(useStore).getState().candles).toHaveLength(22);
    chartOf(useStore).getState().playReplay();
    chartOf(useStore).getState().stepReplay(1);
    expect(chartOf(useStore).getState().replay!.playing).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(chartOf(useStore).getState().candles).toHaveLength(23);
  });

  it('runs Pine on the visible bars only, on every step', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).getState().addIndicator('pine');
    const id = chartOf(useStore).getState().indicators.find((i) => i.kind === 'pine')!.id;
    await vi.waitFor(() => expect(chartOf(useStore).getState().pineRuns[id]?.candles).toHaveLength(candles.length), { timeout: 20000 });
    start(useStore, 30, candles);
    await vi.waitFor(() => expect(chartOf(useStore).getState().pineRuns[id]?.candles).toHaveLength(31), { timeout: 20000 });
    chartOf(useStore).getState().stepReplay(1);
    await vi.waitFor(() => expect(chartOf(useStore).getState().pineRuns[id]?.candles).toHaveLength(32), { timeout: 20000 });
    expect(chartOf(useStore).getState().pineRuns[id].result!.plots[0].values).toHaveLength(32);
  });

  it('backtests, optimizes, saves and reads Pine inputs on the full bars, and a step keeps the results', async () => {
    const { useStore, candles } = await setup();
    await chartOf(useStore).getState().runBacktest();
    const result = chartOf(useStore).getState().btResult;
    expect(result).not.toBeNull();
    start(useStore, 30, candles);
    chartOf(useStore).getState().stepReplay(1);
    expect(chartOf(useStore).getState().btResult).toBe(result);
    await chartOf(useStore).getState().runBacktest();
    const rerun = chartOf(useStore).getState().btResult!;
    expect(rerun.equity[rerun.equity.length - 1].time).toBe(candles.at(-1)!.time);
    expect(chartOf(useStore).getState().candles).toHaveLength(32);
    chartOf(useStore).getState().saveCurrentDataset('full');
    expect(useStore.getState().datasets.at(-1)!.candles).toHaveLength(candles.length);
  });

  it('applies live bars to the source while replaying and shows them after exit', async () => {
    const { useStore, candles } = await setup();
    const { getProvider } = await import('../lib/providers');
    const provider = getProvider('binance');
    const orig = provider.startLive;
    let opts: Parameters<NonNullable<typeof provider.startLive>>[0] | undefined;
    provider.startLive = (o) => {
      opts = o;
      return { stop() {} };
    };
    try {
      chartOf(useStore).getState().setLive(true);
      start(useStore, 30, candles);
      const shown = chartOf(useStore).getState().candles;
      const last = candles.at(-1)!;
      const next = { ...last, time: last.time + 86400, close: 123 };
      opts!.onKline(next, true);
      expect(chartOf(useStore).getState().candles).toBe(shown);
      expect(chartOf(useStore).getState().replay!.source).toHaveLength(candles.length + 1);
      chartOf(useStore).getState().exitReplay();
      expect(chartOf(useStore).getState().candles).toHaveLength(candles.length + 1);
      expect(chartOf(useStore).getState().candles.at(-1)).toEqual(next);
      chartOf(useStore).getState().setLive(false);
    } finally {
      provider.startLive = orig;
    }
  });

  it('exitReplay restores the same candles array', async () => {
    const { useStore, candles } = await setup();
    start(useStore, 30, candles);
    chartOf(useStore).getState().stepReplay(5);
    chartOf(useStore).getState().exitReplay();
    expect(chartOf(useStore).getState().replay).toBeNull();
    expect(chartOf(useStore).getState().candles).toBe(candles);
  });

  it('exit leaves the chart range, full bars and data key untouched', async () => {
    const { useStore, candles } = await setup();
    await chartOf(useStore).getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    const before = snap(useStore);
    const key = before.dataKey;
    start(useStore, 20, before.candles);
    expect(chartOf(useStore).getState().fullCandles).toBe(before.fullCandles);
    expect(chartOf(useStore).getState().dataKey).toBe(key);
    chartOf(useStore).getState().stepReplay(4);
    chartOf(useStore).getState().exitReplay();
    const s = snap(useStore);
    expect(s.candles).toBe(before.candles);
    expect(s.fullCandles).toBe(before.fullCandles);
    expect(s.chartRange).toBe(before.chartRange);
    expect(s.chartRangeFetched).toBe(before.chartRangeFetched);
    expect(s.dataKey).toBe(key);
  });

  it.each([
    ['setChartRange', (s: import('./chart').ChartState, c: { time: number }[]) => void s.setChartRange({ from: c[5].time, to: c[60].time })],
    ['clearData', (s: import('./chart').ChartState) => s.clearData()],
    ['activateDataset', (s: import('./chart').ChartState, c: { time: number }[]) => {
      const id = s.addDataset({ name: 'd', candles: c as never, source: 'csv', description: 'd', barSeconds: 86400, barLabel: '1d' });
      s.activateDataset(id);
    }],
  ])('%s ends replay and stops the timer', async (_name, act) => {
    vi.useFakeTimers();
    const { useStore, candles } = await setup();
    start(useStore, 30, candles);
    chartOf(useStore).getState().playReplay();
    await act(snap(useStore), candles);
    expect(chartOf(useStore).getState().replay).toBeNull();
    const len = chartOf(useStore).getState().candles.length;
    vi.advanceTimersByTime(5000);
    expect(chartOf(useStore).getState().candles).toHaveLength(len);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('loadData ends replay and restores the chart first', async () => {
    const { useStore, candles } = await setup();
    chartOf(useStore).setState({ providerId: 'demo', bars: 200 });
    start(useStore, 30, candles);
    const p = chartOf(useStore).getState().loadData();
    expect(chartOf(useStore).getState().replay).toBeNull();
    expect(chartOf(useStore).getState().candles).toBe(candles);
    await p;
    expect(chartOf(useStore).getState().replay).toBeNull();
  });

  it('setLive(true) exits replay first', async () => {
    const { useStore, candles } = await setup();
    const { getProvider } = await import('../lib/providers');
    const provider = getProvider('binance');
    const orig = provider.startLive;
    provider.startLive = () => ({ stop() {} });
    try {
      start(useStore, 30, candles);
      chartOf(useStore).getState().setLive(true);
      expect(chartOf(useStore).getState().replay).toBeNull();
      expect(chartOf(useStore).getState().candles).toBe(candles);
      chartOf(useStore).getState().setLive(false);
    } finally {
      provider.startLive = orig;
    }
  });

  it('drawing magnet and hide-all: default off, persisted, bad values load as off', async () => {
    const load = async (prefs: Record<string, unknown>) => {
      vi.resetModules();
      localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1h', bars: 100, ...prefs }));
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const st = track((await import('./store')).useStore);
      st.getState().init();
      return st;
    };
    const old = await load({});
    expect(old.getState().drawingMagnet).toBe(false);
    expect(old.getState().drawingsHidden).toBe(false);

    old.getState().setDrawingMagnet(true);
    old.getState().setDrawingsHidden(true);
    old.getState().flushPersist();
    const saved = JSON.parse(localStorage.getItem('vost.prefs.v1')!);
    expect(saved.drawingMagnet).toBe(true);
    expect(saved.drawingsHidden).toBe(true);

    vi.resetModules();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const fresh = track((await import('./store')).useStore);
    fresh.getState().init();
    expect(fresh.getState().drawingMagnet).toBe(true);
    expect(fresh.getState().drawingsHidden).toBe(true);

    const bad = await load({ drawingMagnet: 'yes', drawingsHidden: 1 });
    expect(bad.getState().drawingMagnet).toBe(false);
    expect(bad.getState().drawingsHidden).toBe(false);
  });

  it('drawing magnet strength, lock all and stay mode: defaults, persisted, old and bad values', async () => {
    const load = async (prefs: Record<string, unknown>) => {
      vi.resetModules();
      localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1h', bars: 100, ...prefs }));
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const st = track((await import('./store')).useStore);
      st.getState().init();
      return st;
    };
    const fresh = await load({});
    expect([fresh.getState().drawingMagnetStrength, fresh.getState().drawingsLocked, fresh.getState().drawingStayMode]).toEqual(['weak', false, false]);

    fresh.getState().setDrawingMagnetStrength('strong');
    fresh.getState().setDrawingsLocked(true);
    fresh.getState().setDrawingStayMode(true);
    fresh.getState().flushPersist();
    const saved = JSON.parse(localStorage.getItem('vost.prefs.v1')!);
    expect([saved.drawingMagnetStrength, saved.drawingsLocked, saved.drawingStayMode]).toEqual(['strong', true, true]);
    const back = await load(saved);
    expect([back.getState().drawingMagnetStrength, back.getState().drawingsLocked, back.getState().drawingStayMode]).toEqual(['strong', true, true]);

    const old = await load({ drawingMagnet: true });
    expect([old.getState().drawingMagnet, old.getState().drawingMagnetStrength]).toEqual([true, 'weak']);
    const strong = await load({ drawingMagnet: true, drawingMagnetStrength: 'strong' });
    expect([strong.getState().drawingMagnet, strong.getState().drawingMagnetStrength]).toEqual([true, 'strong']);

    const bad = await load({ drawingMagnetStrength: 'medium', drawingsLocked: 'yes', drawingStayMode: 1 });
    expect([bad.getState().drawingMagnetStrength, bad.getState().drawingsLocked, bad.getState().drawingStayMode]).toEqual(['weak', false, false]);
  });

  it('drawing defaults: persisted per tool, bad or unknown entries load as nothing', async () => {
    const load = async (prefs: Record<string, unknown>) => {
      vi.resetModules();
      localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1h', bars: 100, ...prefs }));
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const st = track((await import('./store')).useStore);
      st.getState().init();
      return st;
    };
    const fresh = await load({});
    expect(fresh.getState().drawingDefaults).toEqual({});
    fresh.getState().setDrawingDefault('trendLine', { width: 3, color: '#ff0000', bogus: 1 });
    fresh.getState().setDrawingDefault('ghost', { width: 3 });
    expect(fresh.getState().drawingDefaults).toEqual({ trendLine: { width: 3, color: '#ff0000' } });
    fresh.getState().flushPersist();
    expect(JSON.parse(localStorage.getItem('vost.prefs.v1')!).drawingDefaults).toEqual({ trendLine: { width: 3, color: '#ff0000' } });

    vi.resetModules();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const again = track((await import('./store')).useStore);
    again.getState().init();
    expect(again.getState().drawingDefaults).toEqual({ trendLine: { width: 3, color: '#ff0000' } });
    again.getState().setDrawingDefault('trendLine', null);
    expect(again.getState().drawingDefaults).toEqual({});

    for (const bad of ['x', 5, [], null, { ghost: { width: 3 }, trendLine: 'x', ray: { width: 'wide' }, rectangle: [] }]) {
      expect((await load({ drawingDefaults: bad })).getState().drawingDefaults).toEqual({});
    }
  });
});


describe('two chart stores stay apart', () => {
  type LiveOpts = { symbol: string; onStatus: (s: 'live') => void; onKline: (c: Candle, closed: boolean) => void };
  const T0 = 1_700_000_000;
  const barAt = (i: number, close: number): Candle => ({ time: T0 + i * 3600, open: close, high: close + 1, low: close - 1, close, volume: 1 });
  /** `n` bars whose closes start at `base`, so each symbol's bars are recognisable. */
  const series = (n: number, base: number) => Array.from({ length: n }, (_, i) => barAt(i, base + (i % 7)));

  function stubEnv() {
    const toasts: Array<{ kind: string; text: string }> = [];
    const messages: Array<{ source: string; text: string }> = [];
    let prefsChanges = 0;
    const env: ChartEnv = {
      pushToast: (kind, text) => void toasts.push({ kind, text }),
      pushMessage: (source, _severity, text) => void messages.push({ source, text }),
      timeZone: () => 'UTC',
      buildTimeframes: () => false,
      datasets: () => [],
      addDataset: () => {},
      removeDataset: () => {},
      onPrefsChange: () => void prefsChanges++,
      onSync: () => {},
    };
    return { env, toasts, messages, prefsChanges: () => prefsChanges };
  }

  /** A faked provider: history by symbol (resolvable by the test) and one live stream per startLive call. */
  function fakeProvider() {
    const history = new Map<string, (() => Promise<Candle[]>)>();
    const streams: Array<{ symbol: string; opts: LiveOpts; stop: ReturnType<typeof vi.fn> }> = [];
    const startLive = vi.fn((opts: LiveOpts) => {
      const stop = vi.fn();
      streams.push({ symbol: opts.symbol, opts, stop });
      opts.onStatus('live');
      return { stop };
    });
    const fetchHistory = vi.fn((req: { symbol: string }) => {
      const h = history.get(req.symbol);
      return h ? h() : Promise.reject(new Error(`no history for ${req.symbol}`));
    });
    vi.spyOn(providersModule, 'getProvider').mockReturnValue({
      ...providersModule.demoProvider,
      id: 'fake',
      name: 'Fake',
      timeframes: ['1h'],
      defaultTimeframe: '1h',
      offline: false,
      supportsLive: true,
      startLive,
      fetchHistory,
    } as never);
    return { history, streams, fetchHistory };
  }

  const make = (id: string, symbol: string, env: ChartEnv) =>
    createChartStore(id, { ...defaultChartInitial(), providerId: 'fake', symbol, timeframe: '1h', bars: 100 }, env);

  afterEach(() => vi.restoreAllMocks());

  it('loads different symbols into separate candles', async () => {
    const p = fakeProvider();
    p.history.set('AAA', async () => series(30, 100));
    p.history.set('BBB', async () => series(40, 500));
    const a = make('a', 'AAA', stubEnv().env);
    const b = make('b', 'BBB', stubEnv().env);
    await Promise.all([a.getState().loadData(), b.getState().loadData()]);
    expect(a.getState().candles).toHaveLength(30);
    expect(b.getState().candles).toHaveLength(40);
    expect(a.getState().candles[0].close).toBe(100);
    expect(b.getState().candles[0].close).toBe(500);
    expect(a.getState().dataKey).not.toBe(b.getState().dataKey);
    expect(a.getState().id).toBe('a');
    expect(b.getState().id).toBe('b');
  });

  it('loadData keeps a custom interval the provider can build and snaps back one it cannot', async () => {
    const p = fakeProvider();
    p.history.set('AAA', async () => series(30, 100));
    const a = make('a', 'AAA', stubEnv().env);
    a.getState().setTimeframe('2h', { load: false });
    await a.getState().loadData();
    expect(a.getState().timeframe).toBe('2h');
    expect(p.fetchHistory).toHaveBeenLastCalledWith(expect.objectContaining({ timeframe: '2h' }));
    a.getState().setTimeframe('10m', { load: false }); // the fake provider's only native timeframe is 1h
    await a.getState().loadData();
    expect(a.getState().timeframe).toBe('1h');
  });

  it('a slow load on one is not dropped when the other loads meanwhile (own request tokens)', async () => {
    const p = fakeProvider();
    let finishA!: (c: Candle[]) => void;
    p.history.set('AAA', () => new Promise<Candle[]>((r) => (finishA = r)));
    p.history.set('BBB', async () => series(40, 500));
    const a = make('a', 'AAA', stubEnv().env);
    const b = make('b', 'BBB', stubEnv().env);
    const loadingA = a.getState().loadData();
    await b.getState().loadData();
    finishA(series(30, 100));
    await loadingA;
    expect(a.getState().loadState).toBe('ready');
    expect(a.getState().candles).toHaveLength(30);
    expect(b.getState().candles).toHaveLength(40);
  });

  it('within one chart a stale load is still dropped', async () => {
    const p = fakeProvider();
    let finishOld!: (c: Candle[]) => void;
    p.history.set('AAA', () => new Promise<Candle[]>((r) => (finishOld = r)));
    const a = make('a', 'AAA', stubEnv().env);
    const old = a.getState().loadData();
    p.history.set('AAA', async () => series(35, 100));
    await a.getState().loadData();
    finishOld(series(10, 1));
    await old;
    expect(a.getState().candles).toHaveLength(35);
  });

  it('keeps live streams apart: a kline reaches only its own chart and stopping one leaves the other streaming', async () => {
    const p = fakeProvider();
    p.history.set('AAA', async () => series(30, 100));
    p.history.set('BBB', async () => series(40, 500));
    const a = make('a', 'AAA', stubEnv().env);
    const b = make('b', 'BBB', stubEnv().env);
    await Promise.all([a.getState().loadData(), b.getState().loadData()]);
    expect(p.streams.map((s) => s.symbol)).toEqual(['AAA', 'BBB']); // each chart went live on its own after loading
    const [sa, sb] = p.streams;
    const lastA = a.getState().candles.at(-1)!;
    const bBefore = b.getState().candles;
    sa.opts.onKline({ ...lastA, close: 999 }, false);
    expect(a.getState().candles.at(-1)!.close).toBe(999);
    expect(b.getState().candles).toBe(bBefore);
    sb.opts.onKline(barAt(40, 777), true);
    expect(b.getState().candles).toHaveLength(41);
    expect(a.getState().candles).toHaveLength(30);

    a.getState().setLive(false);
    expect(sa.stop).toHaveBeenCalledOnce();
    expect(sb.stop).not.toHaveBeenCalled();
    expect(a.getState().live).toBe(false);
    expect(b.getState().live).toBe(true);
    expect(b.getState().liveStatus).toBe('live');
    sb.opts.onKline(barAt(41, 888), false);
    expect(b.getState().candles).toHaveLength(42);
    b.getState().setLive(false);
    expect(sb.stop).toHaveBeenCalledOnce();
  });

  it('a replay on one chart leaves the other chart and its timer alone', async () => {
    vi.useFakeTimers();
    const p = fakeProvider();
    p.history.set('AAA', async () => series(600, 100));
    p.history.set('BBB', async () => series(600, 500));
    const a = make('a', 'AAA', stubEnv().env);
    const b = make('b', 'BBB', stubEnv().env);
    await Promise.all([a.getState().loadData(), b.getState().loadData()]);
    a.getState().startReplayPick();
    expect(a.getState().startReplayAt(T0 + 20 * 3600)).toBe(true);
    b.getState().startReplayPick();
    expect(b.getState().startReplayAt(T0 + 30 * 3600)).toBe(true);
    a.getState().playReplay();
    const bCursor = b.getState().replay!.cursor;
    const aCursor = a.getState().replay!.cursor;
    vi.advanceTimersByTime(5_000);
    expect(a.getState().replay!.cursor).toBeGreaterThan(aCursor);
    expect(b.getState().replay!.cursor).toBe(bCursor);
    // pausing the other chart must not clear a's timer, and exiting a does not end b's replay
    b.getState().pauseReplay();
    const mid = a.getState().replay!.cursor;
    vi.advanceTimersByTime(5_000);
    expect(a.getState().replay!.cursor).toBeGreaterThan(mid);
    a.getState().exitReplay();
    expect(a.getState().replay).toBeNull();
    expect(b.getState().replay?.phase).toBe('active');
    expect(b.getState().candles).toHaveLength(bCursor + 1);
    expect(a.getState().candles).toHaveLength(600);
  });

  it('keeps backtest results and Pine runs per chart, and reports through its own env', async () => {
    const p = fakeProvider();
    p.history.set('AAA', async () => series(60, 100));
    p.history.set('BBB', async () => series(60, 500));
    const ea = stubEnv();
    const eb = stubEnv();
    const a = make('a', 'AAA', ea.env);
    const b = make('b', 'BBB', eb.env);
    await Promise.all([a.getState().loadData(), b.getState().loadData()]);
    await a.getState().runBacktest();
    expect(a.getState().btResult).not.toBeNull();
    expect(b.getState().btResult).toBeNull();
    expect(ea.toasts.some((t) => t.kind === 'success')).toBe(true);
    expect(eb.toasts).toEqual([]);

    const id = a.getState().addIndicator('pine');
    expect(ea.prefsChanges()).toBeGreaterThan(0);
    expect(eb.prefsChanges()).toBe(0);
    await vi.waitFor(() => expect(a.getState().pineRuns[id]?.running === false).toBe(true), { timeout: 20000 });
    expect(a.getState().pineRuns[id].result).toBeDefined();
    expect(b.getState().pineRuns).toEqual({});
    expect(b.getState().indicators.some((i) => i.id === id)).toBe(false);
  });

  it('clearing or changing one chart does not touch the other', async () => {
    const p = fakeProvider();
    p.history.set('AAA', async () => series(30, 100));
    p.history.set('BBB', async () => series(40, 500));
    const a = make('a', 'AAA', stubEnv().env);
    const b = make('b', 'BBB', stubEnv().env);
    await Promise.all([a.getState().loadData(), b.getState().loadData()]);
    a.getState().setSymbol('ZZZ');
    a.getState().clearData();
    expect(a.getState().candles).toEqual([]);
    expect(b.getState().symbol).toBe('BBB');
    expect(b.getState().candles).toHaveLength(40);
    expect(b.getState().loadState).toBe('ready');
  });
});

describe('runBacktest progress', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  async function boot() {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { candlesFromCsvText } = await import('../lib/csv');
    const text = readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8');
    const candles = candlesFromCsvText(text).candles;
    const { useStore } = await import('./store');
    track(useStore);
    chartOf(useStore).setState({ candles });
    return { useStore, candles };
  }

  it('btProgress and btStage follow the worker messages and reset when the run ends', async () => {
    const { useStore } = await boot();
    const seen: [number, string | null, boolean][] = [];
    class FakeWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(req: { id: string }) {
        const send = (data: unknown) => this.onmessage?.({ data: { id: req.id, ...(data as object) } });
        const snap = () => {
          const s = chartOf(useStore).getState();
          seen.push([s.btProgress, s.btStage, s.btRunning]);
        };
        queueMicrotask(async () => {
          const { runFullBacktest } = await import('../lib/backtest/runner');
          send({ type: 'progress', pct: 0.3, stage: 'simulating' });
          snap();
          send({ type: 'progress', pct: 0.95, stage: 'metrics' });
          snap();
          send({ type: 'result', result: runFullBacktest(chartOf(useStore).getState().candles, chartOf(useStore).getState().btConfig) });
        });
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    await chartOf(useStore).getState().runBacktest();
    expect(seen).toEqual([
      [0.3, 'simulating', true],
      [0.95, 'metrics', true],
    ]);
    const s = chartOf(useStore).getState();
    expect(s.btRunning).toBe(false);
    expect(s.btStage).toBeNull();
    expect(s.btProgress).toBe(0);
    expect(s.btResult).not.toBeNull();
  });

  it('an error reply clears progress and stage', async () => {
    const { useStore } = await boot();
    class FakeWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(req: { id: string }) {
        queueMicrotask(() => {
          this.onmessage?.({ data: { id: req.id, type: 'progress', pct: 0.5, stage: 'simulating' } });
          this.onmessage?.({ data: { id: req.id, type: 'error', message: 'boom' } });
        });
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    await chartOf(useStore).getState().runBacktest();
    const s = chartOf(useStore).getState();
    expect(s.btRunning).toBe(false);
    expect(s.btError).toBe('boom');
    expect(s.btStage).toBeNull();
    expect(s.btProgress).toBe(0);
  });

  it('the main-thread fallback reports progress too', async () => {
    const { useStore } = await boot();
    vi.stubGlobal('Worker', class { constructor() { throw new Error('no workers'); } });
    const stages = new Set<string>();
    const unsub = chartOf(useStore).subscribe((s) => { if (s.btStage) stages.add(s.btStage); });
    await chartOf(useStore).getState().runBacktest();
    unsub();
    expect([...stages]).toEqual(expect.arrayContaining(['signals', 'simulating', 'metrics']));
    expect(chartOf(useStore).getState().btRunning).toBe(false);
  });
});
