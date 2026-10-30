import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterEachCleanup, chartOf, markUsed, stubStorage, track, snap } from './stateTestKit';

afterEach(afterEachCleanup);

describe('addSymbolToWatchlist', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  it('adds to the active list once; a second call is a no-op', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    const st = snap(useStore);
    const count = () =>
      useStore.getState().watchlists.lists.find((l) => l.id === useStore.getState().watchlists.activeListId)!.sections
        .flatMap((s) => s.items)
        .filter((i) => i.symbol === 'ZZZUSDT').length;
    st.addSymbolToWatchlist({ symbol: 'ZZZUSDT', label: 'ZZZ / USDT' });
    expect(count()).toBe(1);
    useStore.getState().addSymbolToWatchlist({ symbol: 'ZZZUSDT', label: 'ZZZ / USDT' });
    expect(count()).toBe(1);
    expect(useStore.getState().toasts.map((t) => t.kind)).toEqual(['success', 'info']);
  });
});


describe('timeZone pref', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  async function setup() {
    const { useStore } = await import('./store');
    track(useStore);
    return { useStore };
  }

  it('persists setTimeZone and a fresh store reads it back', async () => {
    vi.useFakeTimers();
    try {
      const { useStore } = await setup();
      useStore.getState().setTimeZone('Asia/Tehran');
      vi.advanceTimersByTime(1000);
      expect(JSON.parse(localStorage.getItem('vost.prefs.v1')!).timeZone).toBe('Asia/Tehran');
      vi.resetModules();
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const fresh = track((await import('./store')).useStore);
      fresh.getState().init();
      expect(fresh.getState().timeZone).toBe('Asia/Tehran');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an invalid zone and keeps the current one', async () => {
    const { useStore } = await setup();
    useStore.getState().setTimeZone('Asia/Tehran');
    useStore.getState().setTimeZone('Nope/Zone');
    expect(useStore.getState().timeZone).toBe('Asia/Tehran');
  });

  it('old prefs without timeZone and invalid stored zones fall back to the browser zone', async () => {
    const browser = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const stored of [{}, { timeZone: 'Nope/Zone' }]) {
      localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1h', bars: 100, ...stored }));
      vi.resetModules();
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const fresh = track((await import('./store')).useStore);
      fresh.getState().init();
      expect(fresh.getState().timeZone).toBe(browser);
    }
  });
});


describe('stale persist isolation', () => {
  it('a pending save from a previous store cannot write into the next test', async () => {
    vi.resetModules();
    stubStorage();
    const { useStore } = await import('./store');
    chartOf(useStore).getState().addIndicator('sma');
    markUsed(useStore);
    await afterEachCleanup();
    stubStorage();
    await new Promise((r) => setTimeout(r, 700));
    expect(localStorage.getItem('vost.prefs.v1')).toBeNull();
  });
});


describe('pine editor selection', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  it('openPineEditor opens the pane on the indicator and leaves the dock alone', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    const id = chartOf(useStore).getState().addIndicator('pine');
    useStore.getState().setDockCollapsed(true);
    useStore.getState().setDockTab('results');
    useStore.getState().setDockCollapsed(true);
    expect(useStore.getState().pineOpen).toBe(false);
    useStore.getState().openPineEditor(id);
    const st = snap(useStore);
    expect(st.pineOpen).toBe(true);
    expect(st.selectedPineId).toBe(id);
    expect(st.dockCollapsed).toBe(true);
    expect(st.dockTab).toBe('results');
  });

  it('closePineEditor and togglePineEditor close and flip the pane', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    useStore.getState().openPineEditor(chartOf(useStore).getState().addIndicator('pine'));
    useStore.getState().closePineEditor();
    expect(useStore.getState().pineOpen).toBe(false);
    useStore.getState().togglePineEditor();
    expect(useStore.getState().pineOpen).toBe(true);
    useStore.getState().togglePineEditor();
    expect(useStore.getState().pineOpen).toBe(false);
  });

  it('collapsing then expanding keeps dockHeight, and openPineEditor keeps it too', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    useStore.getState().setDockHeight(410);
    useStore.getState().setDockCollapsed(true);
    expect(useStore.getState().dockHeight).toBe(410);
    useStore.getState().setDockCollapsed(false);
    expect(useStore.getState().dockHeight).toBe(410);
    useStore.getState().setDockCollapsed(true);
    useStore.getState().openPineEditor(chartOf(useStore).getState().addIndicator('pine'));
    expect(useStore.getState().dockHeight).toBe(410);
  });

  it('removing the selected Pine indicator moves the selection', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    const a = chartOf(useStore).getState().addIndicator('pine');
    const b = chartOf(useStore).getState().addIndicator('pine');
    useStore.getState().openPineEditor(b);
    chartOf(useStore).getState().removeIndicator(b);
    expect(chartOf(useStore).getState().selectedPineId).toBe(a);
    chartOf(useStore).getState().removeIndicator(a);
    expect(chartOf(useStore).getState().selectedPineId).toBeNull();
  });
});

describe('pane size prefs', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  });

  const fresh = async () => {
    const { useStore } = await import('./store');
    track(useStore);
    return useStore;
  };
  const base = { providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1h', bars: 100 };

  it('prefs without sizes load the defaults', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify(base));
    const useStore = await fresh();
    useStore.getState().init();
    expect(useStore.getState().sidebarWidth).toBe(264);
    expect(useStore.getState().dockHeight).toBe(320);
    expect(useStore.getState().pineWidth).toBe(440);
  });

  it('a garbage pineWidth loads the default', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, pineWidth: 'wide' }));
    const useStore = await fresh();
    useStore.getState().init();
    expect(useStore.getState().pineWidth).toBe(440);
  });

  it('persists pineWidth and a fresh store reads it back', async () => {
    const a = await fresh();
    a.getState().setPineWidth(500);
    a.getState().flushPersist();
    expect(JSON.parse(localStorage.getItem('vost.prefs.v1')!).pineWidth).toBe(500);
    vi.resetModules();
    const b = await fresh();
    b.getState().init();
    expect(b.getState().pineWidth).toBe(500);
    expect(b.getState().pineOpen).toBe(false);
  });

  it('non-numeric and non-finite stored sizes load the defaults', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, sidebarWidth: 'wide', dockHeight: -3 }));
    const useStore = await fresh();
    useStore.getState().init();
    expect(useStore.getState().sidebarWidth).toBe(264);
    expect(useStore.getState().dockHeight).toBe(320);
  });

  it('persists the sizes and a fresh store reads them back, unclamped', async () => {
    const a = await fresh();
    a.getState().setSidebarWidth(900);
    a.getState().setDockHeight(410);
    a.getState().flushPersist();
    const saved = JSON.parse(localStorage.getItem('vost.prefs.v1')!);
    expect(saved.sidebarWidth).toBe(900);
    expect(saved.dockHeight).toBe(410);
    vi.resetModules();
    const b = await fresh();
    b.getState().init();
    expect(b.getState().sidebarWidth).toBe(900);
    expect(b.getState().dockHeight).toBe(410);
  });

  it('prefs without a side panel load an open watchlist', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify(base));
    const useStore = await fresh();
    useStore.getState().init();
    expect(useStore.getState().sidePanel).toBe('watchlist');
    expect(useStore.getState().sidePanelCollapsed).toBe(false);
  });

  it('junk side panel prefs load the defaults', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, sidePanel: 'charts', sidePanelCollapsed: 'yes' }));
    const useStore = await fresh();
    useStore.getState().init();
    expect(useStore.getState().sidePanel).toBe('watchlist');
    expect(useStore.getState().sidePanelCollapsed).toBe(false);
  });

  it('loads the object tree section', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, sidePanel: 'objects' }));
    const useStore = await fresh();
    useStore.getState().init();
    expect(useStore.getState().sidePanel).toBe('objects');
    useStore.getState().setSidePanel('data');
    useStore.getState().setSidePanel('objects');
    expect(useStore.getState().sidePanel).toBe('objects');
  });

  it('persists the side panel and a fresh store reads it back', async () => {
    const a = await fresh();
    a.getState().setSidePanel('indicators');
    a.getState().setSidePanelCollapsed(true);
    a.getState().flushPersist();
    const saved = JSON.parse(localStorage.getItem('vost.prefs.v1')!);
    expect(saved.sidePanel).toBe('indicators');
    expect(saved.sidePanelCollapsed).toBe(true);
    vi.resetModules();
    const b = await fresh();
    b.getState().init();
    expect(b.getState().sidePanel).toBe('indicators');
    expect(b.getState().sidePanelCollapsed).toBe(true);
  });
});


describe('init with saved prefs', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  });

  const startWith = async (prefs: object) => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify(prefs));
    const { useStore } = await import('./store');
    track(useStore);
    useStore.getState().init();
    return snap(useStore);
  };

  it('opens on the default market when the stored provider is gone', async () => {
    const st = await startWith({ providerId: 'stooq', symbol: 'aapl.us', timeframe: '1d' });
    expect([st.providerId, st.symbol, st.timeframe]).toEqual(['binance', 'BTCUSDT', '1h']);
  });

  it('keeps a stored demo market', async () => {
    const st = await startWith({ providerId: 'demo', symbol: 'DEMO', timeframe: '1d' });
    expect([st.providerId, st.symbol, st.timeframe]).toEqual(['demo', 'DEMO', '1d']);
  });
});

describe('buildTimeframes setting', () => {
  const bars = Array.from({ length: 5 }, (_, i) => ({ time: 1_700_000_000 + i * 3600, open: 1, high: 2, low: 1, close: 2, volume: 1 }));

  async function setup(timeframe: '1m' | '4h' = '4h', providerId = 'binance') {
    vi.resetModules();
    stubStorage();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const { useStore } = await import('./store');
    track(useStore);
    const { getProvider } = await import('../lib/providers');
    const provider = getProvider(providerId);
    const history = vi.spyOn(provider, 'fetchHistory').mockImplementation(async () => bars);
    const live: Array<{ source?: string; timeframe: string }> = [];
    provider.startLive = (o) => {
      live.push({ source: o.source, timeframe: o.timeframe });
      return { stop() {} };
    };
    chartOf(useStore).setState({ providerId, symbol: 'BTCUSDT', timeframe, bars: 100, activeDatasetId: null });
    return { useStore, history, live };
  }

  it('defaults off, is persisted, and a non-boolean reads as off', async () => {
    const { useStore } = await setup();
    expect(useStore.getState().buildTimeframes).toBe(false);
    useStore.getState().setBuildTimeframes(true);
    useStore.getState().flushPersist();
    expect(JSON.parse(localStorage.getItem('vost.prefs.v1')!).buildTimeframes).toBe(true);
    vi.resetModules();
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1h', bars: 100, buildTimeframes: 'yes' }));
    const fresh = track((await import('./store')).useStore);
    fresh.getState().init();
    expect(fresh.getState().buildTimeframes).toBe(false);
  });

  it('flipping on a non-lowest timeframe reloads once, with source built, and keeps Live on', async () => {
    const { useStore, history, live } = await setup('4h');
    await chartOf(useStore).getState().loadData();
    chartOf(useStore).getState().setLive(true);
    history.mockClear();
    live.length = 0;
    useStore.getState().setBuildTimeframes(true);
    await vi.waitFor(() => expect(live).toHaveLength(1));
    expect(history).toHaveBeenCalledTimes(1);
    expect(history.mock.calls[0][0]).toMatchObject({ timeframe: '4h', source: 'built' });
    expect(live[0]).toEqual({ source: 'built', timeframe: '4h' });
    expect(chartOf(useStore).getState().live).toBe(true);
    chartOf(useStore).getState().setLive(false);
  });

  it('flipping on the lowest timeframe only persists', async () => {
    const { useStore, history } = await setup('1m');
    useStore.getState().setBuildTimeframes(true);
    expect(history).not.toHaveBeenCalled();
    expect(useStore.getState().buildTimeframes).toBe(true);
  });

  it('flipping on the demo provider or with a CSV dataset only persists', async () => {
    const demo = await setup('4h', 'demo');
    demo.useStore.getState().setBuildTimeframes(true);
    expect(demo.history).not.toHaveBeenCalled();
    const csv = await setup('4h');
    chartOf(csv.useStore).setState({ activeDatasetId: 'ds_1' });
    csv.useStore.getState().setBuildTimeframes(true);
    expect(csv.history).not.toHaveBeenCalled();
  });

  it('sends no source with the setting off', async () => {
    const { useStore, history } = await setup('4h');
    await chartOf(useStore).getState().loadData();
    expect(history.mock.calls[0][0]).not.toHaveProperty('source');
  });
});

describe('chart registry and flat prefs', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  });

  // Every key of the saved prefs, all away from its default.
  const seed = () => ({
    providerId: 'kraken',
    symbol: 'XBTUSD',
    timeframe: '4h',
    bars: 321,
    indicators: [{ id: 'seed_sma', kind: 'sma', params: { length: 7 }, color: '#123456', visible: true }],
    btConfig: { strategyId: 'sma-cross', params: { fast: 3, slow: 9 }, initialCapital: 12345, positionSizePct: 50, feeBps: 7, slippageBps: 3, allowShort: true },
    showTrades: false,
    timeZone: 'Asia/Tehran',
    btRange: { from: 100, to: 200 },
    sidebarWidth: 333,
    pineWidth: 444,
    dockHeight: 255,
    sidePanel: 'data',
    sidePanelCollapsed: true,
    drawingMagnet: true,
    drawingMagnetStrength: 'strong',
    drawingsLocked: true,
    drawingStayMode: true,
    drawingsHidden: true,
    drawingDefaults: { trendLine: { width: 3 } },
    drawingFavorites: ['ray', 'eraser'],
    drawingLastTool: { lines: 'ray', cursors: 'cursor.dot' },
    glyphArmed: { emoji: '1f600' },
    glyphRecent: { emoji: ['1f600'] },
    cursorKind: 'dot',
    favoritesBarPos: { x: 120, y: 44 },
    buildTimeframes: true,
    customTimeframes: ['2h'],
  });

  it('opens with exactly one chart, chart-1, built from the saved prefs', async () => {
    const prefs = seed();
    localStorage.setItem('vost.prefs.v1', JSON.stringify(prefs));
    const { useStore, getActiveChart, FIRST_CHART_ID } = await import('./store');
    track(useStore);
    useStore.getState().init();
    const app = useStore.getState();
    expect(FIRST_CHART_ID).toBe('chart-1');
    expect(Object.keys(app.charts)).toEqual(['chart-1']);
    expect(app.activeChartId).toBe('chart-1');
    expect(getActiveChart()).toBe(app.charts['chart-1']);
    const c = getActiveChart().getState();
    expect(c.id).toBe('chart-1');
    expect([c.providerId, c.symbol, c.timeframe, c.bars]).toEqual(['kraken', 'XBTUSD', '4h', 321]);
    expect(c.indicators).toEqual(prefs.indicators);
    expect(c.btConfig).toMatchObject(prefs.btConfig);
    expect(c.showTrades).toBe(false);
    expect(c.btRange).toEqual({ from: 100, to: 200 });
    expect(app.timeZone).toBe('Asia/Tehran');
    expect([app.sidebarWidth, app.pineWidth, app.dockHeight]).toEqual([333, 444, 255]);
    expect([app.drawingMagnetStrength, app.drawingsLocked, app.drawingStayMode]).toEqual(['strong', true, true]);
    expect([app.sidePanel, app.sidePanelCollapsed, app.drawingMagnet, app.drawingsHidden, app.buildTimeframes]).toEqual(['data', true, true, true, true]);
  });

  it('reads the drawing rail prefs with sanitising, and old prefs without them load the defaults', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    localStorage.setItem(
      'vost.prefs.v1',
      JSON.stringify({ ...seed(), drawingFavorites: ['ray', 'nope', 'ray', 7], drawingLastTool: { lines: 'rectangle', shapes: 'rectangle' }, cursorKind: 'star', favoritesBarPos: { x: 'a', y: 2 } }),
    );
    useStore.getState().init();
    let app = useStore.getState();
    expect(app.drawingFavorites).toEqual(['ray']);
    expect(app.drawingLastTool).toEqual({ shapes: 'rectangle' });
    expect(app.cursorKind).toBe('cross');
    expect(app.favoritesBarPos).toEqual({ x: 56, y: 12 });
    const old: Record<string, unknown> = seed();
    for (const k of ['drawingFavorites', 'drawingLastTool', 'cursorKind', 'favoritesBarPos']) delete old[k];
    localStorage.setItem('vost.prefs.v1', JSON.stringify(old));
    useStore.getState().init();
    app = useStore.getState();
    expect([app.drawingFavorites, app.drawingLastTool, app.cursorKind, app.favoritesBarPos]).toEqual([[], {}, 'cross', { x: 56, y: 12 }]);
  });

  it('reads the glyph picks with sanitising: unknown tools and bad ids dropped, recents capped at 16', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    const many = Array.from({ length: 30 }, (_, i) => `g${i}`);
    localStorage.setItem(
      'vost.prefs.v1',
      JSON.stringify({ ...seed(), glyphArmed: { icon: 'star', emoji: 7, sticker: '', ray: 'x' }, glyphRecent: { icon: ['a', 'a', 5, '', 'b'], emoji: many, ray: ['x'], sticker: 'nope' } }),
    );
    useStore.getState().init();
    let app = useStore.getState();
    expect(app.glyphArmed).toEqual({ icon: 'star' });
    expect(app.glyphRecent.icon).toEqual(['a', 'b']);
    expect(app.glyphRecent.emoji).toEqual(many.slice(0, 16));
    expect(Object.keys(app.glyphRecent).sort()).toEqual(['emoji', 'icon']);
    const old: Record<string, unknown> = seed();
    delete old.glyphArmed;
    delete old.glyphRecent;
    localStorage.setItem('vost.prefs.v1', JSON.stringify(old));
    useStore.getState().init();
    app = useStore.getState();
    expect([app.glyphArmed, app.glyphRecent]).toEqual([{}, {}]);
  });

  it('arms a glyph tool and keeps its last 16 picks newest first, once each', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    useStore.getState().init();
    const s = useStore.getState();
    for (let i = 0; i < 20; i++) s.pickGlyph('emoji', `e${i}`);
    s.pickGlyph('emoji', 'e10');
    s.pickGlyph('ray', 'nope'); // not a glyph tool
    const app = useStore.getState();
    expect(app.glyphArmed).toEqual({ emoji: 'e10' });
    expect(app.glyphRecent.emoji).toHaveLength(16);
    expect(app.glyphRecent.emoji.slice(0, 3)).toEqual(['e10', 'e19', 'e18']);
    expect(app.glyphRecent.ray).toBeUndefined();
    useStore.getState().flushPersist();
    expect(JSON.parse(localStorage.getItem('vost.prefs.v1')!).glyphArmed).toEqual({ emoji: 'e10' });
  });

  it('toggles favourites and remembers the last tool of a family', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    useStore.getState().init();
    const s = useStore.getState();
    s.toggleDrawingFavorite('ray');
    s.toggleDrawingFavorite('trendLine');
    s.toggleDrawingFavorite('bogus');
    expect(useStore.getState().drawingFavorites).toEqual(['ray', 'trendLine']);
    s.toggleDrawingFavorite('ray');
    expect(useStore.getState().drawingFavorites).toEqual(['trendLine']);
    s.setDrawingLastTool('lines', 'ray');
    s.setDrawingLastTool('lines', 'rectangle'); // not in the family: dropped
    expect(useStore.getState().drawingLastTool).toEqual({ lines: 'ray' });
  });

  it('writes prefs.v1 back flat with the same keys, from the chart and the app together', async () => {
    const prefs = seed();
    localStorage.setItem('vost.prefs.v1', JSON.stringify(prefs));
    const { useStore, getActiveChart } = await import('./store');
    track(useStore);
    useStore.getState().init();
    getActiveChart().getState().setBars(77); // a chart field
    useStore.getState().setDockHeight(260); // an app field
    useStore.getState().flushPersist();
    const saved = JSON.parse(localStorage.getItem('vost.prefs.v1')!);
    expect(Object.keys(saved).sort()).toEqual(Object.keys(prefs).sort());
    expect(saved.bars).toBe(77);
    expect(saved.dockHeight).toBe(260);
    // an older build, compare.ts and the e2e seeds read these straight off the top level
    expect(saved.indicators).toEqual(prefs.indicators);
    expect(saved.providerId).toBe('kraken');
    expect(saved.timeZone).toBe('Asia/Tehran');
    expect(saved.buildTimeframes).toBe(true);
    expect(saved.drawingFavorites).toEqual(['ray', 'eraser']);
    expect(saved.drawingLastTool).toEqual({ lines: 'ray', cursors: 'cursor.dot' });
    expect(saved.cursorKind).toBe('dot');
    expect(saved.glyphArmed).toEqual({ emoji: '1f600' });
    expect(saved.favoritesBarPos).toEqual({ x: 120, y: 44 });
    for (const v of Object.values(saved)) expect(v).not.toHaveProperty('candles');
  });

  it('setBuildTimeframes reloads every chart whose source changes and no other', async () => {
    const { useStore, getActiveChart } = await import('./store');
    const { createChartStore, defaultChartInitial } = await import('./chart');
    const { getProvider } = await import('../lib/providers');
    track(useStore);
    const bars = Array.from({ length: 5 }, (_, i) => ({ time: 1_700_000_000 + i * 3600, open: 1, high: 2, low: 1, close: 2, volume: 1 }));
    const history = vi.spyOn(getProvider('binance'), 'fetchHistory').mockImplementation(async () => bars);
    getProvider('binance').startLive = () => ({ stop() {} }); // charts load live by default: no real socket
    const first = getActiveChart();
    first.setState({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '4h', bars: 100 });
    // a second chart in the registry: on the lowest timeframe, so the setting does not change its source
    const second = createChartStore('chart-2', { ...defaultChartInitial(), providerId: 'binance', symbol: 'ETHUSDT', timeframe: '1m', bars: 100 }, {
      pushToast: () => {},
      pushMessage: () => {},
      timeZone: () => 'UTC',
      buildTimeframes: () => useStore.getState().buildTimeframes,
      datasets: () => [],
      addDataset: () => {},
      removeDataset: () => {},
      onPrefsChange: () => {},
      onSync: () => {},
    });
    useStore.setState({ charts: { ...useStore.getState().charts, 'chart-2': second } });
    useStore.getState().setBuildTimeframes(true);
    await vi.waitFor(() => expect(history).toHaveBeenCalledTimes(1));
    expect(history.mock.calls[0][0]).toMatchObject({ symbol: 'BTCUSDT', timeframe: '4h', source: 'built' });
    expect(first.getState().candles).toHaveLength(5);
    expect(second.getState().candles).toEqual([]);
    // a second chart on a built timeframe reloads too
    second.setState({ timeframe: '4h' });
    history.mockClear();
    useStore.getState().setBuildTimeframes(false);
    await vi.waitFor(() => expect(history).toHaveBeenCalledTimes(2));
    expect(history.mock.calls.map((c) => c[0].symbol).sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(history.mock.calls.every((c) => !('source' in c[0]))).toBe(true);
  });

  it('openPineEditor selects the indicator on the active chart only', async () => {
    const { useStore, getActiveChart } = await import('./store');
    track(useStore);
    getActiveChart().setState({ selectedPineId: null });
    useStore.getState().openPineEditor('ind_x');
    expect(useStore.getState().pineOpen).toBe(true);
    expect(getActiveChart().getState().selectedPineId).toBe('ind_x');
  });

  it('addSymbolToWatchlist uses the active chart provider and loadSymbolCatalog takes the provider', async () => {
    const { useStore, getActiveChart } = await import('./store');
    const { getProvider } = await import('../lib/providers');
    track(useStore);
    getActiveChart().setState({ providerId: 'kraken' });
    useStore.getState().addSymbolToWatchlist({ symbol: 'ZZZ', label: 'ZZZ' });
    const items = useStore.getState().watchlists.lists.flatMap((l) => l.sections.flatMap((s) => s.items));
    expect(items.find((i) => i.symbol === 'ZZZ')?.providerId).toBe('kraken');
    const bybit = getProvider('bybit');
    bybit.listSymbols = async () => [{ symbol: 'QQQ', label: 'QQQ' }];
    await useStore.getState().loadSymbolCatalog('bybit');
    expect(useStore.getState().symbolCatalog.bybit).toEqual([{ symbol: 'QQQ', label: 'QQQ' }]);
  });
});

describe('custom timeframes', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  });
  const saved = () => JSON.parse(localStorage.getItem('vost.prefs.v1')!);
  const base = { providerId: 'coinbase', symbol: 'BTC-USD', timeframe: '1h', bars: 100 };
  async function fresh() {
    const { useStore } = await import('./store');
    track(useStore);
    useStore.getState().init();
    return useStore;
  }

  it('adds canonical intervals once, persists them and a fresh store restores them', async () => {
    vi.useFakeTimers();
    const useStore = await fresh();
    useStore.getState().addCustomTimeframe('2h');
    useStore.getState().addCustomTimeframe('2h');
    useStore.getState().addCustomTimeframe('10m');
    vi.advanceTimersByTime(1000);
    expect(saved().customTimeframes).toEqual(['2h', '10m']);
    vi.resetModules();
    const again = await fresh();
    expect(again.getState().customTimeframes).toEqual(['2h', '10m']);
  });

  it('stops at 20', async () => {
    const useStore = await fresh();
    for (let i = 2; i < 30; i++) useStore.getState().addCustomTimeframe(`${i}m`);
    expect(useStore.getState().customTimeframes).toHaveLength(20);
  });

  it('restores a chart left on a custom interval', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, timeframe: '2h', customTimeframes: ['2h'] }));
    const useStore = await fresh();
    expect(chartOf(useStore).getState().timeframe).toBe('2h');
  });

  it('drops bad saved lists and a bad saved timeframe without a toast', async () => {
    for (const bad of ['2h', [1, '120m', 'x'], Array.from({ length: 30 }, (_, i) => `${i + 2}m`)]) {
      localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, timeframe: '120m', customTimeframes: bad }));
      vi.resetModules();
      const useStore = await fresh();
      expect(useStore.getState().customTimeframes.length).toBe(Array.isArray(bad) && bad.length === 30 ? 20 : 0);
      expect(chartOf(useStore).getState().timeframe).toBe('1h');
      expect(useStore.getState().toasts).toEqual([]);
    }
  });

  it('removing the active interval moves the chart to the provider default', async () => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ ...base, timeframe: '2h', customTimeframes: ['2h'] }));
    const useStore = await fresh();
    useStore.getState().removeCustomTimeframe('2h');
    expect(useStore.getState().customTimeframes).toEqual([]);
    expect(chartOf(useStore).getState().timeframe).toBe('1h');
  });
});
