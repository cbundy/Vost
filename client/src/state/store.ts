/**
 * Global application store (zustand). Owns chart data, indicators, local
 * datasets, live streaming and the backtest/optimizer lifecycle.
 *
 * Heavy computations run in a dedicated Web Worker; this module only talks to
 * it over a tiny promise-based message protocol.
 */
import { create } from 'zustand';
import type { Candle, Dataset, Timeframe } from '../types';
import { uid } from '../types';
import type { BacktestResult, BacktestConfig } from '../lib/backtest/types';
import { defaultBacktestConfig } from '../lib/backtest/types';
import type { OptimizeConfig, OptimizeRow, MetricKey } from '../lib/backtest/optimizer';
import { defaultOptimizeConfig } from '../lib/backtest/optimizer';
import { runFullBacktest } from '../lib/backtest/runner';
import type { IndicatorKind, IndicatorSpec } from '../lib/indicatorCompute';
import { defaultIndicator } from '../lib/indicatorCompute';
import { startBinanceLive, type LiveHandle, type LiveStatus } from '../lib/live';
import { getProvider, providers, type SymbolSuggestion } from '../lib/providers';
import { loadJson, saveJson, debounce } from '../lib/storage';
import * as wl from '../lib/watchlist';
import type { WorkerRequestBody, WorkerResponse } from '../lib/workers/backtest.worker';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export type LoadState = 'idle' | 'loading' | 'error' | 'ready';

interface Prefs {
  providerId: string;
  symbol: string;
  timeframe: Timeframe;
  bars: number;
  indicators: IndicatorSpec[];
  btConfig: BacktestConfig;
  showTrades: boolean;
}

const PREFS_KEY = 'prefs.v1';
const DATASETS_KEY = 'datasets.v1';
const MAX_PERSISTED_DATASETS_BYTES = 4_500_000;

const defaultPrefs: Prefs = {
  providerId: 'binance',
  symbol: 'BTCUSDT',
  timeframe: '1h',
  bars: 5000,
  indicators: [
    { ...defaultIndicator('volume'), id: 'ind_volume_default' },
    { ...defaultIndicator('sma'), params: { length: 20 }, id: 'ind_sma20_default', color: '#f59e0b' },
  ],
  btConfig: defaultBacktestConfig(),
  showTrades: true,
};

export interface AppState {
  /* preferences (persisted) */
  providerId: string;
  symbol: string;
  timeframe: Timeframe;
  bars: number;
  indicators: IndicatorSpec[];
  showTrades: boolean;

  /* market data */
  candles: Candle[];
  /** Changes whenever the full dataset is replaced (forces a chart rebuild). */
  dataKey: string;
  dataLabel: string;
  activeDatasetId: string | null;
  loadState: LoadState;

  /* saved local datasets */
  datasets: Dataset[];

  /* live streaming */
  live: boolean;
  liveStatus: LiveStatus;
  liveDetail: string;

  /* backtest */
  btConfig: BacktestConfig;
  btRunning: boolean;
  btProgress: number;
  btResult: BacktestResult | null;
  btError: string | null;

  /* optimizer */
  optConfig: OptimizeConfig;
  optRunning: boolean;
  optProgress: number;
  optResult: { rows: OptimizeRow[]; metric: MetricKey; combos: number; errored: number } | null;

  toasts: Toast[];
  symbolQuery: string;
  symbolSuggestions: SymbolSuggestion[];
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
  setProvider(id: string): void;
  setSymbol(symbol: string, opts?: { load?: boolean }): void;
  setTimeframe(tf: Timeframe, opts?: { load?: boolean }): void;
  setBars(bars: number): void;
  loadData(): Promise<void>;
  clearData(): void;
  addDataset(input: { name: string; candles: Candle[]; source: string; description: string; barSeconds: number; barLabel: string }): string;
  saveCurrentDataset(name?: string): void;
  activateDataset(id: string): void;
  removeDataset(id: string): void;
  addIndicator(kind: IndicatorKind): void;
  removeIndicator(id: string): void;
  updateIndicator(id: string, patch: Partial<Pick<IndicatorSpec, 'params' | 'color' | 'visible'>>): void;
  setShowTrades(v: boolean): void;
  setBtConfig(patch: Partial<BacktestConfig>): void;
  runBacktest(): Promise<void>;
  clearBacktest(): void;
  setOptConfig(patch: Partial<OptimizeConfig>): void;
  runOptimizer(): Promise<void>;
  applyOptimizeRow(row: OptimizeRow): Promise<void>;
  setLive(v: boolean): void;
  searchSymbols(query: string): Promise<void>;
  pushToast(kind: Toast['kind'], text: string): void;
  dismissToast(id: string): void;
}

/* ------------------------------------------------------------------ */
/* Web worker plumbing                                                 */
/* ------------------------------------------------------------------ */

let worker: Worker | null = null;
let workerBroken = false;
const pending = new Map<
  string,
  { resolve: (msg: WorkerResponse) => void; reject: (err: Error) => void; onProgress?: (pct: number) => void }
>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../lib/workers/backtest.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') {
        p.onProgress?.(msg.pct);
        return;
      }
      pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    worker.onerror = () => {
      workerBroken = true;
      for (const [, p] of pending) p.reject(new Error('Backtest worker crashed — falling back to main thread'));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    workerBroken = true;
    worker = null;
    return null;
  }
}

function workerCall(req: WorkerRequestBody, onProgress?: (pct: number) => void): Promise<WorkerResponse> {
  const w = getWorker();
  const id = uid('req_');
  if (!w) {
    // Main-thread fallback (e.g. workers unavailable).
    return new Promise((resolve, reject) => {
      try {
        if (req.type === 'run') {
          resolve({ id, type: 'result', result: runFullBacktest(req.candles, req.config) });
        } else {
          reject(new Error('Optimizer requires Web Worker support.'));
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ ...req, id });
  });
}

/* ------------------------------------------------------------------ */
/* Live streaming plumbing                                             */
/* ------------------------------------------------------------------ */

let liveHandle: LiveHandle | null = null;

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useStore = create<AppState>()((set, get) => {
  const persistPrefs = debounce(() => {
    const s = get();
    saveJson(PREFS_KEY, {
      providerId: s.providerId,
      symbol: s.symbol,
      timeframe: s.timeframe,
      bars: s.bars,
      indicators: s.indicators,
      btConfig: s.btConfig,
      showTrades: s.showTrades,
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

  const setCandles = (candles: Candle[], dataLabel: string, activeDatasetId: string | null) => {
    set({
      candles,
      dataKey: uid('data_'),
      dataLabel,
      activeDatasetId,
      loadState: 'ready',
      btResult: null,
      btError: null,
      optResult: null,
    });
  };

  const stopLive = () => {
    liveHandle?.stop();
    liveHandle = null;
    set({ live: false, liveStatus: 'off', liveDetail: '' });
  };

  return {
    ...defaultPrefs,
    candles: [],
    dataKey: '',
    dataLabel: '',
    activeDatasetId: null,
    loadState: 'idle',
    datasets: [],
    live: false,
    liveStatus: 'off',
    liveDetail: '',
    btRunning: false,
    btProgress: 0,
    btResult: null,
    btError: null,
    optConfig: defaultOptimizeConfig(defaultBacktestConfig()),
    optRunning: false,
    optProgress: 0,
    optResult: null,
    toasts: [],
    symbolQuery: '',
    symbolSuggestions: [],
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
      const res = wl.importList(json, get().watchlists);
      if (typeof res === 'string') return res;
      set({ watchlists: res });
      persistWatchlists();
      return null;
    },

    init() {
      const prefs = loadJson<Prefs>(PREFS_KEY, defaultPrefs);
      const datasets = loadJson<Dataset[]>(DATASETS_KEY, []);
      set({
        watchlists: wl.loadWatchlists(providers),
        providerId: prefs.providerId ?? defaultPrefs.providerId,
        symbol: prefs.symbol ?? defaultPrefs.symbol,
        timeframe: prefs.timeframe ?? defaultPrefs.timeframe,
        bars: prefs.bars ?? defaultPrefs.bars,
        indicators: Array.isArray(prefs.indicators) && prefs.indicators.length > 0 ? prefs.indicators : defaultPrefs.indicators,
        btConfig: { ...defaultPrefs.btConfig, ...(prefs.btConfig ?? {}) },
        showTrades: prefs.showTrades ?? true,
        datasets: Array.isArray(datasets) ? datasets : [],
        optConfig: defaultOptimizeConfig({ ...defaultPrefs.btConfig, ...(prefs.btConfig ?? {}) }),
      });
      void get().loadData();
    },

    setProvider(id) {
      const provider = getProvider(id);
      stopLive();
      set({
        providerId: id,
        symbol: provider.defaultSymbol,
        timeframe: provider.defaultTimeframe,
      });
      persistPrefs();
      void get().loadData();
    },

    setSymbol(symbol, opts) {
      set({ symbol });
      persistPrefs();
      if (opts?.load) void get().loadData();
    },

    setTimeframe(tf, opts) {
      stopLive();
      set({ timeframe: tf });
      persistPrefs();
      if (opts?.load !== false) void get().loadData();
    },

    setBars(bars) {
      set({ bars });
      persistPrefs();
    },

    async loadData() {
      const { providerId, symbol, timeframe, bars } = get();
      const provider = getProvider(providerId);
      const tf = provider.timeframes.includes(timeframe) ? timeframe : provider.defaultTimeframe;
      set({ loadState: 'loading', timeframe: tf });
      try {
        const candles = await provider.fetchHistory({ symbol, timeframe: tf, bars });
        if (candles.length < 2) throw new Error(`Not enough data returned for ${symbol}.`);
        setCandles(candles, `${provider.name} · ${symbol} · ${tf}`, null);
        const s = get();
        if (s.live && provider.supportsLive) s.setLive(true); // reconnect for the new symbol/tf
        else if (s.live) s.setLive(false);
      } catch (err) {
        set({ loadState: 'error' });
        get().pushToast('error', `Could not load data: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    clearData() {
      stopLive();
      set({
        candles: [],
        dataKey: uid('data_'),
        dataLabel: '',
        activeDatasetId: null,
        loadState: 'idle',
        btResult: null,
        btError: null,
        optResult: null,
      });
    },

    addDataset(input) {
      const dataset: Dataset = {
        id: uid('ds_'),
        createdAt: Date.now(),
        ...input,
      };
      const size = JSON.stringify(dataset).length;
      if (size > MAX_PERSISTED_DATASETS_BYTES) {
        get().pushToast('error', 'Dataset too large to persist in the browser (kept for this session only).');
        set({ datasets: [...get().datasets, dataset], activeDatasetId: dataset.id });
        setCandles(dataset.candles, `Local · ${dataset.name}`, dataset.id);
        return dataset.id;
      }
      set({ datasets: [...get().datasets, dataset], activeDatasetId: dataset.id });
      persistDatasets();
      setCandles(dataset.candles, `Local · ${dataset.name}`, dataset.id);
      return dataset.id;
    },

    saveCurrentDataset(name) {
      const { candles, dataLabel, activeDatasetId, providerId } = get();
      if (candles.length === 0) {
        get().pushToast('info', 'Nothing to save — load some data first.');
        return;
      }
      if (activeDatasetId && get().datasets.some((d) => d.id === activeDatasetId)) {
        get().pushToast('info', 'This dataset is already in your library.');
        return;
      }
      get().addDataset({
        name: name ?? `${dataLabel || 'Dataset'} · ${new Date().toLocaleDateString()}`,
        candles,
        source: providerId,
        description: dataLabel,
        barSeconds: 0,
        barLabel: '',
      });
      get().pushToast('success', 'Saved to your local library — available offline.');
    },

    activateDataset(id) {
      const ds = get().datasets.find((d) => d.id === id);
      if (!ds) return;
      stopLive();
      setCandles(ds.candles, `Local · ${ds.name}`, ds.id);
      get().pushToast('info', `Loaded "${ds.name}" (${ds.candles.length} bars) — charting works fully offline.`);
    },

    removeDataset(id) {
      const next = get().datasets.filter((d) => d.id !== id);
      set({ datasets: next, activeDatasetId: get().activeDatasetId === id ? null : get().activeDatasetId });
      persistDatasets();
    },

    addIndicator(kind) {
      const indicators = [...get().indicators, defaultIndicator(kind)];
      set({ indicators });
      persistPrefs();
    },

    removeIndicator(id) {
      set({ indicators: get().indicators.filter((i) => i.id !== id) });
      persistPrefs();
    },

    updateIndicator(id, patch) {
      set({
        indicators: get().indicators.map((i) =>
          i.id === id ? { ...i, ...patch, params: { ...i.params, ...(patch.params ?? {}) } } : i,
        ),
      });
      persistPrefs();
    },

    setShowTrades(v) {
      set({ showTrades: v });
      persistPrefs();
    },

    setBtConfig(patch) {
      const btConfig = { ...get().btConfig, ...patch };
      set({ btConfig });
      persistPrefs();
    },

    async runBacktest() {
      const { candles, btConfig } = get();
      if (candles.length < 3) {
        get().pushToast('error', 'Load some data before running a backtest.');
        return;
      }
      set({ btRunning: true, btProgress: 0, btError: null });
      try {
        const t0 = performance.now();
        const msg = await workerCall({ type: 'run', candles, config: btConfig });
        if (msg.type !== 'result') throw new Error('Unexpected worker reply');
        const ms = Math.round(performance.now() - t0);
        set({ btResult: msg.result, btRunning: false, btProgress: 1 });
        get().pushToast(
          'success',
          `Backtest finished in ${ms} ms — ${msg.result.trades.length} trade(s), ${candles.length} bars.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ btRunning: false, btError: message });
        get().pushToast('error', `Backtest failed: ${message}`);
      }
    },

    clearBacktest() {
      set({ btResult: null, btError: null });
    },

    setOptConfig(patch) {
      set({ optConfig: { ...get().optConfig, ...patch } });
    },

    async runOptimizer() {
      const { candles, btConfig, optConfig } = get();
      if (candles.length < 3) {
        get().pushToast('error', 'Load some data before optimizing.');
        return;
      }
      set({ optRunning: true, optProgress: 0, optResult: null });
      try {
        const msg = await workerCall({ type: 'optimize', candles, config: btConfig, optimize: optConfig }, (pct) => {
          set({ optProgress: pct });
        });
        if (msg.type !== 'optimizeResult') throw new Error('Unexpected worker reply');
        set({
          optResult: { rows: msg.rows, metric: msg.metric, combos: msg.combos, errored: msg.errored },
          optRunning: false,
          optProgress: 1,
        });
        if (msg.errored > 0) {
          get().pushToast('error', `${msg.errored} of ${msg.combos} parameter combinations failed (see custom code).`);
        }
      } catch (err) {
        set({ optRunning: false });
        get().pushToast('error', `Optimizer failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    async applyOptimizeRow(row) {
      get().setBtConfig({ params: { ...get().btConfig.params, ...row.params } });
      await get().runBacktest();
    },

    setLive(v) {
      const { providerId, symbol, timeframe } = get();
      const provider = getProvider(providerId);
      if (!v) {
        stopLive();
        return;
      }
      if (!provider.supportsLive) {
        get().pushToast('info', 'Live streaming is only available for Binance data.');
        return;
      }
      liveHandle?.stop();
      set({ live: true, liveStatus: 'connecting', liveDetail: '' });
      liveHandle = startBinanceLive({
        symbol,
        timeframe,
        onStatus: (status, detail) => set({ liveStatus: status, liveDetail: detail ?? '', live: status !== 'off' }),
        onKline: (candle, closed) => {
          const candles = get().candles;
          if (candles.length === 0) return;
          const last = candles[candles.length - 1];
          if (candle.time === last.time) {
            const next = candles.slice();
            next[next.length - 1] = candle;
            set({ candles: next });
          } else if (candle.time > last.time) {
            set({ candles: [...candles, candle] });
          }
          if (closed && get().showTrades && get().btResult) {
            /* keep backtest results untouched; user re-runs manually */
          }
        },
      });
    },

    async searchSymbols(query) {
      const provider = getProvider(get().providerId);
      set({ symbolQuery: query });
      if (!provider.searchSymbols) {
        set({ symbolSuggestions: provider.popularSymbols });
        return;
      }
      try {
        const suggestions = await provider.searchSymbols(query);
        if (get().symbolQuery === query) set({ symbolSuggestions: suggestions });
      } catch {
        set({ symbolSuggestions: provider.popularSymbols });
      }
    },

    pushToast(kind, text) {
      const id = uid('toast_');
      set({ toasts: [...get().toasts, { id, kind, text }] });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 5000);
    },

    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
  };
});

/** Convenience selector used by several components. */
export function useActiveBarCount(): number {
  return useStore((s) => s.candles.length);
}
