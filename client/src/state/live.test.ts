import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from './store';
import { chartOf, snap } from './stateTestKit';
import * as providers from '../lib/providers';
import type { Candle } from '../types';

afterEach(() => vi.restoreAllMocks());

describe('setLive', () => {
  it('starts the stream through the provider and stops it', () => {
    const stop = vi.fn();
    const startLive = vi.fn((o: { onStatus: (s: 'live') => void }) => {
      o.onStatus('live');
      return { stop };
    });
    vi.spyOn(providers, 'getProvider').mockReturnValue({ ...providers.demoProvider, name: 'Fake', supportsLive: true, startLive } as never);
    chartOf(useStore).getState().setLive(true);
    expect(startLive).toHaveBeenCalledOnce();
    expect(chartOf(useStore).getState().liveStatus).toBe('live');
    chartOf(useStore).getState().setLive(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(chartOf(useStore).getState().live).toBe(false);
  });

  it('refuses providers without startLive with a neutral toast', () => {
    vi.spyOn(providers, 'getProvider').mockReturnValue({ ...providers.demoProvider, name: 'Fake' } as never);
    chartOf(useStore).getState().setLive(true);
    expect(chartOf(useStore).getState().live).toBe(false);
    const toasts = useStore.getState().toasts;
    expect(toasts[toasts.length - 1].text).toBe('Live streaming is not available for Fake data.');
  });
});

describe('setLive recovery', () => {
  const bar = (time: number, close = 1): Candle => ({ time, open: 1, high: 2, low: 0.5, close, volume: 1 });
  type Opts = { onStatus: (s: string, d?: string) => void; onKline: (c: Candle, closed: boolean) => void };

  function start(fetchHistory: (req: { symbol: string; timeframe: string; bars: number }) => Promise<Candle[]>) {
    let opts!: Opts;
    const startLive = vi.fn((o: Opts) => {
      opts = o;
      o.onStatus('live');
      return { stop: vi.fn() };
    });
    vi.spyOn(providers, 'getProvider').mockReturnValue({ ...providers.demoProvider, name: 'Fake', supportsLive: true, startLive, fetchHistory } as never);
    return () => opts;
  }

  const hourNow = () => Math.floor(Date.now() / 1000 / 3600) * 3600;

  it('fetches recent history once after reconnecting -> live and merges it with no gap or duplicate', async () => {
    const now = hourNow();
    chartOf(useStore).setState({ timeframe: '1h', symbol: 'BTCUSDT', candles: [bar(now - 7200, 1), bar(now - 3600, 2)] });
    useStore.setState({ messages: [] });
    const fetchHistory = vi.fn(async () => [bar(now - 7200, 1), bar(now - 3600, 22), bar(now, 3)]);
    const opts = start(fetchHistory);
    chartOf(useStore).getState().setLive(true);
    expect(fetchHistory).not.toHaveBeenCalled(); // connecting -> live needs no backfill
    opts().onStatus('reconnecting', 'Connection to the Vost server lost');
    opts().onStatus('live');
    await vi.waitFor(() => expect(chartOf(useStore).getState().candles).toHaveLength(3));
    expect(fetchHistory).toHaveBeenCalledOnce();
    // 1 bar elapsed since the last loaded candle (the current one) + 2
    expect(fetchHistory).toHaveBeenCalledWith({ symbol: 'BTCUSDT', timeframe: '1h', bars: 3 });
    expect(chartOf(useStore).getState().candles.map((c) => [c.time, c.close])).toEqual([[now - 7200, 1], [now - 3600, 22], [now, 3]]);
    // a later kline replaces the last bar
    opts().onKline(bar(now, 4), false);
    expect(chartOf(useStore).getState().candles.map((c) => c.close)).toEqual([1, 22, 4]);
  });

  it('also backfills after the exchange feed gave up (error -> live)', async () => {
    const now = hourNow();
    chartOf(useStore).setState({ timeframe: '1h', candles: [bar(now - 36000, 1)] });
    useStore.setState({ messages: [] });
    const fetchHistory = vi.fn(async (_req: { bars: number }) => [bar(now - 3600, 2), bar(now, 3)]);
    const opts = start(fetchHistory);
    chartOf(useStore).getState().setLive(true);
    opts().onStatus('error', 'Live connection lost');
    opts().onStatus('live');
    await vi.waitFor(() => expect(fetchHistory).toHaveBeenCalledOnce());
    expect(fetchHistory.mock.calls[0][0].bars).toBe(12); // 10 bars elapsed + 2
  });

  it('backfills after a browser-to-server drop that comes back as reconnecting -> connecting -> live', async () => {
    const now = hourNow();
    chartOf(useStore).setState({ timeframe: '1h', candles: [bar(now - 3600, 2)] });
    useStore.setState({ messages: [] });
    const fetchHistory = vi.fn(async () => [bar(now - 3600, 2), bar(now, 3)]);
    const opts = start(fetchHistory);
    chartOf(useStore).getState().setLive(true);
    opts().onStatus('reconnecting');
    opts().onStatus('connecting');
    opts().onStatus('live');
    await vi.waitFor(() => expect(fetchHistory).toHaveBeenCalledOnce());
  });

  it('backfills after live -> connecting -> live (server restart) but not on the first connect', async () => {
    const now = hourNow();
    chartOf(useStore).setState({ timeframe: '1h', candles: [bar(now - 3600, 2)] });
    useStore.setState({ messages: [] });
    const fetchHistory = vi.fn(async () => [bar(now - 3600, 2), bar(now, 3)]);
    const opts = start(fetchHistory);
    chartOf(useStore).getState().setLive(true);
    expect(fetchHistory).not.toHaveBeenCalled();
    opts().onStatus('connecting');
    opts().onStatus('live');
    await vi.waitFor(() => expect(fetchHistory).toHaveBeenCalledOnce());
  });

  it('a failing backfill leaves the candles as they are and writes an inbox line', async () => {
    const now = hourNow();
    const before = [bar(now - 3600, 2)];
    chartOf(useStore).setState({ timeframe: '1h', candles: before });
    useStore.setState({ messages: [] });
    const fetchHistory = vi.fn(async () => {
      throw new Error('upstream down');
    });
    const opts = start(fetchHistory);
    chartOf(useStore).getState().setLive(true);
    opts().onStatus('reconnecting');
    opts().onStatus('live');
    await vi.waitFor(() => expect(useStore.getState().messages.length).toBeGreaterThan(0));
    expect(chartOf(useStore).getState().candles).toBe(before);
    const msg = useStore.getState().messages[useStore.getState().messages.length - 1];
    expect(msg.source).toBe('Live');
    expect(msg.text).toContain('upstream down');
  });

  it('drops a backfill that finishes after the stream was stopped', async () => {
    const now = hourNow();
    const before = [bar(now - 3600, 2)];
    chartOf(useStore).setState({ timeframe: '1h', candles: before });
    useStore.setState({ messages: [] });
    let finish!: (c: Candle[]) => void;
    const fetchHistory = vi.fn(() => new Promise<Candle[]>((r) => (finish = r)));
    const opts = start(fetchHistory);
    chartOf(useStore).getState().setLive(true);
    opts().onStatus('reconnecting');
    opts().onStatus('live');
    chartOf(useStore).getState().setLive(false);
    finish([bar(now - 3600, 2), bar(now, 3)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(chartOf(useStore).getState().candles).toBe(before);
  });
});

describe('setLive backfill on a custom interval', () => {
  it('counts the bars missed with the interval length (2h is 7200 s)', async () => {
    const bar = (time: number): Candle => ({ time, open: 1, high: 2, low: 0.5, close: 1, volume: 1 });
    const now = Math.floor(Date.now() / 1000 / 7200) * 7200;
    chartOf(useStore).setState({ timeframe: '2h', symbol: 'BTCUSDT', candles: [bar(now - 14400), bar(now - 7200)] });
    const fetchHistory = vi.fn(async () => [bar(now - 7200), bar(now)]);
    let opts!: { onStatus: (s: string, d?: string) => void };
    const startLive = vi.fn((o: typeof opts) => {
      opts = o;
      o.onStatus('live');
      return { stop: vi.fn() };
    });
    vi.spyOn(providers, 'getProvider').mockReturnValue({ ...providers.demoProvider, name: 'Fake', supportsLive: true, startLive, fetchHistory } as never);
    chartOf(useStore).getState().setLive(true);
    opts.onStatus('reconnecting');
    opts.onStatus('live');
    await vi.waitFor(() => expect(fetchHistory).toHaveBeenCalledOnce());
    // the last candle is one 2h bar old: 1 elapsed + 2
    expect(fetchHistory).toHaveBeenCalledWith({ symbol: 'BTCUSDT', timeframe: '2h', bars: 3 });
    chartOf(useStore).getState().setLive(false);
  });
});

describe('live by default', () => {
  const bars: Candle[] = Array.from({ length: 5 }, (_, i) => ({ time: 1_700_000_000 + i * 3600, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));
  const streaming = () => {
    const stop = vi.fn();
    const startLive = vi.fn((o: { onStatus: (s: 'live') => void }) => {
      o.onStatus('live');
      return { stop };
    });
    const provider = { ...providers.demoProvider, name: 'Fake', supportsLive: true, startLive, fetchHistory: async () => bars } as never;
    return { startLive, stop, provider };
  };
  const st = () => chartOf(useStore).getState();

  it('starts on its own after the first load, and again on every switch while the choice is on', async () => {
    const { startLive, provider } = streaming();
    vi.spyOn(providers, 'getProvider').mockReturnValue(provider);
    st().setLive(true); // reset the choice and the stream left by earlier tests
    startLive.mockClear();
    await st().loadData();
    expect(startLive).toHaveBeenCalledOnce();
    expect(st().live).toBe(true);
    st().setTimeframe('1h');
    await vi.waitFor(() => expect(startLive).toHaveBeenCalledTimes(2));
    await st().loadData();
    st().setSymbol('ETHUSDT', { load: true });
    await vi.waitFor(() => expect(startLive).toHaveBeenCalledTimes(4));
    st().openWatchItem('binance', 'SOLUSDT');
    await vi.waitFor(() => expect(startLive).toHaveBeenCalledTimes(5));
    st().setProvider('binance');
    await vi.waitFor(() => expect(startLive).toHaveBeenCalledTimes(6));
    st().setLive(false);
  });

  it('stays off after the person turns it off, until it is turned back on', async () => {
    const { startLive, provider } = streaming();
    vi.spyOn(providers, 'getProvider').mockReturnValue(provider);
    await st().loadData();
    st().setLive(false);
    startLive.mockClear();
    expect(st().liveWanted).toBe(false);
    for (const act of [
      () => st().setTimeframe('4h'),
      () => st().setSymbol('ETHUSDT', { load: true }),
      () => st().openWatchItem('binance', 'SOLUSDT'),
      () => st().setProvider('binance'),
    ]) {
      act();
      await vi.waitFor(() => expect(st().loadState).toBe('ready'));
      await st().loadData();
      expect(st().live).toBe(false);
    }
    expect(startLive).not.toHaveBeenCalled();
    st().setLive(true);
    expect(startLive).toHaveBeenCalledOnce();
    await st().loadData();
    expect(startLive).toHaveBeenCalledTimes(2);
    st().setLive(false);
  });

  it('opens no stream and no toast for a market or a dataset that cannot stream, and goes live again on return', async () => {
    const live = streaming();
    const quiet = { ...providers.demoProvider, name: 'Quiet', supportsLive: false, fetchHistory: async () => bars } as never;
    const spy = vi.spyOn(providers, 'getProvider').mockReturnValue(live.provider);
    st().setLive(true);
    await st().loadData();
    expect(st().live).toBe(true);
    live.startLive.mockClear();
    const toasts = useStore.getState().toasts.length;
    spy.mockReturnValue(quiet);
    await st().loadData();
    expect(st().live).toBe(false);
    expect(st().liveWanted).toBe(true);
    st().addDataset({ name: 'd', candles: bars, source: 'csv', description: 'd', barSeconds: 3600, barLabel: '1h' });
    expect(st().live).toBe(false);
    expect(useStore.getState().toasts).toHaveLength(toasts);
    spy.mockReturnValue(live.provider);
    await st().loadData();
    expect(live.startLive).toHaveBeenCalledOnce();
    expect(st().live).toBe(true);
    st().setLive(false);
  });
});
