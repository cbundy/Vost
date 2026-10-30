import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from '../types';
import * as providersModule from '../lib/providers';
import { ApiHttpError } from '../lib/providers/api';
import { MAX_BARS } from '../../../shared/market.ts';
import { HISTORY_MAX_BARS, HISTORY_PAGE_BARS, runPageBars, type HistoryLoading } from '../lib/historyPaging';
type Hook = (req: { type: string; candles: { time: number }[] }) => unknown;
const hooks = vi.hoisted(() => ({ workerCall: null as null | Hook, optimizerCall: null as null | Hook }));
vi.mock('./worker', async (orig) => {
  const actual = await orig<typeof import('./worker')>();
  return {
    ...actual,
    workerCall: (req: never, onProgress?: never) => (hooks.workerCall ? hooks.workerCall(req) : actual.workerCall(req, onProgress)),
    optimizerCall: (req: never, onProgress?: never) => (hooks.optimizerCall ? hooks.optimizerCall(req) : actual.optimizerCall(req, onProgress)),
  };
});
import { canPageOlder, createChartStore, defaultChartInitial, type ChartEnv } from './chart';
import type { HistoryRequest } from '../lib/providers/http';

const H = 3600;
const T0 = 1_700_000_000;
const barAt = (i: number): Candle => ({ time: T0 + i * H, open: 10, high: 11, low: 9, close: 10 + (i % 5), volume: 1 });

/** A provider with a long history: bars at indexes [0, total). Honours `bars` and `to`, like the server. */
function setup(opts: { total?: number; mode?: HistoryLoading; build?: boolean } = {}) {
  const total = opts.total ?? 5000;
  const requests: HistoryRequest[] = [];
  const messages: string[] = [];
  const toasts: string[] = [];
  let gate: Promise<void> | null = null;
  let failWith: Error | null = null;
  let onKline: ((c: Candle, closed: boolean) => void) | null = null;
  const fetchHistory = vi.fn(async (req: HistoryRequest) => {
    requests.push(req);
    if (gate) await gate;
    if (failWith) throw failWith;
    const lastIdx = req.to != null ? Math.min(total - 1, Math.floor((req.to - T0) / H)) : total - 1;
    const firstIdx = Math.max(0, lastIdx - req.bars + 1);
    if (lastIdx < 0) throw new ApiHttpError('No data at or before that time', 404);
    return Array.from({ length: lastIdx - firstIdx + 1 }, (_, i) => barAt(firstIdx + i));
  });
  vi.spyOn(providersModule, 'getProvider').mockReturnValue({
    ...providersModule.demoProvider,
    id: 'fake',
    name: 'Fake',
    timeframes: ['1h'],
    defaultTimeframe: '1h',
    offline: false,
    supportsLive: true,
    startLive: (o: { onStatus: (s: 'live') => void; onKline: (c: Candle, closed: boolean) => void }) => {
      onKline = o.onKline;
      o.onStatus('live');
      return { stop() {} };
    },
    fetchHistory,
  } as never);
  let mode: HistoryLoading = opts.mode ?? 'scroll';
  const env: ChartEnv = {
    pushToast: (_k, text) => void toasts.push(text),
    pushMessage: (_s, _sev, text) => void messages.push(text),
    timeZone: () => 'UTC',
    buildTimeframes: () => opts.build === true,
    historyLoading: () => mode,
    datasets: () => [],
    addDataset: () => {},
    removeDataset: () => {},
    onPrefsChange: () => {},
    onSync: () => {},
  };
  const store = createChartStore('c', { ...defaultChartInitial(), providerId: 'fake', symbol: 'AAA', timeframe: '1h', bars: 300 }, env);
  return {
    store,
    requests,
    messages,
    toasts,
    fetchHistory,
    setMode: (m: HistoryLoading) => (mode = m),
    hold() {
      let open!: () => void;
      gate = new Promise<void>((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
    fail: (e: Error | null) => (failWith = e),
    tick: (c: Candle) => onKline!(c, false),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('history paging', () => {
  it('scroll mode opens on one 1000-bar page; all mode asks for the saved Bars value', async () => {
    const a = setup();
    await a.store.getState().loadData();
    expect(a.requests[0]).toMatchObject({ bars: 1000 });
    expect(a.store.getState().candles).toHaveLength(1000);
    const b = setup({ mode: 'all' });
    await b.store.getState().loadData();
    expect(b.requests[0]).toMatchObject({ bars: 300 });
    expect(b.requests[0].to).toBeUndefined();
  });

  it('loadOlder prepends the page before the first bar, keeping the series, dataKey and backtest result', async () => {
    const t = setup();
    await t.store.getState().loadData();
    const key = t.store.getState().dataKey;
    const btResult = { trades: [] } as never;
    t.store.setState({ btResult });
    const first = t.store.getState().candles[0].time;
    expect(await t.store.getState().loadOlder()).toBe('loaded');
    expect(t.requests[1]).toMatchObject({ bars: 1000, to: first - 1 });
    const s = t.store.getState();
    expect(s.candles).toHaveLength(2000);
    expect(s.candles[0].time).toBe(T0 + 3000 * H);
    expect(s.candles.every((c, i) => i === 0 || c.time > s.candles[i - 1].time)).toBe(true);
    expect(s.dataKey).toBe(key);
    expect(s.btResult).toBe(btResult);
    expect(s.olderLoading).toBe(false);
  });

  it('passes the built source like the first load', async () => {
    const t = setup({ build: true });
    await t.store.getState().loadData();
    await t.store.getState().loadOlder();
    expect(t.requests[0].source).toBe('built');
    expect(t.requests[1].source).toBe('built');
  });

  it('two calls while one page is in flight make one request', async () => {
    const t = setup();
    await t.store.getState().loadData();
    const release = t.hold();
    const p1 = t.store.getState().loadOlder();
    const p2 = t.store.getState().loadOlder();
    expect(t.store.getState().olderLoading).toBe(true);
    release();
    expect(await p1).toBe('loaded');
    expect(await p2).toBe('loaded');
    expect(t.requests).toHaveLength(2);
  });

  it.each([
    ['symbol', (s: ReturnType<typeof setup>['store']) => s.getState().setSymbol('BBB', { load: false })],
    ['timeframe', (s: ReturnType<typeof setup>['store']) => s.getState().setTimeframe('4h', { load: false })],
    ['provider', (s: ReturnType<typeof setup>['store']) => s.setState({ providerId: 'other' })],
    ['a newer load', (s: ReturnType<typeof setup>['store']) => void s.getState().loadData()],
  ])('drops a page that arrives after a %s change', async (_n, change) => {
    const t = setup();
    await t.store.getState().loadData();
    const release = t.hold();
    const p = t.store.getState().loadOlder();
    change(t.store);
    const before = t.store.getState().candles;
    release();
    expect(await p).toBe('skipped');
    await vi.waitFor(() => expect(t.store.getState().olderLoading).toBe(false));
    expect(t.store.getState().candles.length).toBeLessThanOrEqual(1000);
    expect(t.store.getState().candles.length).toBe(before.length);
  });

  it('drops a page that arrives after a chart range or a replay started', async () => {
    const t = setup();
    await t.store.getState().loadData();
    const bars = t.store.getState().candles;
    const release = t.hold();
    const p = t.store.getState().loadOlder();
    t.store.getState().startReplayPick();
    t.store.getState().startReplayAt(bars[500].time);
    expect(t.store.getState().replay).not.toBeNull();
    release();
    expect(await p).toBe('skipped');
    expect(t.store.getState().replay?.source).toHaveLength(1000);
  });

  it('never pages a dataset, a chart range, a replay or all mode', async () => {
    const t = setup();
    await t.store.getState().loadData();
    expect(t.requests).toHaveLength(1);
    t.store.setState({ activeDatasetId: 'ds' });
    expect(await t.store.getState().loadOlder()).toBe('skipped');
    t.store.setState({ activeDatasetId: null, chartRange: { from: 1, to: 2 } });
    expect(await t.store.getState().loadOlder()).toBe('skipped');
    t.store.setState({ chartRange: null });
    t.store.getState().startReplayPick();
    expect(await t.store.getState().loadOlder()).toBe('skipped'); // picking a start bar
    t.store.getState().startReplayAt(t.store.getState().candles[10].time);
    expect(await t.store.getState().loadOlder()).toBe('skipped');
    t.store.getState().exitReplay();
    t.setMode('all');
    expect(await t.store.getState().loadOlder()).toBe('skipped');
    expect(t.requests).toHaveLength(1);
    expect(canPageOlder(t.store.getState(), 'all')).toBe(false);
    expect(canPageOlder(t.store.getState(), 'scroll')).toBe(true);
  });

  it('a 404 or a reply with nothing older sets the history start and paging stops', async () => {
    const t = setup({ total: 1000 });
    await t.store.getState().loadData();
    expect(await t.store.getState().loadOlder()).toBe('start'); // the next page lies before bar 0: the fake answers 404
    expect(t.store.getState().historyStart).toBe(true);
    expect(await t.store.getState().loadOlder()).toBe('skipped');
    expect(t.requests).toHaveLength(2);
    expect(canPageOlder(t.store.getState(), 'scroll')).toBe(false);

    const u = setup();
    await u.store.getState().loadData();
    u.fetchHistory.mockImplementationOnce(async () => []);
    expect(await u.store.getState().loadOlder()).toBe('start');
    expect(u.store.getState().historyStart).toBe(true);
    await u.store.getState().loadData(); // a new series pages again
    expect(u.store.getState().historyStart).toBe(false);
  });

  it('any other error is one inbox message and no retry until the next call', async () => {
    const t = setup();
    await t.store.getState().loadData();
    t.fail(new Error('upstream down'));
    expect(await t.store.getState().loadOlder()).toBe('error');
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]).toContain('upstream down');
    expect(t.requests).toHaveLength(2);
    expect(t.store.getState().historyStart).toBe(false);
    expect(t.store.getState().olderLoading).toBe(false);
    t.fail(null);
    expect(await t.store.getState().loadOlder()).toBe('loaded');
    expect(t.requests).toHaveLength(3);
  });

  it('a live tick during an in-flight page keeps both the tick and the page', async () => {
    const t = setup();
    await t.store.getState().loadData();
    t.store.getState().setLive(true);
    const release = t.hold();
    const p = t.store.getState().loadOlder();
    const last = t.store.getState().candles.at(-1)!;
    t.tick({ ...last, time: last.time + H, close: 77 });
    release();
    await p;
    const c = t.store.getState().candles;
    expect(c).toHaveLength(2001);
    expect(c.at(-1)).toMatchObject({ time: last.time + H, close: 77 });
    expect(c[0].time).toBe(T0 + 3000 * H);
  });

  it('loadHistoryTo pages until the time is covered, then stops', async () => {
    const t = setup();
    await t.store.getState().loadData();
    expect(await t.store.getState().loadHistoryTo(T0 + 2500 * H)).toBe('covered');
    expect(t.store.getState().candles[0].time).toBeLessThanOrEqual(T0 + 2500 * H);
    expect(t.requests).toHaveLength(3);
    expect(await t.store.getState().loadHistoryTo(T0 - 10 * H)).toBe('start'); // before the very first bar: ends at the history start
    expect(t.store.getState().historyStart).toBe(true);
    expect(t.store.getState().candles).toHaveLength(5000);
  });

  it('stops paging at the loaded-bars cap', async () => {
    const t = setup();
    await t.store.getState().loadData();
    t.store.setState({ candles: Array.from({ length: HISTORY_MAX_BARS }, (_, i) => barAt(i + 10000)) });
    expect(await t.store.getState().loadOlder()).toBe('skipped');
    expect(t.requests).toHaveLength(1);
  });

  it('the chart range fetch asks for MAX_BARS in scroll mode and the saved value in all mode', async () => {
    const t = setup();
    await t.store.getState().loadData();
    const range = { from: T0 - 5 * H, to: T0 + 3 * H };
    await t.store.getState().setChartRange(range);
    expect(t.requests.at(-1)).toMatchObject({ bars: MAX_BARS, from: range.from });
    const u = setup({ mode: 'all' });
    await u.store.getState().loadData();
    await u.store.getState().setChartRange(range);
    expect(u.requests.at(-1)).toMatchObject({ bars: 300 });
  });
});

describe('loadHistoryTo outcomes', () => {
  it('says error on a failed page and skipped when nothing can be paged', async () => {
    const t = setup();
    await t.store.getState().loadData();
    t.fail(new Error('boom'));
    expect(await t.store.getState().loadHistoryTo(T0 + 100 * H)).toBe('error');
    const d = setup({ mode: 'all' });
    await d.store.getState().loadData();
    expect(await d.store.getState().loadHistoryTo(T0)).toBe('skipped');
  });
  it('passes pageBars to the request', async () => {
    const t = setup({ total: 50000 });
    await t.store.getState().loadData();
    const first = t.store.getState().candles[0].time;
    await t.store.getState().loadHistoryTo(first - 2000 * H, { pageBars: 2500 });
    expect(t.requests[1]).toMatchObject({ bars: 2500, to: first - 1 });
  });
});

describe('runs that need older history', () => {
  type Sent = { type: string; candles: { time: number }[] };
  /** Records the candles each backtest or optimizer call gets and answers with an empty result. */
  function fakeWorker() {
    const sent: Sent[] = [];
    hooks.workerCall = async (req: Sent) => {
      sent.push(req);
      return { id: 'r', type: 'result', result: { trades: [], equity: [], metrics: {} } };
    };
    hooks.optimizerCall = (req: Sent) => {
      sent.push(req);
      return {
        promise: Promise.resolve({ id: 'r', type: 'optimizeResult', rows: [], keys: [], metric: 'sharpe', combos: 0, errored: 0 }),
        cancel() {},
      };
    };
    return sent;
  }
  afterEach(() => {
    hooks.workerCall = null;
    hooks.optimizerCall = null;
  });

  async function loaded(opts: Parameters<typeof setup>[0] = {}) {
    const t = setup({ total: 50000, ...opts });
    await t.store.getState().loadData();
    const first = t.store.getState().candles[0].time;
    return { t, first, from: first - 5000 * H };
  }

  it('runPageBars covers the gap within one scroll page and MAX_BARS', () => {
    expect(runPageBars('1h', 100 * H, 200 * H)).toBe(HISTORY_PAGE_BARS);
    expect(runPageBars('1h', 0, 5000 * H)).toBe(5000);
    expect(runPageBars('1h', 0, 90000 * H)).toBe(MAX_BARS);
  });

  it('runBacktest loads the missing history, tests from From and moves the chart', async () => {
    const sent = fakeWorker();
    const { t, first, from } = await loaded();
    t.store.getState().setBtRange({ from, to: null });
    await t.store.getState().runBacktest();
    expect(t.requests[1]).toMatchObject({ bars: 5000, to: first - 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].candles[0].time).toBe(from);
    expect(sent[0].candles.at(-1)!.time).toBe(T0 + 49999 * H);
    const v = t.store.getState().viewRequest!;
    expect(v).toMatchObject({ from, to: T0 + 49999 * H });
    expect(t.store.getState().btRunning).toBe(false);
    t.store.getState().clearViewRequest();
    expect(t.store.getState().viewRequest).toBeNull();
  });

  it('runOptimizer loads the missing history and its context starts at From', async () => {
    const sent = fakeWorker();
    const { t, first, from } = await loaded();
    t.store.getState().setBtRange({ from, to: null });
    await t.store.getState().runOptimizer();
    expect(t.requests[1]).toMatchObject({ bars: 5000, to: first - 1 });
    expect(sent[0].candles[0].time).toBe(from);
    expect(t.store.getState().optResult!.context.rangeFrom).toBe(from);
    expect(t.store.getState().viewRequest).toMatchObject({ from });
    expect(t.store.getState().optStage).toBeNull();
  });

  it('a range inside the loaded bars loads nothing and does not move the chart', async () => {
    const sent = fakeWorker();
    const { t, first } = await loaded();
    t.store.getState().setBtRange({ from: first + 10 * H, to: null });
    await t.store.getState().runBacktest();
    await t.store.getState().runOptimizer();
    expect(t.requests).toHaveLength(1);
    expect(sent).toHaveLength(2);
    expect(sent[0].candles[0].time).toBe(first + 10 * H);
    expect(t.store.getState().viewRequest).toBeNull();
  });

  it('all mode loads nothing', async () => {
    const sent = fakeWorker();
    const { t, from } = await loaded({ mode: 'all' });
    t.store.getState().setBtRange({ from, to: null });
    await t.store.getState().runBacktest();
    expect(t.requests).toHaveLength(1);
    expect(t.store.getState().viewRequest).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('a failed load ends the run with one toast, no worker call and keeps the previous optimizer result', async () => {
    const sent = fakeWorker();
    const { t, from } = await loaded();
    const previous = { rows: [] } as never;
    t.store.setState({ optResult: previous });
    t.store.getState().setBtRange({ from, to: null });
    t.fail(new Error('down'));
    await t.store.getState().runBacktest();
    await t.store.getState().runOptimizer();
    expect(sent).toHaveLength(0);
    expect(t.store.getState().btResult).toBeNull();
    expect(t.toasts.filter((x) => /could not load history/.test(x))).toHaveLength(2);
    expect(t.toasts.filter((x) => /^Backtest could not load history from/.test(x))).toHaveLength(1);
    expect(t.store.getState().btRunning).toBe(false);
    expect(t.store.getState().optRunning).toBe(false);
    expect(t.store.getState().optResult).toBe(previous);
    expect(t.store.getState().viewRequest).toBeNull();
  });

  it('a timeframe change during the load drops the run', async () => {
    const sent = fakeWorker();
    const { t, from } = await loaded();
    t.store.getState().setBtRange({ from, to: null });
    const release = t.hold();
    const p = t.store.getState().runBacktest();
    expect(t.store.getState().btStage).toBe('history');
    t.store.getState().setTimeframe('1h', { load: false });
    t.store.getState().clearData();
    release();
    await p;
    expect(sent).toHaveLength(0);
    expect(t.store.getState().btResult).toBeNull();
    expect(t.toasts.some((x) => /^Backtest could not load history/.test(x))).toBe(true);
    expect(t.store.getState().btRunning).toBe(false);
  });

  it('Cancel during the load ends the optimizer run at once and keeps the previous result', async () => {
    const sent = fakeWorker();
    const { t, from } = await loaded();
    const previous = { rows: [] } as never;
    t.store.setState({ optResult: previous });
    t.store.getState().setBtRange({ from, to: null });
    const release = t.hold();
    const p = t.store.getState().runOptimizer();
    expect(t.store.getState().optStage).toBe('history');
    expect(t.store.getState().optRunning).toBe(true);
    void t.store.getState().runOptimizer(); // a second Run while loading is ignored
    t.store.getState().cancelOptimizer();
    expect(t.store.getState().optRunning).toBe(false);
    release();
    await p;
    expect(sent).toHaveLength(0);
    expect(t.store.getState().optResult).toBe(previous);
    expect(t.requests).toHaveLength(2);
  });

  it('runs on what exists when the history starts after From, and still moves the chart', async () => {
    const sent = fakeWorker();
    const { t, first } = await loaded({ total: 50000 });
    // the provider's history starts 1200 bars before the first loaded bar
    const origin = (first - T0) / H - 1200;
    const base = t.fetchHistory.getMockImplementation()!;
    t.fetchHistory.mockImplementation(async (req) => (await base(req)).filter((c) => c.time >= T0 + origin * H));
    t.store.getState().setBtRange({ from: first - 5000 * H, to: null });
    await t.store.getState().runBacktest();
    expect(sent[0].candles[0].time).toBe(T0 + origin * H);
    expect(t.store.getState().historyStart).toBe(true);
    expect(t.store.getState().viewRequest).toMatchObject({ from: T0 + origin * H });
  });
});
