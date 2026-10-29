/**
 * Application store (zustand): everything shared by the whole app - layout, preferences, saved datasets,
 * watchlists, toasts and the inbox - plus the registry of chart stores. A chart's own state (data, indicators,
 * replay, backtest, live stream) lives in its chart store (./chart); the app and the chart meet in `ChartEnv`.
 *
 * `prefs.v1` stays one flat object: the app writes the active chart's fields together with its own.
 */
import { create } from 'zustand';
import type { Dataset } from '../types';
import { uid } from '../types';
import { appendMessage, markAllRead, type InboxMessage, type MessageSeverity } from '../lib/messages';
import { sourceBase } from '../../../shared/timeframes.ts';
import { getProvider, providers, type SymbolSuggestion } from '../lib/providers';
import { loadJson, saveJson, debounce, removeKey } from '../lib/storage';
import { browserTimeZone, isValidTimeZone } from '../lib/time';
import { sanitizeTimeRange } from '../lib/timeRange';
import * as wl from '../lib/watchlist';
import { DOCK_DEFAULT, PINE_DEFAULT, SIDEBAR_DEFAULT, sanitizeStoredSize } from '../lib/paneSizes';
import { createChartStore, defaultChartInitial, type ChartEnv, type ChartStore } from './chart';
import type { IndicatorSpec } from '../lib/indicatorCompute';
import type { BacktestConfig } from '../lib/backtest/types';
import type { Interval } from '../types';
import { MAX_CUSTOM_TIMEFRAMES, sanitizeCustomTimeframes } from '../lib/customTimeframes';
import { canonicalInterval } from '../../../shared/market.ts';
import type { TimeRange } from '../lib/timeRange';


export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  text: string;
}

function toastSource(text: string): string {
  if (/backtest|optimiz|parameter/i.test(text)) return 'Backtest';
  return 'Data';
}

export type DockTab = 'backtest' | 'optimizer' | 'results';


interface Prefs {
  providerId: string;
  symbol: string;
  timeframe: Interval;
  bars: number;
  indicators: IndicatorSpec[];
  btConfig: BacktestConfig;
  showTrades: boolean;
  timeZone?: string;
  btRange?: TimeRange;
  sidebarWidth?: number;
  pineWidth?: number;
  dockHeight?: number;
  sidePanel?: SidePanelSection;
  sidePanelCollapsed?: boolean;
  drawingMagnet?: boolean;
  drawingsHidden?: boolean;
  buildTimeframes?: boolean;
  customTimeframes?: Interval[];
}

/** The sections of the right-hand side panel; one shows at a time. */
export type SidePanelSection = 'watchlist' | 'data' | 'indicators';
const SIDE_PANEL_SECTIONS: readonly SidePanelSection[] = ['watchlist', 'data', 'indicators'];


const PREFS_KEY = 'prefs.v1';
const DATASETS_KEY = 'datasets.v1';
const MAX_PERSISTED_DATASETS_BYTES = 4_500_000;

const defaultChart = defaultChartInitial();
const defaultPrefs: Prefs = {
  providerId: defaultChart.providerId,
  symbol: defaultChart.symbol,
  timeframe: defaultChart.timeframe,
  bars: defaultChart.bars,
  indicators: defaultChart.indicators,
  btConfig: defaultChart.btConfig,
  showTrades: defaultChart.showTrades,
};

/** The id of the one chart the app opens with. */
export const FIRST_CHART_ID = 'chart-1';

export interface AppState {
  /** IANA zone every date on screen is shown in (candle times stay UTC). */
  timeZone: string;
  /** Bottom dock UI state (not persisted). */
  dockTab: DockTab;
  dockCollapsed: boolean;
  /** Whether the Pine editor pane is open (not persisted). */
  pineOpen: boolean;
  /** Pane sizes in px as the user last set them (persisted); the layout clamps them to the viewport. */
  sidebarWidth: number;
  pineWidth: number;
  dockHeight: number;
  /** The side panel's visible section and whether it is collapsed to its rail (persisted). */
  sidePanel: SidePanelSection;
  sidePanelCollapsed: boolean;
  drawingMagnet: boolean;
  drawingsHidden: boolean;
  /** Build every timeframe above the provider's lowest from the next lower native one, instead of the exchange's own bars. */
  buildTimeframes: boolean;
  /** Intervals the person added from the timeframe picker (canonical, at most 20; one list for the whole app). */
  customTimeframes: Interval[];

  /** The chart stores by id, and which one the panels outside the chart are bound to. */
  charts: Record<string, ChartStore>;
  activeChartId: string;

  /* saved local datasets */
  datasets: Dataset[];

  toasts: Toast[];
  messages: InboxMessage[];
  /** Full browsable symbol list per provider id, once loaded. */
  symbolCatalog: Record<string, SymbolSuggestion[]>;
  watchlists: wl.WatchlistState;

  /* actions */
  /** Applies a pure watchlist transform (see lib/watchlist.ts) and persists it. */
  updateWatchlists(fn: (s: wl.WatchlistState) => wl.WatchlistState): void;
  createWatchlist(name: string): void;
  renameWatchlist(listId: string, name: string): void;
  deleteWatchlist(listId: string): void;
  duplicateWatchlist(listId: string): void;
  setActiveWatchlist(listId: string): void;
  addWatchSection(listId: string, name: string): void;
  renameWatchSection(listId: string, sectionId: string, name: string): void;
  removeWatchSection(listId: string, sectionId: string): void;
  moveWatchSection(listId: string, sectionId: string, toIndex: number): void;
  addWatchItem(listId: string, item: { providerId: string; symbol: string; label?: string }, sectionId?: string): void;
  removeWatchItem(listId: string, providerId: string, symbol: string): void;
  moveWatchItem(listId: string, providerId: string, symbol: string, toSectionId: string, toIndex: number): void;
  setWatchNote(listId: string, providerId: string, symbol: string, note: string): void;
  setWatchItemTags(listId: string, providerId: string, symbol: string, tags: string[]): void;
  createWatchTag(name: string, color: string): void;
  renameWatchTag(tagId: string, name: string): void;
  setWatchTagColor(tagId: string, color: string): void;
  deleteWatchTag(tagId: string): void;
  /** Imports an exported list; returns an error string or null on success. */
  importWatchlist(json: string): string | null;
  init(): void;
  /** Run any pending debounced saves (prefs, watchlists, datasets) now. */
  flushPersist(): void;
  /** Turns building higher timeframes from lower ones on or off; reloads every remote chart whose source changes. */
  setBuildTimeframes(v: boolean): void;
  /** Saves a custom interval (canonical form assumed); a duplicate or a full list is a no-op. */
  addCustomTimeframe(iv: Interval): void;
  /** Forgets a custom interval and moves every chart showing it to its provider's default timeframe. */
  removeCustomTimeframe(iv: Interval): void;
  setDockTab(tab: DockTab): void;
  setDockCollapsed(collapsed: boolean): void;
  setSidebarWidth(px: number): void;
  setPineWidth(px: number): void;
  setSidePanel(section: SidePanelSection): void;
  setSidePanelCollapsed(collapsed: boolean): void;
  /** Sets the expanded dock height; the collapsed state is untouched. */
  setDockHeight(px: number): void;
  /** Opens the Pine editor pane with this indicator selected on the active chart. */
  openPineEditor(id: string): void;
  closePineEditor(): void;
  togglePineEditor(): void;
  setDrawingMagnet(v: boolean): void;
  setDrawingsHidden(v: boolean): void;
  setTimeZone(tz: string): void;
  /** Loads a provider's full symbol list once (silent fallback to popular symbols on error). */
  loadSymbolCatalog(providerId: string): Promise<void>;
  /** Adds a suggestion to the active watchlist for the active chart's provider. */
  addSymbolToWatchlist(s: SymbolSuggestion): void;
  pushToast(kind: Toast['kind'], text: string): void;
  dismissToast(id: string): void;
  pushMessage(source: string, severity: MessageSeverity, text: string): void;
  markMessagesRead(): void;
  clearMessages(): void;
}


export const useStore = create<AppState>()((set, get) => {
  /** The chart the panels outside the chart are bound to. */
  const activeChart = (): ChartStore => get().charts[get().activeChartId];

  const persistPrefs = debounce(() => {
    const s = get();
    const c = activeChart().getState();
    saveJson(PREFS_KEY, {
      providerId: c.providerId,
      symbol: c.symbol,
      timeframe: c.timeframe,
      bars: c.bars,
      indicators: c.indicators,
      btConfig: c.btConfig,
      showTrades: c.showTrades,
      timeZone: s.timeZone,
      btRange: c.btRange,
      sidebarWidth: s.sidebarWidth,
      pineWidth: s.pineWidth,
      dockHeight: s.dockHeight,
      sidePanel: s.sidePanel,
      sidePanelCollapsed: s.sidePanelCollapsed,
      drawingMagnet: s.drawingMagnet,
      drawingsHidden: s.drawingsHidden,
      buildTimeframes: s.buildTimeframes,
      customTimeframes: s.customTimeframes,
    } satisfies Prefs);
  }, 400);

  const persistWatchlists = debounce(() => {
    wl.saveWatchlists(get().watchlists);
  }, 400);

  const persistDatasets = debounce(() => {
    const datasets = get().datasets;
    const res = saveJson(DATASETS_KEY, datasets);
    if (!res.ok) {
      get().pushToast('error', 'Browser storage full — dataset kept in memory only.');
    }
  }, 600);

  /** What every chart sees of the app. */
  const chartEnv: ChartEnv = {
    pushToast: (kind, text) => get().pushToast(kind, text),
    pushMessage: (source, severity, text) => get().pushMessage(source, severity, text),
    timeZone: () => get().timeZone,
    buildTimeframes: () => get().buildTimeframes,
    datasets: () => get().datasets,
    addDataset(dataset) {
      if (JSON.stringify(dataset).length > MAX_PERSISTED_DATASETS_BYTES) {
        get().pushToast('error', 'Dataset too large to persist in the browser (kept for this session only).');
        set({ datasets: [...get().datasets, dataset] });
        return;
      }
      set({ datasets: [...get().datasets, dataset] });
      persistDatasets();
    },
    removeDataset(id) {
      set({ datasets: get().datasets.filter((d) => d.id !== id) });
      persistDatasets();
    },
    onPrefsChange: () => persistPrefs(),
  };

  return {
    timeZone: browserTimeZone(),
    dockTab: 'backtest',
    dockCollapsed: false,
    sidebarWidth: SIDEBAR_DEFAULT,
    pineWidth: PINE_DEFAULT,
    pineOpen: false,
    dockHeight: DOCK_DEFAULT,
    sidePanel: 'watchlist',
    sidePanelCollapsed: false,
    drawingMagnet: false,
    drawingsHidden: false,
    buildTimeframes: false,
    customTimeframes: [],
    charts: { [FIRST_CHART_ID]: createChartStore(FIRST_CHART_ID, defaultChart, chartEnv) },
    activeChartId: FIRST_CHART_ID,
    datasets: [],
    toasts: [],
    messages: [],
    symbolCatalog: {},
    watchlists: wl.emptyState(),

    updateWatchlists(fn) {
      set({ watchlists: fn(get().watchlists) });
      persistWatchlists();
    },
    createWatchlist: (name) => get().updateWatchlists((s) => wl.createList(s, name)),
    renameWatchlist: (id, name) => get().updateWatchlists((s) => wl.renameList(s, id, name)),
    deleteWatchlist: (id) => get().updateWatchlists((s) => wl.deleteList(s, id)),
    duplicateWatchlist: (id) => get().updateWatchlists((s) => wl.duplicateList(s, id)),
    setActiveWatchlist: (id) => get().updateWatchlists((s) => wl.setActiveList(s, id)),
    addWatchSection: (id, name) => get().updateWatchlists((s) => wl.addSection(s, id, name)),
    renameWatchSection: (id, sec, name) => get().updateWatchlists((s) => wl.renameSection(s, id, sec, name)),
    removeWatchSection: (id, sec) => get().updateWatchlists((s) => wl.removeSection(s, id, sec)),
    moveWatchSection: (id, sec, to) => get().updateWatchlists((s) => wl.moveSection(s, id, sec, to)),
    addWatchItem: (id, item, sec) => get().updateWatchlists((s) => wl.addItem(s, id, item, sec)),
    removeWatchItem: (id, p, sym) => get().updateWatchlists((s) => wl.removeItem(s, id, p, sym)),
    moveWatchItem: (id, p, sym, sec, to) => get().updateWatchlists((s) => wl.moveItem(s, id, p, sym, sec, to)),
    setWatchNote: (id, p, sym, note) => get().updateWatchlists((s) => wl.setNote(s, id, p, sym, note)),
    setWatchItemTags: (id, p, sym, tags) => get().updateWatchlists((s) => wl.setItemTags(s, id, p, sym, tags)),
    createWatchTag: (name, color) => get().updateWatchlists((s) => wl.createTag(s, name, color)),
    renameWatchTag: (id, name) => get().updateWatchlists((s) => wl.renameTag(s, id, name)),
    setWatchTagColor: (id, color) => get().updateWatchlists((s) => wl.setTagColor(s, id, color)),
    deleteWatchTag: (id) => get().updateWatchlists((s) => wl.deleteTag(s, id)),
    importWatchlist(json) {
      const res = wl.importList(json, get().watchlists, providers);
      if (typeof res === 'string') return res;
      set({ watchlists: res });
      persistWatchlists();
      return null;
    },

    flushPersist() {
      persistPrefs.flush();
      persistWatchlists.flush();
      persistDatasets.flush();
    },

    init() {
      // The exchange symbol lists used to be cached in the browser; the server caches them now.
      for (const id of ['binance', 'coinbase', 'kraken', 'bybit', 'okx']) removeKey(`${id}.symbols.v1`);
      const prefs = loadJson<Prefs>(PREFS_KEY, defaultPrefs);
      const datasets = loadJson<Dataset[]>(DATASETS_KEY, []);
      // A chart left on a provider that is gone opens on the default market, not on a fallback with the old symbol.
      const known = providers.some((p) => p.id === prefs.providerId);
      const btConfig = { ...defaultPrefs.btConfig, ...(prefs.btConfig ?? {}) };
      // The chart is built from the saved prefs: a fresh one replaces the placeholder the store opened with.
      const old = get().charts[FIRST_CHART_ID];
      old.getState().clearData();
      const chart = createChartStore(
        FIRST_CHART_ID,
        {
          providerId: known ? prefs.providerId : defaultPrefs.providerId,
          symbol: known ? (prefs.symbol ?? defaultPrefs.symbol) : defaultPrefs.symbol,
          timeframe: known ? (typeof prefs.timeframe === 'string' && canonicalInterval(prefs.timeframe) === prefs.timeframe ? prefs.timeframe : defaultPrefs.timeframe) : defaultPrefs.timeframe,
          bars: prefs.bars ?? defaultPrefs.bars,
          indicators: Array.isArray(prefs.indicators) && prefs.indicators.length > 0 ? prefs.indicators : defaultPrefs.indicators,
          btConfig,
          showTrades: prefs.showTrades ?? true,
          btRange: sanitizeTimeRange(prefs.btRange),
        },
        chartEnv,
      );
      set({
        watchlists: wl.loadWatchlists(providers),
        timeZone: isValidTimeZone(prefs.timeZone) ? prefs.timeZone : browserTimeZone(),
        sidebarWidth: sanitizeStoredSize(prefs.sidebarWidth, SIDEBAR_DEFAULT),
        pineWidth: sanitizeStoredSize(prefs.pineWidth, PINE_DEFAULT),
        dockHeight: sanitizeStoredSize(prefs.dockHeight, DOCK_DEFAULT),
        sidePanel: SIDE_PANEL_SECTIONS.includes(prefs.sidePanel as SidePanelSection) ? (prefs.sidePanel as SidePanelSection) : 'watchlist',
        sidePanelCollapsed: typeof prefs.sidePanelCollapsed === 'boolean' ? prefs.sidePanelCollapsed : false,
        drawingMagnet: prefs.drawingMagnet === true,
        drawingsHidden: prefs.drawingsHidden === true,
        buildTimeframes: prefs.buildTimeframes === true,
        customTimeframes: sanitizeCustomTimeframes(prefs.customTimeframes),
        datasets: Array.isArray(datasets) ? datasets : [],
        charts: { ...get().charts, [FIRST_CHART_ID]: chart },
      });
      void chart.getState().loadData();
    },

    setBuildTimeframes(v) {
      const was = get().buildTimeframes;
      set({ buildTimeframes: v });
      persistPrefs();
      if (was === v) return;
      for (const chart of Object.values(get().charts)) {
        const { providerId, timeframe, activeDatasetId } = chart.getState();
        const provider = getProvider(providerId);
        if (provider.offline || activeDatasetId != null) continue;
        const native = provider.timeframes.filter((tf) => !(provider.builtTimeframes ?? []).includes(tf));
        if (sourceBase(native, timeframe, 'native') === sourceBase(native, timeframe, 'built')) continue;
        void chart.getState().loadData(); // keeps Live on: it stays set and loadData reconnects it
      }
    },

    addCustomTimeframe(iv) {
      const list = get().customTimeframes;
      if (list.includes(iv) || list.length >= MAX_CUSTOM_TIMEFRAMES) return;
      set({ customTimeframes: [...list, iv] });
      persistPrefs();
    },

    removeCustomTimeframe(iv) {
      set({ customTimeframes: get().customTimeframes.filter((x) => x !== iv) });
      persistPrefs();
      for (const chart of Object.values(get().charts)) {
        const { timeframe, providerId, activeDatasetId } = chart.getState();
        if (timeframe !== iv) continue;
        chart.getState().setTimeframe(getProvider(providerId).defaultTimeframe, { load: activeDatasetId == null });
      }
    },

    setDockTab(tab) {
      set({ dockTab: tab, dockCollapsed: false });
    },

    setDockCollapsed(collapsed) {
      set({ dockCollapsed: collapsed });
    },

    setSidebarWidth(px) {
      set({ sidebarWidth: sanitizeStoredSize(px, SIDEBAR_DEFAULT) });
      persistPrefs();
    },

    setPineWidth(px) {
      set({ pineWidth: sanitizeStoredSize(px, PINE_DEFAULT) });
      persistPrefs();
    },

    setSidePanel(section) {
      if (!SIDE_PANEL_SECTIONS.includes(section)) return;
      set({ sidePanel: section });
      persistPrefs();
    },

    setSidePanelCollapsed(collapsed) {
      set({ sidePanelCollapsed: collapsed === true });
      persistPrefs();
    },

    setDockHeight(px) {
      set({ dockHeight: sanitizeStoredSize(px, DOCK_DEFAULT) });
      persistPrefs();
    },

    openPineEditor(id) {
      activeChart().setState({ selectedPineId: id });
      set({ pineOpen: true });
    },

    closePineEditor() {
      set({ pineOpen: false });
    },

    togglePineEditor() {
      set((s) => ({ pineOpen: !s.pineOpen }));
    },

    setTimeZone(tz) {
      if (!isValidTimeZone(tz)) return;
      set({ timeZone: tz });
      persistPrefs();
    },

    setDrawingMagnet(v) {
      set({ drawingMagnet: v });
      persistPrefs();
    },

    setDrawingsHidden(v) {
      set({ drawingsHidden: v });
      persistPrefs();
    },

    async loadSymbolCatalog(providerId) {
      if (get().symbolCatalog[providerId]) return;
      const provider = getProvider(providerId);
      if (!provider.listSymbols) return;
      let list: SymbolSuggestion[];
      try {
        list = await provider.listSymbols();
        if (list.length === 0) list = provider.popularSymbols;
      } catch {
        list = provider.popularSymbols;
      }
      set({ symbolCatalog: { ...get().symbolCatalog, [providerId]: list } });
    },

    addSymbolToWatchlist(sug) {
      const { watchlists } = get();
      const { providerId } = activeChart().getState();
      const list = watchlists.lists.find((l) => l.id === watchlists.activeListId);
      if (!list) return;
      const exists = list.sections.some((sec) =>
        sec.items.some((it) => it.providerId === providerId && it.symbol === sug.symbol),
      );
      if (exists) {
        get().pushToast('info', `${sug.symbol} is already in ${list.name}.`);
        return;
      }
      get().updateWatchlists((s) =>
        wl.addItem(s, s.activeListId, { providerId, symbol: sug.symbol, label: sug.label }),
      );
      get().pushToast('success', `Added ${sug.symbol} to ${list.name}.`);
    },

    pushToast(kind, text) {
      const id = uid('toast_');
      set({ toasts: [...get().toasts, { id, kind, text }] });
      if (kind === 'error') get().pushMessage(toastSource(text), 'error', text);
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 5000);
    },

    pushMessage(source, severity, text) {
      const msg: InboxMessage = { id: uid('msg_'), time: Date.now(), source, severity, text, read: false };
      set({ messages: appendMessage(get().messages, msg) });
    },

    markMessagesRead() {
      set({ messages: markAllRead(get().messages) });
    },

    clearMessages() {
      set({ messages: [] });
    },

    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
  };
});

/** The chart the panels outside the chart are bound to, for imperative callers. */
export function getActiveChart(): ChartStore {
  const s = useStore.getState();
  return s.charts[s.activeChartId];
}
