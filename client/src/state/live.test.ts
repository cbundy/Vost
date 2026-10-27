import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from './store';
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
    useStore.getState().setLive(true);
    expect(startLive).toHaveBeenCalledOnce();
    expect(useStore.getState().liveStatus).toBe('live');
    useStore.getState().setLive(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(useStore.getState().live).toBe(false);
  });

  it('refuses providers without startLive with a neutral toast', () => {
    vi.spyOn(providers, 'getProvider').mockReturnValue({ ...providers.demoProvider, name: 'Fake' } as never);
    useStore.getState().setLive(true);
    expect(useStore.getState().live).toBe(false);
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
    useStore.setState({ timeframe: '1h', symbol: 'BTCUSDT', candles: [bar(now - 7200, 1), bar(now - 3600, 2)], messages: [] });
    const fetchHistory = vi.fn(async () => [bar(now - 7200, 1), bar(now - 3600, 22), bar(now, 3)]);
    const opts = start(fetchHistory);
    useStore.getState().setLive(true);
    expect(fetchHistory).not.toHaveBeenCalled(); // connecting -> live needs no backfill
    opts().onStatus('reconnecting', 'Connection to the Vost server lost');
    opts().onStatus('live');
    await vi.waitFor(() => expect(useStore.getState().candles).toHaveLength(3));
    expect(fetchHistory).toHaveBeenCalledOnce();
    // 1 bar elapsed since the last loaded candle (the current one) + 2
    expect(fetchHistory).toHaveBeenCalledWith({ symbol: 'BTCUSDT', timeframe: '1h', bars: 3 });
    expect(useStore.getState().candles.map((c) => [c.time, c.close])).toEqual([[now - 7200, 1], [now - 3600, 22], [now, 3]]);
    // a later kline replaces the last bar
    opts().onKline(bar(now, 4), false);
    expect(useStore.getState().candles.map((c) => c.close)).toEqual([1, 22, 4]);
  });

  it('also backfills after the exchange feed gave up (error -> live)', async () => {
    const now = hourNow();
    useStore.setState({ timeframe: '1h', candles: [bar(now - 36000, 1)], messages: [] });
    const fetchHistory = vi.fn(async (_req: { bars: number }) => [bar(now - 3600, 2), bar(now, 3)]);
    const opts = start(fetchHistory);
    useStore.getState().setLive(true);
    opts().onStatus('error', 'Live connection lost');
    opts().onStatus('live');
    await vi.waitFor(() => expect(fetchHistory).toHaveBeenCalledOnce());
    expect(fetchHistory.mock.calls[0][0].bars).toBe(12); // 10 bars elapsed + 2
  });

  it('backfills after a browser-to-server drop that comes back as reconnecting -> connecting -> live', async () => {
    const now = hourNow();
    useStore.setState({ timeframe: '1h', candles: [bar(now - 3600, 2)], messages: [] });
    const fetchHistory = vi.fn(async () => [bar(now - 3600, 2), bar(now, 3)]);
    const opts = start(fetchHistory);
    useStore.getState().setLive(true);
    opts().onStatus('reconnecting');
    opts().onStatus('connecting');
    opts().onStatus('live');
    await vi.waitFor(() => expect(fetchHistory).toHaveBeenCalledOnce());
  });

  it('backfills after live -> connecting -> live (server restart) but not on the first connect', async () => {
    const now = hourNow();
    useStore.setState({ timeframe: '1h', candles: [bar(now - 3600, 2)], messages: [] });
    const fetchHistory = vi.fn(async () => [bar(now - 3600, 2), bar(now, 3)]);
    const opts = start(fetchHistory);
    useStore.getState().setLive(true);
    expect(fetchHistory).not.toHaveBeenCalled();
    opts().onStatus('connecting');
    opts().onStatus('live');
    await vi.waitFor(() => expect(fetchHistory).toHaveBeenCalledOnce());
  });

  it('a failing backfill leaves the candles as they are and writes an inbox line', async () => {
    const now = hourNow();
    const before = [bar(now - 3600, 2)];
    useStore.setState({ timeframe: '1h', candles: before, messages: [] });
    const fetchHistory = vi.fn(async () => {
      throw new Error('upstream down');
    });
    const opts = start(fetchHistory);
    useStore.getState().setLive(true);
    opts().onStatus('reconnecting');
    opts().onStatus('live');
    await vi.waitFor(() => expect(useStore.getState().messages.length).toBeGreaterThan(0));
    expect(useStore.getState().candles).toBe(before);
    const msg = useStore.getState().messages[useStore.getState().messages.length - 1];
    expect(msg.source).toBe('Live');
    expect(msg.text).toContain('upstream down');
  });

  it('drops a backfill that finishes after the stream was stopped', async () => {
    const now = hourNow();
    const before = [bar(now - 3600, 2)];
    useStore.setState({ timeframe: '1h', candles: before, messages: [] });
    let finish!: (c: Candle[]) => void;
    const fetchHistory = vi.fn(() => new Promise<Candle[]>((r) => (finish = r)));
    const opts = start(fetchHistory);
    useStore.getState().setLive(true);
    opts().onStatus('reconnecting');
    opts().onStatus('live');
    useStore.getState().setLive(false);
    finish([bar(now - 3600, 2), bar(now, 3)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(useStore.getState().candles).toBe(before);
  });
});
