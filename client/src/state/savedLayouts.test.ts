import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterEachCleanup, chartOf, stubStorage, track } from './stateTestKit';
import { layoutSnapshot } from './store';

afterEach(afterEachCleanup);

const base = { providerId: 'demo', symbol: 'DEMO', timeframe: '1d', bars: 500 };
const stored = (key: string) => JSON.parse(localStorage.getItem(`vost.${key}`)!);

async function fresh() {
  vi.resetModules();
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  const { useStore } = await import('./store');
  track(useStore);
  return useStore;
}

describe('named layouts in the app store', () => {
  beforeEach(() => {
    stubStorage();
    localStorage.setItem('vost.prefs.v1', JSON.stringify(base));
  });

  it('the first init seeds one "Unnamed" layout from the working layout and touches no other key', async () => {
    localStorage.setItem('vost.watchlists.v1', 'not-a-watchlist-state');
    const app = await fresh();
    app.getState().init();
    const saved = stored('savedLayouts.v1');
    expect(saved.layouts).toHaveLength(1);
    expect(saved.layouts[0].name).toBe('Unnamed');
    expect(saved.currentId).toBe(saved.layouts[0].id);
    expect(saved.autosave).toBe(true);
    expect(saved.layouts[0].layout).toEqual(layoutSnapshot(app.getState()));
    expect(app.getState().layoutDirty).toBe(false);
  });

  it('a corrupt savedLayouts.v1 is replaced by a seed and layout.v1 is left alone', async () => {
    localStorage.setItem('vost.savedLayouts.v1', '{oops');
    const layoutRaw = JSON.stringify({ nonsense: true });
    localStorage.setItem('vost.layout.v1', layoutRaw);
    const app = await fresh();
    app.getState().init();
    expect(app.getState().savedLayouts.layouts).toHaveLength(1);
    expect(localStorage.getItem('vost.layout.v1')).toBe(layoutRaw);
  });

  it('with autosave on a change reaches the current layout after the debounce, and flushPersist writes it at once', async () => {
    const app = await fresh();
    app.getState().init();
    vi.useFakeTimers();
    chartOf(app).getState().setTimeframe('1h');
    expect(stored('savedLayouts.v1').layouts[0].layout.charts[0].timeframe).toBe('1d');
    vi.advanceTimersByTime(450);
    expect(stored('savedLayouts.v1').layouts[0].layout.charts[0].timeframe).toBe('1h');
    chartOf(app).getState().setTimeframe('4h');
    app.getState().flushPersist();
    expect(stored('savedLayouts.v1').layouts[0].layout.charts[0].timeframe).toBe('4h');
    expect(stored('layout.v1').charts[0].timeframe).toBe('4h');
  });

  it('with autosave off the saved layout keeps its snapshot until Save, and the unsaved flag follows', async () => {
    const app = await fresh();
    app.getState().init();
    app.getState().setAutosave(false);
    expect(stored('savedLayouts.v1').autosave).toBe(false);
    chartOf(app).getState().setTimeframe('1h');
    expect(app.getState().layoutDirty).toBe(true);
    app.getState().flushPersist();
    expect(stored('savedLayouts.v1').layouts[0].layout.charts[0].timeframe).toBe('1d');
    expect(stored('layout.v1').charts[0].timeframe).toBe('1h');
    app.getState().saveLayout();
    expect(stored('savedLayouts.v1').layouts[0].layout.charts[0].timeframe).toBe('1h');
    expect(app.getState().layoutDirty).toBe(false);
    chartOf(app).getState().setTimeframe('1d');
    expect(app.getState().layoutDirty).toBe(true);
    chartOf(app).getState().setTimeframe('1h');
    expect(app.getState().layoutDirty).toBe(false);
  });

  it('opening a layout rebuilds every chart from it, stops the old ones, and a fresh init reopens it', async () => {
    const app = await fresh();
    app.getState().init();
    const firstId = app.getState().savedLayouts.currentId;
    // layout A: 2x2 with its own markets, sync and an active chart
    app.getState().setArrangement('grid-2x2');
    const order = app.getState().chartOrder;
    app.getState().charts[order[1]].getState().setSymbol('DEMO-BEAR');
    app.getState().charts[order[2]].getState().setTimeframe('1h');
    app.getState().setSync('symbol', true);
    app.getState().setActiveChart(order[1]);
    app.getState().flushPersist();
    const snapshotA = layoutSnapshot(app.getState());
    expect(app.getState().copyLayout('One chart')).toBe(true);
    app.getState().setArrangement('single');
    app.getState().flushPersist();
    expect(app.getState().chartOrder).toHaveLength(1);

    const old = Object.values(app.getState().charts);
    const stops = old.map((c) => {
      const spy = vi.fn();
      c.setState({ clearData: spy });
      return spy;
    });
    expect(app.getState().openLayout(firstId)).toBe(true);
    stops.forEach((spy) => expect(spy).toHaveBeenCalled());
    const s = app.getState();
    expect(s.savedLayouts.currentId).toBe(firstId);
    expect(s.arrangementId).toBe('grid-2x2');
    expect(s.sync.symbol).toBe(true);
    expect(s.chartOrder).toEqual(order);
    expect(s.activeChartId).toBe(order[1]);
    expect(layoutSnapshot(s)).toEqual(snapshotA);
    expect(stored('layout.v1')).toEqual(snapshotA);
    expect(s.charts[order[1]].getState().symbol).toBe('DEMO-BEAR');
    expect(s.charts[order[2]].getState().timeframe).toBe('1h');

    const again = await fresh();
    again.getState().init();
    expect(again.getState().savedLayouts.currentId).toBe(firstId);
    expect(layoutSnapshot(again.getState())).toEqual(snapshotA);
  });

  it('opening with autosave on first saves the pending change into the layout being left', async () => {
    const app = await fresh();
    app.getState().init();
    const firstId = app.getState().savedLayouts.currentId;
    app.getState().copyLayout('Other');
    app.getState().openLayout(firstId);
    chartOf(app).getState().setTimeframe('1h'); // pending in the debounce, belongs to the first layout
    const other = app.getState().savedLayouts.layouts.find((l) => l.id !== firstId)!;
    app.getState().openLayout(other.id);
    const left = stored('savedLayouts.v1').layouts.find((l: { id: string }) => l.id === firstId);
    expect(left.layout.charts[0].timeframe).toBe('1h');
    expect(chartOf(app).getState().timeframe).toBe('1d');
  });

  it('create gives one chart on the active market with default sync and a name, and becomes current', async () => {
    const app = await fresh();
    app.getState().init();
    app.getState().setArrangement('grid-2x2');
    app.getState().charts[app.getState().chartOrder[0]].getState().setSymbol('DEMO-CHOP');
    expect(app.getState().createLayout('   ')).toBe(false);
    expect(app.getState().createLayout('Fresh')).toBe(true);
    const s = app.getState();
    expect(s.chartOrder).toHaveLength(1);
    expect(s.arrangementId).toBe('single');
    expect(chartOf(app).getState().symbol).toBe('DEMO-CHOP');
    expect(s.savedLayouts.layouts.find((l) => l.id === s.savedLayouts.currentId)!.name).toBe('Fresh');
    expect(s.layoutDirty).toBe(false);
    expect(s.sync.crosshair).toBe(true);
  });

  it('rename changes the name; deleting the current layout is refused, another one is deleted', async () => {
    const app = await fresh();
    app.getState().init();
    const firstId = app.getState().savedLayouts.currentId;
    expect(app.getState().renameLayout(firstId, '  Long Term ')).toBe(true);
    expect(stored('savedLayouts.v1').layouts[0].name).toBe('Long Term');
    expect(app.getState().deleteLayout(firstId)).toBe(false);
    app.getState().copyLayout('Copy');
    expect(app.getState().deleteLayout(firstId)).toBe(true);
    expect(stored('savedLayouts.v1').layouts.map((l: { name: string }) => l.name)).toEqual(['Copy']);
  });

  it('copying keeps a pending autosave of the layout being copied from', async () => {
    const app = await fresh();
    app.getState().init();
    const firstId = app.getState().savedLayouts.currentId;
    chartOf(app).getState().setTimeframe('1h');
    expect(app.getState().copyLayout('Copy')).toBe(true);
    const layouts = stored('savedLayouts.v1').layouts as Array<{ id: string; layout: { charts: Array<{ timeframe: string }> } }>;
    expect(layouts.find((l) => l.id === firstId)!.layout.charts[0].timeframe).toBe('1h');
    expect(app.getState().savedLayouts.layouts.find((l) => l.id === firstId)!.layout.charts[0].timeframe).toBe('1h');
  });
});
