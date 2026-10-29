import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterEachCleanup, chartOf, stubStorage, track } from './stateTestKit';
import { getArrangement } from '../lib/layouts';

afterEach(afterEachCleanup);

const base = { providerId: 'demo', symbol: 'DEMO', timeframe: '1d', bars: 500 };

async function fresh() {
  vi.resetModules();
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  const { useStore } = await import('./store');
  track(useStore);
  return useStore;
}

const stored = (key: string) => JSON.parse(localStorage.getItem(`vost.${key}`)!);

describe('chart layouts in the app store', () => {
  beforeEach(() => {
    stubStorage();
    localStorage.setItem('vost.prefs.v1', JSON.stringify(base));
  });

  it('opens on one chart of the saved prefs when there is no saved layout', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, symbol: 'DEMO-BEAR' }));
    const app = await fresh();
    app.getState().init();
    expect(app.getState().arrangementId).toBe('single');
    expect(app.getState().chartOrder).toEqual(['chart-1']);
    expect(chartOf(app).getState().symbol).toBe('DEMO-BEAR');
  });

  it('going 1 -> 4 -> 2 keeps the first charts, copies the market into new ones and stops the dropped ones', async () => {
    const app = await fresh();
    app.getState().init();
    const first = chartOf(app);
    first.getState().setSymbol('DEMO-CHOP');
    first.getState().setTimeframe('1h');
    first.getState().setBars(1234);
    const indicators = first.getState().indicators;

    app.getState().setArrangement('grid-2x2');
    const order4 = app.getState().chartOrder;
    expect(order4).toHaveLength(4);
    expect(order4[0]).toBe('chart-1');
    expect(new Set(order4).size).toBe(4);
    for (const id of order4.slice(1)) {
      const c = app.getState().charts[id].getState();
      expect([c.providerId, c.symbol, c.timeframe, c.bars]).toEqual(['demo', 'DEMO-CHOP', '1h', 1234]);
      expect(c.indicators).not.toBe(indicators);
    }
    expect(app.getState().charts['chart-1']).toBe(first);

    // the second chart is changed on its own
    app.getState().charts[order4[1]].getState().setSymbol('DEMO-BEAR');
    const dropped = order4.slice(2).map((id) => app.getState().charts[id]);
    const stopped = dropped.map((c) => {
      const spy = vi.fn();
      c.setState({ clearData: spy });
      return spy;
    });

    app.getState().setArrangement('cols-2');
    expect(app.getState().chartOrder).toEqual(order4.slice(0, 2));
    expect(Object.keys(app.getState().charts).sort()).toEqual([...order4.slice(0, 2)].sort());
    expect(stopped.every((s) => s.mock.calls.length === 1)).toBe(true);
    expect(app.getState().charts['chart-1']).toBe(first);
    expect(first.getState().symbol).toBe('DEMO-CHOP');
    expect(app.getState().charts[order4[1]].getState().symbol).toBe('DEMO-BEAR');
    expect(app.getState().layoutSizes).toEqual({ cols: [0.5, 0.5], rows: [1] });
  });

  it('dropping the active chart makes the first chart active; keeping it keeps it', async () => {
    const app = await fresh();
    app.getState().init();
    app.getState().setArrangement('grid-2x2');
    const [a, b, , d] = app.getState().chartOrder;
    app.getState().setActiveChart(b);
    app.getState().setArrangement('grid-3x3');
    expect(app.getState().activeChartId).toBe(b);
    app.getState().setActiveChart(app.getState().chartOrder[8]);
    app.getState().setArrangement('cols-2');
    expect(app.getState().activeChartId).toBe(a);
    expect(app.getState().chartOrder).not.toContain(d);
  });

  it('setActiveChart changes which chart the panels act on, and an unknown id changes nothing', async () => {
    const app = await fresh();
    app.getState().init();
    app.getState().setArrangement('cols-2');
    const [a, b] = app.getState().chartOrder;
    app.getState().charts[b].getState().setSymbol('DEMO-BEAR');
    expect(chartOf(app).getState().symbol).toBe('DEMO');
    app.getState().setActiveChart(b);
    expect(chartOf(app).getState().symbol).toBe('DEMO-BEAR');
    app.getState().setActiveChart('nope');
    expect(app.getState().activeChartId).toBe(b);
    const { getActiveChart } = await import('./store');
    expect(getActiveChart().getState().symbol).toBe('DEMO-BEAR');
    app.getState().setActiveChart(a);
    expect(getActiveChart().getState().symbol).toBe('DEMO');
  });

  it('ignores an unknown or the current arrangement', async () => {
    const app = await fresh();
    app.getState().init();
    app.getState().setArrangement('nope');
    app.getState().setArrangement('single');
    expect(app.getState().chartOrder).toEqual(['chart-1']);
  });

  it('layout.v1 round-trips through a fresh store, and prefs.v1 is written from the active chart', async () => {
    vi.useFakeTimers();
    const app = await fresh();
    app.getState().init();
    app.getState().setArrangement('stacks-1-2');
    const [a, b, c] = app.getState().chartOrder;
    app.getState().charts[b].getState().setSymbol('DEMO-BEAR');
    app.getState().charts[c].getState().setTimeframe('1h');
    app.getState().charts[c].getState().addIndicator('rsi');
    app.getState().setActiveChart(b);
    app.getState().setLayoutSizes({ cols: [0.3, 0.7], rows: [0.5, 0.5] });
    vi.advanceTimersByTime(1000);
    const layout = stored('layout.v1');
    expect(layout).toMatchObject({ version: 1, arrangementId: 'stacks-1-2', activeChartId: b });
    expect(layout.charts.map((x: { id: string }) => x.id)).toEqual([a, b, c]);
    expect(layout.sizes).toEqual({ cols: [0.3, 0.7], rows: [0.5, 0.5] });
    expect(stored('prefs.v1').symbol).toBe('DEMO-BEAR');
    const indicatorCount = app.getState().charts[c].getState().indicators.length;

    const again = await fresh();
    again.getState().init();
    expect(again.getState().arrangementId).toBe('stacks-1-2');
    expect(again.getState().chartOrder).toEqual([a, b, c]);
    expect(again.getState().activeChartId).toBe(b);
    expect(again.getState().layoutSizes).toEqual({ cols: [0.3, 0.7], rows: [0.5, 0.5] });
    const symbols = again.getState().chartOrder.map((id) => again.getState().charts[id].getState().symbol);
    expect(symbols).toEqual(['DEMO', 'DEMO-BEAR', 'DEMO']);
    expect(again.getState().charts[c].getState().timeframe).toBe('1h');
    expect(again.getState().charts[c].getState().indicators).toHaveLength(indicatorCount);
  });

  it('a saved layout wins over prefs.v1 for the charts; the app-wide prefs still come from prefs.v1', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, symbol: 'DEMO-BEAR', sidebarWidth: 333 }));
    localStorage.setItem(
      'vost.layout.v1',
      JSON.stringify({ version: 1, arrangementId: 'cols-2', activeChartId: 'x2', charts: [{ id: 'x1', ...base }, { id: 'x2', ...base, symbol: 'DEMO-CHOP' }], sizes: null }),
    );
    const app = await fresh();
    app.getState().init();
    expect(app.getState().chartOrder).toEqual(['x1', 'x2']);
    expect(Object.keys(app.getState().charts)).toEqual(['x1', 'x2']);
    expect(chartOf(app).getState().symbol).toBe('DEMO-CHOP');
    expect(app.getState().sidebarWidth).toBe(333);
    expect(app.getState().layoutSizes).toEqual({ cols: [0.5, 0.5], rows: [1] });
  });

  it.each([
    ['corrupt JSON', '{nope'],
    ['an unknown arrangement', JSON.stringify({ version: 1, arrangementId: 'zzz', charts: [{ id: 'a', ...base }] })],
    ['a chart count that does not match', JSON.stringify({ version: 1, arrangementId: 'cols-2', charts: [{ id: 'a', ...base }] })],
  ])('%s opens one chart of the prefs.v1 chart', async (_name, raw) => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, symbol: 'DEMO-BEAR' }));
    localStorage.setItem('vost.layout.v1', raw);
    const app = await fresh();
    app.getState().init();
    expect(app.getState().arrangementId).toBe('single');
    expect(app.getState().chartOrder).toEqual(['chart-1']);
    expect(chartOf(app).getState().symbol).toBe('DEMO-BEAR');
  });

  it('an unknown provider falls back to the default market for that chart only', async () => {
    localStorage.setItem(
      'vost.layout.v1',
      JSON.stringify({
        version: 1,
        arrangementId: 'cols-2',
        charts: [{ id: 'a', ...base, symbol: 'DEMO-CHOP' }, { id: 'b', providerId: 'gone', symbol: 'OLD', timeframe: '5m', bars: 100 }],
      }),
    );
    const app = await fresh();
    app.getState().init();
    const [a, b] = app.getState().chartOrder.map((id) => app.getState().charts[id].getState());
    expect([a.providerId, a.symbol]).toEqual(['demo', 'DEMO-CHOP']);
    expect([b.providerId, b.symbol, b.timeframe]).toEqual(['binance', 'BTCUSDT', '1h']);
  });

  it('bad saved sizes fall back to even tracks, and setLayoutSizes sanitizes', async () => {
    localStorage.setItem(
      'vost.layout.v1',
      JSON.stringify({ version: 1, arrangementId: 'cols-2', charts: [{ id: 'a', ...base }, { id: 'b', ...base }], sizes: { cols: [1, -1], rows: [1] } }),
    );
    const app = await fresh();
    app.getState().init();
    expect(app.getState().layoutSizes).toEqual({ cols: [0.5, 0.5], rows: [1] });
    app.getState().setLayoutSizes({ cols: [1, 3], rows: [1] });
    expect(app.getState().layoutSizes.cols).toEqual([0.25, 0.75]);
    app.getState().setLayoutSizes({ cols: [1], rows: [] });
    expect(app.getState().layoutSizes).toEqual({ cols: [0.5, 0.5], rows: [1] });
    expect(getArrangement(app.getState().arrangementId)?.count).toBe(2);
  });

  it('a user with only prefs.v1 opens on a one-chart layout of their chart', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, symbol: 'DEMO-CHOP' }));
    const app = await fresh();
    app.getState().init();
    expect(app.getState().chartOrder).toHaveLength(1);
    expect(chartOf(app).getState().symbol).toBe('DEMO-CHOP');
  });
});
