import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterEachCleanup, stubStorage, track } from './stateTestKit';
import { DEFAULT_SYNC, type LayoutSync } from '../lib/layouts';
import type { Candle } from '../types';

afterEach(afterEachCleanup);

const base = { providerId: 'demo', symbol: 'DEMO', timeframe: '1d', bars: 500 };
const DAY = 86400;
const mk = (from: number, n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: from + i * DAY, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));

async function grid(sync: Partial<LayoutSync>) {
  vi.resetModules();
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  const { useStore } = await import('./store');
  const providers = await import('../lib/providers');
  track(useStore);
  localStorage.setItem('vost.prefs.v1', JSON.stringify(base));
  useStore.getState().init();
  useStore.getState().setArrangement('grid-2x2');
  useStore.getState().setSync('crosshair', false);
  for (const [k, v] of Object.entries(sync)) useStore.getState().setSync(k as keyof LayoutSync, v);
  const [a, b, c, d] = useStore.getState().chartOrder;
  const chart = (id: string) => useStore.getState().charts[id];
  // count the calls each chart's market and range actions receive
  const spies = [a, b, c, d].map((id) => {
    const st = chart(id).getState();
    return {
      id,
      openWatchItem: vi.spyOn(st, 'openWatchItem'),
      setTimeframe: vi.spyOn(st, 'setTimeframe'),
      setChartRange: vi.spyOn(st, 'setChartRange'),
      clearChartRange: vi.spyOn(st, 'clearChartRange'),
    };
  });
  return { app: useStore, providers, ids: [a, b, c, d], chart, spies };
}

describe('Sync in layout', () => {
  beforeEach(() => {
    stubStorage();
  });

  it('defaults to the crosshair only, and round-trips through layout.v1', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { useStore } = await import('./store');
    track(useStore);
    useStore.getState().init();
    expect(useStore.getState().sync).toEqual(DEFAULT_SYNC);
    useStore.getState().setSync('interval', true);
    useStore.getState().setSync('crosshair', false);
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(localStorage.getItem('vost.layout.v1')!).sync).toEqual({ ...DEFAULT_SYNC, interval: true, crosshair: false });
    vi.resetModules();
    const again = (await import('./store')).useStore;
    track(again);
    again.getState().init();
    expect(again.getState().sync).toEqual({ ...DEFAULT_SYNC, interval: true, crosshair: false });
  });

  it('symbol: a change on one chart reaches the others once each; off, only that chart changes', async () => {
    const on = await grid({ symbol: true });
    on.chart(on.ids[1]).getState().openWatchItem('demo', 'DEMO-BEAR');
    for (const [i, id] of on.ids.entries()) {
      expect(on.chart(id).getState().symbol).toBe('DEMO-BEAR');
      expect(on.spies[i].openWatchItem).toHaveBeenCalledTimes(1);
    }
    const off = await grid({ symbol: false });
    off.chart(off.ids[1]).getState().openWatchItem('demo', 'DEMO-BEAR');
    expect(off.ids.map((id) => off.chart(id).getState().symbol)).toEqual(['DEMO', 'DEMO-BEAR', 'DEMO', 'DEMO']);
  });

  it('symbol: a symbol commit through setSymbol with load syncs, one without load does not', async () => {
    const t = await grid({ symbol: true });
    t.chart(t.ids[0]).getState().setSymbol('DEMO-CHOP');
    expect(t.chart(t.ids[1]).getState().symbol).toBe('DEMO');
    t.chart(t.ids[0]).getState().setSymbol('DEMO-CHOP', { load: true });
    expect(t.ids.map((id) => t.chart(id).getState().symbol)).toEqual(Array(4).fill('DEMO-CHOP'));
  });

  it('interval: a change reaches the others once each; off, only that chart changes', async () => {
    const on = await grid({ interval: true });
    on.chart(on.ids[2]).getState().setTimeframe('1h');
    for (const [i, id] of on.ids.entries()) {
      expect(on.chart(id).getState().timeframe).toBe('1h');
      expect(on.spies[i].setTimeframe).toHaveBeenCalledTimes(1);
    }
    const off = await grid({ interval: false });
    off.chart(off.ids[2]).getState().setTimeframe('1h');
    expect(off.ids.map((id) => off.chart(id).getState().timeframe)).toEqual(['1d', '1d', '1h', '1d']);
  });

  it('interval: a chart whose provider does not serve it keeps its own, with one toast for all of them', async () => {
    const t = await grid({ interval: true });
    const lacking = t.providers.providers.find((p) => p.id !== 'demo')!;
    const missing = '5m' as const;
    // this module copy is reset per test; drop the missing one and everything below it so it cannot be built either
    lacking.timeframes = lacking.timeframes.filter((tf) => tf !== '1m' && tf !== missing);
    const own = lacking.defaultTimeframe;
    for (const id of [t.ids[1], t.ids[2]]) t.chart(id).setState({ providerId: lacking.id, timeframe: own });
    const toasts = () => t.app.getState().toasts;
    const before = toasts().length;
    t.chart(t.ids[0]).getState().setTimeframe(missing);
    expect(t.chart(t.ids[3]).getState().timeframe).toBe(missing);
    expect(t.chart(t.ids[1]).getState().timeframe).toBe(own);
    expect(t.chart(t.ids[2]).getState().timeframe).toBe(own);
    expect(t.spies[1].setTimeframe).not.toHaveBeenCalled();
    const added = toasts().slice(before).filter((x) => x.kind === 'info');
    expect(added).toHaveLength(1);
    expect(added[0].text).toContain('Chart 2');
    expect(added[0].text).toContain('Chart 3');
    expect(added[0].text).not.toContain('Chart 4');
  });

  describe('date range', () => {
    async function ranged(sync: Partial<LayoutSync>) {
      const t = await grid(sync);
      const start = 1_600_000_000 - (1_600_000_000 % DAY);
      const candles = mk(start, 100);
      for (const id of t.ids) t.chart(id).setState({ candles, activeDatasetId: null });
      return { ...t, start };
    }

    it('applies to and clears on every other chart, once each', async () => {
      const t = await ranged({ dateRange: true });
      const range = { from: t.start + 10 * DAY, to: t.start + 60 * DAY };
      await t.chart(t.ids[1]).getState().setChartRange(range);
      for (const [i, id] of t.ids.entries()) {
        expect(t.chart(id).getState().chartRange).toEqual(range);
        expect(t.spies[i].setChartRange).toHaveBeenCalledTimes(1);
      }
      await t.chart(t.ids[3]).getState().clearChartRange();
      for (const id of t.ids) expect(t.chart(id).getState().chartRange).toBeNull();
      // only the source's own call plus one per receiver, never an echo
      expect(t.spies[0].clearChartRange).toHaveBeenCalledTimes(1);
      expect(t.spies[1].clearChartRange).toHaveBeenCalledTimes(1);
      expect(t.spies[3].clearChartRange).toHaveBeenCalledTimes(1);
    });

    it('does nothing to the others when off', async () => {
      const t = await ranged({ dateRange: false });
      await t.chart(t.ids[1]).getState().setChartRange({ from: t.start + 10 * DAY, to: t.start + 60 * DAY });
      expect(t.ids.map((id) => t.chart(id).getState().chartRange != null)).toEqual([false, true, false, false]);
    });

    it('does not echo across an asynchronous range fetch', async () => {
      const t = await ranged({ dateRange: true });
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const fetchSpy = vi.spyOn(t.providers.demoProvider, 'fetchHistory').mockImplementation(async (req) => {
        await gate;
        return mk(req.from!, Math.floor((req.to! - req.from!) / DAY) + 1);
      });
      const range = { from: t.start - 200 * DAY, to: t.start - 100 * DAY };
      const done = t.chart(t.ids[0]).getState().setChartRange(range);
      release();
      expect(await done).toBe(true);
      await vi.waitFor(() => expect(t.ids.every((id) => t.chart(id).getState().chartRange != null)).toBe(true));
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      for (const s of t.spies) expect(s.setChartRange).toHaveBeenCalledTimes(1);
    });

    it('gives one info toast, not one per chart, when live receivers pause', async () => {
      const t = await ranged({ dateRange: true });
      for (const id of t.ids) t.chart(id).setState({ live: true });
      const before = t.app.getState().toasts.length;
      const range = { from: t.start + 10 * DAY, to: t.start + 60 * DAY };
      await t.chart(t.ids[0]).getState().setChartRange(range);
      const added = t.app.getState().toasts.slice(before);
      expect(added.filter((x) => x.kind === 'error')).toHaveLength(0);
      expect(added.filter((x) => x.kind === 'info' && x.text.startsWith('Live is paused'))).toHaveLength(1);
      for (const id of t.ids) {
        expect(t.chart(id).getState().chartRange).toEqual(range);
        expect(t.chart(id).getState().live).toBe(false);
        expect(t.chart(id).getState().liveWanted).toBe(true);
      }
    });

    it('the live path range clear does not reach the other charts', async () => {
      const t = await ranged({ dateRange: true });
      const range = { from: t.start + 10 * DAY, to: t.start + 60 * DAY };
      await t.chart(t.ids[0]).getState().setChartRange(range);
      for (const s of t.spies) s.clearChartRange.mockClear();
      t.chart(t.ids[0]).getState().setLive(true); // the demo provider streams nothing, but live still clears the crop first
      for (const id of t.ids.slice(1)) expect(t.chart(id).getState().chartRange).toEqual(range);
      for (const s of t.spies.slice(1)) expect(s.clearChartRange).not.toHaveBeenCalled();
    });
  });

  it('symbol and interval syncs show one load-error toast, not one per receiving chart', async () => {
    for (const kind of ['symbol', 'interval'] as const) {
      const t = await grid({});
      const settle = () =>
        vi.waitFor(() => {
          for (const id of t.ids) expect(t.chart(id).getState().loadState).not.toBe('loading');
        });
      for (const id of t.ids) t.chart(id).getState().openWatchItem('coinbase', 'BTC-USD', { broadcast: false });
      await settle();
      t.app.getState().setSync(kind, true);
      const before = t.app.getState().toasts.length;
      if (kind === 'symbol') t.chart(t.ids[1]).getState().openWatchItem('coinbase', 'ETH-USD');
      else t.chart(t.ids[1]).getState().setTimeframe('1h');
      await settle();
      const errors = t.app.getState().toasts.slice(before).filter((x) => x.kind === 'error');
      expect(errors.length).toBe(1); // the source and the three receivers share one toast
    }
  });

  it('removing a custom timeframe does not sync the app-driven reset', async () => {
    const t = await grid({ interval: true });
    t.app.getState().addCustomTimeframe?.('2h');
    t.chart(t.ids[0]).getState().setTimeframe('2h', { load: false, broadcast: false });
    t.chart(t.ids[1]).getState().setTimeframe('4h', { load: false, broadcast: false });
    t.app.getState().removeCustomTimeframe('2h');
    expect(t.chart(t.ids[1]).getState().timeframe).toBe('4h');
  });
});
