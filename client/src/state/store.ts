/**
 * Application store (zustand): everything shared by the whole app - layout, preferences, saved datasets,
 * watchlists, toasts and the inbox - plus the registry of chart stores. A chart's own state (data, indicators,
 * replay, backtest, live stream) lives in its chart store (./chart); the app and the chart meet in `ChartEnv`.
 *
 * `prefs.v1` stays one flat object: the app writes the active chart's fields together with its own.
 */
import { DEFAULT_BAR_POS, sanitizeBarPos, sanitizeCursorKind, sanitizeFavorites, sanitizeLastTool, type BarPos, type CursorKind } from '../lib/drawingRail';
import { create } from 'zustand';
import type { Dataset } from '../types';
import { uid } from '../types';
import { appendMessage, markAllRead, type InboxMessage, type MessageSeverity } from '../lib/messages';
import { sourceBase } from '../../../shared/timeframes.ts';
import { getProvider, providers, type SymbolSuggestion } from '../lib/providers';
import { loadJson, saveJson, debounce, removeKey } from '../lib/storage';
import { browserTimeZone, isValidTimeZone } from '../lib/time';
import type { SyncChange } from '../lib/layoutSync';
import { sanitizeTimeRange } from '../lib/timeRange';
import * as wl from '../lib/watchlist';
import { DOCK_DEFAULT, PINE_DEFAULT, SIDEBAR_DEFAULT, sanitizeStoredSize } from '../lib/paneSizes';
import {
  DEFAULT_ARRANGEMENT_ID,
  LAYOUT_KEY,
  LAYOUT_VERSION,
  DEFAULT_SYNC,
  sanitizeSync,
  type LayoutSync,
  evenSizes,
  getArrangement,
  parseLayout,
  sanitizeSizes,
  type LayoutSizes,
  type LayoutRecord,
  type ParsedLayout,
} from '../lib/layouts';
import type { HistoryLoading } from '../lib/historyPaging';
import * as sl from '../lib/savedLayouts';
import { createChartStore, defaultChartInitial, type ChartEnv, type ChartInitial, type ChartStore } from './chart';
import type { IndicatorSpec } from '../lib/indicatorCompute';
import type { BacktestConfig } from '../lib/backtest/types';
import type { Interval } from '../types';
import { servable, MAX_CUSTOM_TIMEFRAMES, sanitizeCustomTimeframes } from '../lib/customTimeframes';
import { sanitizeArmed, sanitizeRecent, withRecent } from '../lib/iconSets/prefs';
import { isGlyphKind } from '../lib/iconSets/types';
import { sanitizeDefaults } from '../lib/drawingStyle';
import { toolSettings } from '../components/chart/tools';
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
  drawingMagnetStrength?: 'weak' | 'strong';
  drawingsLocked?: boolean;
  drawingStayMode?: boolean;
  drawingsHidden?: boolean;
  /** The style new drawings of a tool start with, per tool id (see lib/drawingStyle). */
  drawingDefaults?: Record<string, Record<string, unknown>>;
  drawingFavorites?: string[];
  drawingLastTool?: Record<string, string>;
  glyphArmed?: Record<string, string>;
  glyphRecent?: Record<string, string[]>;
  cursorKind?: CursorKind;
  favoritesBarPos?: BarPos;
  buildTimeframes?: boolean;
  historyLoading?: HistoryLoading;
  customTimeframes?: Interval[];
}

/** The sections of the right-hand side panel; one shows at a time. */
export type SidePanelSection = 'watchlist' | 'data' | 'indicators' | 'objects';
const SIDE_PANEL_SECTIONS: readonly SidePanelSection[] = ['watchlist', 'data', 'indicators', 'objects'];


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

/** A chart's starting state from a saved record (`prefs.v1`, or one chart of `layout.v1`); bad fields fall back. */
function chartInitialFrom(p: Partial<Prefs>): ChartInitial {
  // A chart left on a provider that is gone opens on the default market, not on a fallback with the old symbol.
  const known = providers.some((x) => x.id === p.providerId);
  return {
    providerId: known ? (p.providerId as string) : defaultPrefs.providerId,
    symbol: known ? (p.symbol ?? defaultPrefs.symbol) : defaultPrefs.symbol,
    timeframe: known ? (typeof p.timeframe === 'string' && canonicalInterval(p.timeframe) === p.timeframe ? p.timeframe : defaultPrefs.timeframe) : defaultPrefs.timeframe,
    bars: p.bars ?? defaultPrefs.bars,
    indicators: Array.isArray(p.indicators) && p.indicators.length > 0 ? p.indicators : defaultPrefs.indicators,
    btConfig: { ...defaultPrefs.btConfig, ...(p.btConfig ?? {}) },
    showTrades: p.showTrades ?? true,
    btRange: sanitizeTimeRange(p.btRange),
  };
}

/** The id of the one chart the app opens with. */
export const FIRST_CHART_ID = 'chart-1';

/** The layout as `layout.v1` and every named layout keep it: the arrangement, each chart's own fields, sizes and sync. */
export function layoutSnapshot(s: Pick<AppState, 'arrangementId' | 'activeChartId' | 'chartOrder' | 'charts' | 'layoutSizes' | 'sync'>): LayoutRecord {
  return {
    version: LAYOUT_VERSION,
    arrangementId: s.arrangementId,
    activeChartId: s.activeChartId,
    charts: s.chartOrder.map((id) => {
      const c = s.charts[id].getState();
      return {
        id,
        providerId: c.providerId,
        symbol: c.symbol,
        timeframe: c.timeframe,
        bars: c.bars,
        indicators: c.indicators,
        btConfig: c.btConfig,
        showTrades: c.showTrades,
        btRange: c.btRange,
      };
    }),
    sizes: s.layoutSizes,
    sync: s.sync,
  };
}

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
  /** How far the magnet reaches; an old magnet-on pref loads as weak. */
  drawingMagnetStrength: 'weak' | 'strong';
  /** Lock all drawings: none can be moved (their own lock flags are untouched). */
  drawingsLocked: boolean;
  /** Stay in drawing mode: the tool stays picked after each drawing. */
  drawingStayMode: boolean;
  drawingsHidden: boolean;
  drawingDefaults: Record<string, Record<string, unknown>>;
  /** Rail entry keys (see lib/drawingRail.ts) the person starred, in the order the favourites bar shows them. */
  drawingFavorites: string[];
  /** The last entry used from each rail family, shown on the family's button. */
  drawingLastTool: Record<string, string>;
  /** The icon, emoji or sticker each glyph tool places next (the entry id), by tool id. */
  glyphArmed: Record<string, string>;
  /** The last picks of each glyph tool, newest first (up to 16). */
  glyphRecent: Record<string, string[]>;
  /** How the cursor mode looks on the chart. */
  cursorKind: CursorKind;
  /** Top-left of the floating favourites bar inside the chart area, in px. */
  favoritesBarPos: BarPos;
  /** Build every timeframe above the provider's lowest from the next lower native one, instead of the exchange's own bars. */
  buildTimeframes: boolean;
  /** How a chart's history loads: the latest page and older pages on scroll, or everything at once. */
  historyLoading: HistoryLoading;
  /** Intervals the person added from the timeframe picker (canonical, at most 20; one list for the whole app). */
  customTimeframes: Interval[];

  /** The chart stores by id, and which one the panels outside the chart are bound to. */
  charts: Record<string, ChartStore>;
  activeChartId: string;
  /** The layout: which arrangement (lib/layouts), the chart ids in cell order, and the grid's track sizes. */
  arrangementId: string;
  chartOrder: string[];
  /** Which changes on one chart carry to every chart of the layout (persisted with it). */
  sync: LayoutSync;
  layoutSizes: LayoutSizes;
  /** Counts the times the charts were rebuilt from a layout, so the grid mounts fresh panels for them. */
  layoutGen: number;
  /** The named layouts kept in the browser (lib/savedLayouts). */
  savedLayouts: sl.SavedLayoutsState;
  /** The working layout differs from the current named layout's saved snapshot. */
  layoutDirty: boolean;

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
  /** Writes the working layout into the current named layout. */
  saveLayout(): void;
  setAutosave(on: boolean): void;
  /** Keeps the working layout under a new name and makes that the current layout; false when the name is empty. */
  copyLayout(name: string): boolean;
  renameLayout(id: string, name: string): boolean;
  /** Opens a one-chart layout on the active chart's market and makes it current; false when the name is empty. */
  createLayout(name: string): boolean;
  /** Replaces every chart with the named layout's; false when there is none by that id. */
  openLayout(id: string): boolean;
  /** Deletes a named layout; the current one is refused (false). */
  deleteLayout(id: string): boolean;
  /** Run any pending debounced saves (prefs, watchlists, datasets) now. */
  flushPersist(): void;
  /** Shows this arrangement: new charts copy the active chart's market, dropped ones (from the end) are stopped and removed. */
  setArrangement(id: string): void;
  /** Makes a chart the one the top bar and panels act on. */
  setActiveChart(id: string): void;
  setLayoutSizes(sizes: LayoutSizes): void;
  setSync(key: keyof LayoutSync, on: boolean): void;
  /** Turns building higher timeframes from lower ones on or off; reloads every remote chart whose source changes. */
  setBuildTimeframes(v: boolean): void;
  setHistoryLoading(v: HistoryLoading): void;
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
  setDrawingMagnetStrength(v: 'weak' | 'strong'): void;
  setDrawingsLocked(v: boolean): void;
  setDrawingStayMode(v: boolean): void;
  setDrawingsHidden(v: boolean): void;
  /** Saves (or with null clears) the style new drawings of a tool start with. */
  setDrawingDefault(tool: string, style: Record<string, unknown> | null): void;
  toggleDrawingFavorite(key: string): void;
  setDrawingLastTool(group: string, key: string): void;
  /** Arms a glyph tool with an entry and adds it to the tool's recent picks. */
  pickGlyph(tool: string, id: string): void;
  setCursorKind(kind: CursorKind): void;
  setFavoritesBarPos(pos: BarPos): void;
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
      drawingMagnetStrength: s.drawingMagnetStrength,
      drawingsLocked: s.drawingsLocked,
      drawingStayMode: s.drawingStayMode,
      drawingsHidden: s.drawingsHidden,
      drawingDefaults: s.drawingDefaults,
      drawingFavorites: s.drawingFavorites,
      drawingLastTool: s.drawingLastTool,
      glyphArmed: s.glyphArmed,
      glyphRecent: s.glyphRecent,
      cursorKind: s.cursorKind,
      favoritesBarPos: s.favoritesBarPos,
      buildTimeframes: s.buildTimeframes,
      historyLoading: s.historyLoading,
      customTimeframes: s.customTimeframes,
    } satisfies Prefs);
  }, 400);

  /** Stores the named layouts and keeps the "unsaved" flag in step with them. */
  function commitSaved(next: sl.SavedLayoutsState): void {
    set({ savedLayouts: next });
    sl.saveSavedLayouts(next);
    refreshDirty();
  }

  function refreshDirty(): void {
    const s = get();
    const dirty = sl.isDirty(sl.currentEntry(s.savedLayouts), layoutSnapshot(s));
    if (dirty !== s.layoutDirty) set({ layoutDirty: dirty });
  }

  const writeLayout = debounce(() => {
    const s = get();
    const snapshot = layoutSnapshot(s);
    saveJson(LAYOUT_KEY, snapshot);
    if (s.savedLayouts.autosave) {
      const cur = sl.currentEntry(s.savedLayouts);
      if (cur && sl.isDirty(cur, snapshot)) commitSaved(sl.writeSnapshot(s.savedLayouts, cur.id, snapshot));
    }
    refreshDirty();
  }, 400);

  /** A layout change: the unsaved flag follows at once, the working copy (and, with autosave on, the current named layout) is written after the debounce. */
  const persistLayout = () => {
    refreshDirty();
    writeLayout();
  };

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

  /**
   * Toast texts already shown for the sync being applied: the receiving charts raise the same refusal (live on,
   * too few bars), and it should reach the person once. Cleared when every pending sync has settled.
   */
  const syncToasts = new Set<string>();
  let syncPending = 0;

  /** Resolves once the chart's load in flight (if any) has finished, so the toast window outlives the receivers' loads. */
  function loadSettled(chart: ReturnType<typeof get>['charts'][string]): Promise<void> {
    return new Promise((resolve) => {
      if (chart.getState().loadState !== 'loading') return resolve();
      const unsub = chart.subscribe((st) => {
        if (st.loadState !== 'loading') {
          unsub();
          resolve();
        }
      });
    });
  }

  /** Applies a change made on chart `sourceId` to every other chart, when its switch is on. Receivers never announce again. */
  function applySync(sourceId: string, change: SyncChange): void {
    const s = get();
    const flag = change.kind === 'range' ? s.sync.dateRange : s.sync[change.kind];
    if (!flag) return;
    const others = s.chartOrder.filter((id) => id !== sourceId && s.charts[id]);
    if (others.length === 0) return;
    const quiet = { broadcast: false };
    const pending: Array<Promise<unknown>> = [];
    const kept: string[] = [];
    syncPending++;
    for (const id of others) {
      const chart = s.charts[id].getState();
      if (change.kind === 'symbol') {
        chart.openWatchItem(change.providerId, change.symbol, quiet);
        pending.push(loadSettled(s.charts[id]));
      } else if (change.kind === 'interval') {
        if (servable(getProvider(chart.providerId), change.timeframe)) {
          chart.setTimeframe(change.timeframe, quiet);
          pending.push(loadSettled(s.charts[id]));
        } else kept.push(`Chart ${s.chartOrder.indexOf(id) + 1}`);
      } else if (change.range) pending.push(chart.setChartRange(change.range, quiet));
      else pending.push(chart.clearChartRange(quiet));
    }
    if (kept.length && change.kind === 'interval') {
      get().pushToast('info', `${kept.join(', ')} kept their own interval: their data source does not serve ${change.timeframe}.`);
    }
    void Promise.allSettled(pending).then(() => {
      if (--syncPending === 0) syncToasts.clear();
    });
  }

  /** What every chart sees of the app. */
  const chartEnv: ChartEnv = {
    pushToast: (kind, text) => {
      if (syncPending > 0) {
        if (syncToasts.has(text)) return;
        syncToasts.add(text);
      }
      get().pushToast(kind, text);
    },
    pushMessage: (source, severity, text) => get().pushMessage(source, severity, text),
    timeZone: () => get().timeZone,
    buildTimeframes: () => get().buildTimeframes,
    historyLoading: () => get().historyLoading,
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
    onPrefsChange: () => {
      persistPrefs();
      persistLayout();
    },
    onSync: applySync,
  };

  /**
   * Stops every chart the app has and builds the charts of a layout (else one chart from the saved prefs): the
   * state fields for them, with the charts not yet loading. Init and opening a named layout both use it.
   */
  function buildLayout(layout: ParsedLayout | null, prefs: Prefs) {
    for (const old of Object.values(get().charts)) old.getState().clearData();
    const arrangement = layout?.arrangement ?? getArrangement(DEFAULT_ARRANGEMENT_ID)!;
    const records: Array<Partial<Prefs> & { id?: string }> = layout ? layout.charts : [{ ...prefs, id: FIRST_CHART_ID }];
    const built = records.map((rec) => {
      const id = rec.id ?? FIRST_CHART_ID;
      return [id, createChartStore(id, chartInitialFrom(rec), chartEnv)] as const;
    });
    return {
      charts: Object.fromEntries(built),
      chartOrder: built.map(([id]) => id),
      activeChartId: layout?.activeChartId ?? built[0][0],
      arrangementId: arrangement.id,
      layoutSizes: layout?.sizes ?? evenSizes(arrangement),
      sync: layout?.sync ?? DEFAULT_SYNC,
      layoutGen: get().layoutGen + 1,
    };
  }

  /** Makes a layout record the working layout: rebuilds the charts, writes `layout.v1` and the prefs, and loads each chart's data. */
  function applyLayoutRecord(record: LayoutRecord): void {
    writeLayout.cancel();
    const fields = buildLayout(parseLayout(record), defaultPrefs);
    set(fields);
    saveJson(LAYOUT_KEY, layoutSnapshot(get()));
    persistPrefs();
    for (const chart of Object.values(fields.charts)) void chart.getState().loadData();
  }

  const firstCharts = { [FIRST_CHART_ID]: createChartStore(FIRST_CHART_ID, defaultChart, chartEnv) };
  const firstSizes = evenSizes(getArrangement(DEFAULT_ARRANGEMENT_ID)!);

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
    drawingMagnetStrength: 'weak',
    drawingsLocked: false,
    drawingStayMode: false,
    drawingsHidden: false,
    drawingDefaults: {},
    drawingFavorites: [],
    drawingLastTool: {},
    glyphArmed: {},
    glyphRecent: {},
    cursorKind: 'cross',
    favoritesBarPos: { ...DEFAULT_BAR_POS },
    buildTimeframes: false,
    historyLoading: 'scroll',
    customTimeframes: [],
    charts: firstCharts,
    activeChartId: FIRST_CHART_ID,
    arrangementId: DEFAULT_ARRANGEMENT_ID,
    chartOrder: [FIRST_CHART_ID],
    sync: DEFAULT_SYNC,
    layoutSizes: firstSizes,
    layoutGen: 0,
    savedLayouts: sl.seedFrom(
      layoutSnapshot({
        arrangementId: DEFAULT_ARRANGEMENT_ID,
        activeChartId: FIRST_CHART_ID,
        chartOrder: [FIRST_CHART_ID],
        charts: firstCharts,
        layoutSizes: firstSizes,
        sync: DEFAULT_SYNC,
      }),
    ),
    layoutDirty: false,
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
      writeLayout.flush();
      persistWatchlists.flush();
      persistDatasets.flush();
    },

    init() {
      // The exchange symbol lists used to be cached in the browser; the server caches them now.
      for (const id of ['binance', 'coinbase', 'kraken', 'bybit', 'okx']) removeKey(`${id}.symbols.v1`);
      const prefs = loadJson<Prefs>(PREFS_KEY, defaultPrefs);
      const datasets = loadJson<Dataset[]>(DATASETS_KEY, []);
      // The charts are built from the saved layout, else from the saved prefs as one chart: they replace the placeholder the store opened with.
      const layout = parseLayout(loadJson<unknown>(LAYOUT_KEY, null));
      const fields = buildLayout(layout, prefs);
      set({
        watchlists: wl.loadWatchlists(providers),
        timeZone: isValidTimeZone(prefs.timeZone) ? prefs.timeZone : browserTimeZone(),
        sidebarWidth: sanitizeStoredSize(prefs.sidebarWidth, SIDEBAR_DEFAULT),
        pineWidth: sanitizeStoredSize(prefs.pineWidth, PINE_DEFAULT),
        dockHeight: sanitizeStoredSize(prefs.dockHeight, DOCK_DEFAULT),
        sidePanel: SIDE_PANEL_SECTIONS.includes(prefs.sidePanel as SidePanelSection) ? (prefs.sidePanel as SidePanelSection) : 'watchlist',
        sidePanelCollapsed: typeof prefs.sidePanelCollapsed === 'boolean' ? prefs.sidePanelCollapsed : false,
        drawingMagnet: prefs.drawingMagnet === true,
        drawingMagnetStrength: prefs.drawingMagnetStrength === 'strong' ? 'strong' : 'weak',
        drawingsLocked: prefs.drawingsLocked === true,
        drawingStayMode: prefs.drawingStayMode === true,
        drawingsHidden: prefs.drawingsHidden === true,
        drawingDefaults: sanitizeDefaults(prefs.drawingDefaults, toolSettings),
        drawingFavorites: sanitizeFavorites(prefs.drawingFavorites),
        drawingLastTool: sanitizeLastTool(prefs.drawingLastTool),
        glyphArmed: sanitizeArmed(prefs.glyphArmed),
        glyphRecent: sanitizeRecent(prefs.glyphRecent),
        cursorKind: sanitizeCursorKind(prefs.cursorKind),
        favoritesBarPos: sanitizeBarPos(prefs.favoritesBarPos),
        buildTimeframes: prefs.buildTimeframes === true,
        historyLoading: prefs.historyLoading === 'all' ? 'all' : 'scroll',
        customTimeframes: sanitizeCustomTimeframes(prefs.customTimeframes),
        datasets: Array.isArray(datasets) ? datasets : [],
        ...fields,
      });
      // The named layouts: the first run, or a corrupt key, makes one "Unnamed" from the working layout (nothing else is touched).
      const saved = sl.loadSavedLayouts();
      if (saved) set({ savedLayouts: saved, layoutDirty: sl.isDirty(sl.currentEntry(saved), layoutSnapshot(get())) });
      else commitSaved(sl.seedFrom(layoutSnapshot(get())));
      for (const chart of Object.values(fields.charts)) void chart.getState().loadData();
    },

    saveLayout() {
      const s = get();
      const cur = sl.currentEntry(s.savedLayouts);
      if (!cur) return;
      writeLayout.flush();
      commitSaved(sl.writeSnapshot(get().savedLayouts, cur.id, layoutSnapshot(get())));
    },

    setAutosave(on) {
      const next = sl.setAutosave(get().savedLayouts, on);
      if (next === get().savedLayouts) return;
      commitSaved(next);
      // Turning it on brings the saved layout up to date, so what it holds is never older than the screen.
      if (on) get().saveLayout();
    },

    copyLayout(name) {
      // Flush first: a pending autosave writes into the saved layouts, and the copy must build on that.
      writeLayout.flush();
      const next = sl.copyLayout(get().savedLayouts, name, layoutSnapshot(get()));
      if (next === get().savedLayouts) return false;
      commitSaved(next);
      return true;
    },

    renameLayout(id, name) {
      const next = sl.renameLayout(get().savedLayouts, id, name);
      if (next === get().savedLayouts) return false;
      commitSaved(next);
      return true;
    },

    createLayout(name) {
      if (!sl.cleanName(name)) return false;
      if (get().savedLayouts.autosave) writeLayout.flush();
      const from = activeChart().getState();
      const id = FIRST_CHART_ID;
      const record: LayoutRecord = {
        version: LAYOUT_VERSION,
        arrangementId: DEFAULT_ARRANGEMENT_ID,
        activeChartId: id,
        charts: [
          {
            id,
            providerId: from.providerId,
            symbol: from.symbol,
            timeframe: from.timeframe,
            bars: from.bars,
            indicators: defaultChart.indicators,
            btConfig: defaultChart.btConfig,
            showTrades: defaultChart.showTrades,
          },
        ],
        sizes: evenSizes(getArrangement(DEFAULT_ARRANGEMENT_ID)!),
        sync: DEFAULT_SYNC,
      };
      applyLayoutRecord(record);
      // The entry holds what the rebuilt charts say, so it starts out saved.
      commitSaved(sl.createLayout(get().savedLayouts, name, layoutSnapshot(get())));
      return true;
    },

    openLayout(id) {
      const target = get().savedLayouts.layouts.find((l) => l.id === id);
      if (!target) return false;
      if (id === get().savedLayouts.currentId) return true;
      // With autosave on the pending change reaches the layout being left first; with it off the person was asked.
      if (get().savedLayouts.autosave) writeLayout.flush();
      commitSaved(sl.setCurrent(get().savedLayouts, id));
      applyLayoutRecord(target.layout);
      refreshDirty();
      return true;
    },

    deleteLayout(id) {
      const next = sl.deleteLayout(get().savedLayouts, id);
      if (next === get().savedLayouts) return false;
      commitSaved(next);
      return true;
    },

    setArrangement(id) {
      const arrangement = getArrangement(id);
      const s = get();
      if (!arrangement || arrangement.id === s.arrangementId) return;
      const charts = { ...s.charts };
      let order = [...s.chartOrder];
      const created: ChartStore[] = [];
      if (arrangement.count > order.length) {
        const from = activeChart().getState();
        while (order.length < arrangement.count) {
          const cid = uid('chart-');
          const store = createChartStore(
            cid,
            { ...defaultChartInitial(), providerId: from.providerId, symbol: from.symbol, timeframe: from.timeframe, bars: from.bars },
            chartEnv,
          );
          charts[cid] = store;
          created.push(store);
          order.push(cid);
        }
      } else {
        for (const cid of order.slice(arrangement.count)) {
          charts[cid].getState().clearData();
          delete charts[cid];
        }
        order = order.slice(0, arrangement.count);
      }
      set({
        arrangementId: arrangement.id,
        chartOrder: order,
        charts,
        activeChartId: order.includes(s.activeChartId) ? s.activeChartId : order[0],
        layoutSizes: evenSizes(arrangement),
      });
      for (const store of created) void store.getState().loadData();
      persistPrefs();
      persistLayout();
    },

    setActiveChart(id) {
      if (!get().charts[id] || id === get().activeChartId) return;
      set({ activeChartId: id });
      persistPrefs();
      persistLayout();
    },

    setSync(key, on) {
      if (get().sync[key] === on) return;
      set({ sync: sanitizeSync({ ...get().sync, [key]: on }) });
      persistLayout();
    },

    setLayoutSizes(sizes) {
      const arrangement = getArrangement(get().arrangementId);
      if (!arrangement) return;
      set({ layoutSizes: sanitizeSizes(sizes, arrangement) });
      persistLayout();
    },

    setHistoryLoading(v) {
      set({ historyLoading: v === 'all' ? 'all' : 'scroll' });
      persistPrefs();
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
        chart.getState().setTimeframe(getProvider(providerId).defaultTimeframe, { load: activeDatasetId == null, broadcast: false });
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

    setDrawingMagnetStrength(v) {
      set({ drawingMagnetStrength: v });
      persistPrefs();
    },

    setDrawingsLocked(v) {
      set({ drawingsLocked: v });
      persistPrefs();
    },

    setDrawingStayMode(v) {
      set({ drawingStayMode: v });
      persistPrefs();
    },

    setDrawingsHidden(v) {
      set({ drawingsHidden: v });
      persistPrefs();
    },

    setDrawingDefault(tool, style) {
      const fields = toolSettings(tool);
      if (!fields) return;
      const next = { ...get().drawingDefaults };
      delete next[tool];
      const valid = style ? sanitizeDefaults({ [tool]: style }, toolSettings)[tool] : undefined;
      if (valid) next[tool] = valid;
      set({ drawingDefaults: next });
      persistPrefs();
    },

    toggleDrawingFavorite(key) {
      const cur = get().drawingFavorites;
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : sanitizeFavorites([...cur, key]);
      set({ drawingFavorites: next });
      persistPrefs();
    },

    setDrawingLastTool(group, key) {
      const cur = get().drawingLastTool;
      const next = sanitizeLastTool({ ...cur, [group]: key });
      if (next[group] !== key) return; // not an entry of that family
      set({ drawingLastTool: { ...cur, [group]: key } });
      persistPrefs();
    },

    pickGlyph(tool, id) {
      if (!isGlyphKind(tool) || !id) return;
      const { glyphArmed, glyphRecent } = get();
      set({ glyphArmed: { ...glyphArmed, [tool]: id }, glyphRecent: sanitizeRecent({ ...glyphRecent, [tool]: withRecent(glyphRecent[tool], id) }) });
      persistPrefs();
    },

    setCursorKind(kind) {
      set({ cursorKind: sanitizeCursorKind(kind) });
      persistPrefs();
    },

    setFavoritesBarPos(pos) {
      set({ favoritesBarPos: sanitizeBarPos(pos) });
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
