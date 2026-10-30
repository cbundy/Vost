/**
 * The chart store: everything one chart owns (market data, indicators and their Pine runs, replay, backtest,
 * optimizer, live stream, symbol search). `createChartStore` makes an independent store, so a chart can be
 * created more than once and the copies never share candles, runs, streams, tokens or timers. The chart's only
 * link to app state is the `ChartEnv` it is given.
 *
 * Heavy computations run in a dedicated Web Worker (see ./worker).
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { applyKline, mergeCandles } from '../lib/applyKline';
import { MAX_BARS, intervalSeconds } from '../../../shared/market.ts';
import type { Candle, Dataset, Interval } from '../types';
import { uid } from '../types';
import type { BacktestResult, BacktestConfig, BacktestStage } from '../lib/backtest/types';
import { defaultBacktestConfig } from '../lib/backtest/types';
import type { OptimizeConfig, OptimizeRow, MetricKey } from '../lib/backtest/optimizer';
import { defaultOptimizeConfig } from '../lib/backtest/optimizer';
import type { MonteCarloOptions, MonteCarloResult } from '../lib/backtest/monteCarlo';
import { DEFAULT_MONTE_CARLO } from '../lib/backtest/monteCarlo';
import { getStrategy } from '../lib/backtest/strategies';
import type { OptimizeRunContext } from '../lib/backtest/optimizerCsv';
import { spanOf, splitBars, validationProblem, type ValidationOutput } from '../lib/backtest/validation';
import { walkForwardWindows, type WalkForwardOutput } from '../lib/backtest/walkForward';
import { DEFAULT_PINE_CODE } from '../lib/pine/examples';
import type { PineInput } from '../lib/pine/types';
import type { IndicatorKind, IndicatorSpec } from '../lib/indicatorCompute';
import { defaultIndicator } from '../lib/indicatorCompute';
import type { MessageSeverity } from '../lib/messages';
import type { PineError, PineInputValue, PineResult, PineRunOutcome } from '../lib/pine/types';
import { type Source } from '../../../shared/timeframes.ts';
import type { HistoryRequest, LiveHandle, LiveStatus } from '../lib/providers/http';
import { getProvider, type SymbolSuggestion } from '../lib/providers';
import { HISTORY_PAGE_BARS, belowHistoryCap, isHistoryStart, nextPageRequest, type HistoryLoading } from '../lib/historyPaging';
import { ApiHttpError } from '../lib/providers/api';
import { servable } from '../lib/customTimeframes';
import { fmtTime } from '../lib/format';
import { CHART_MIN_BARS, chartRangeErrorText, cropToChartRange, describeTimeRange, sanitizeTimeRange, sliceByTimeRange, timeRangeErrorText, type TimeRange } from '../lib/timeRange';
import {
  REPLAY_MIN_VISIBLE,
  REPLAY_SPEEDS,
  replayAtEnd,
  replayIntervalMs,
  replayStartIndex,
  replayVisible,
  runIsPrefixOf,
  stepReplay as stepPosition,
} from '../lib/replay';
import { nextPineSelection } from '../lib/pineSelection';
import { CancelledError, optimizerCall, workerCall } from './worker';
import type { BroadcastOpt, SyncChange } from '../lib/layoutSync';

/** Latest Pine run of one indicator entry. `result` is kept while a newer run is in flight. */
export interface PineRunState {
  running: boolean;
  result?: PineResult;
  /** The candles `result` was computed on (its values align 1:1 with these). */
  candles?: Candle[];
  error?: PineError;
}

/** What a `loadOlder` call came to: a page merged, the history start reached, nothing asked or a stale reply, or a failure. */
export type OlderResult = 'loaded' | 'start' | 'skipped' | 'error';

export type LoadState = 'idle' | 'loading' | 'error' | 'ready';

export interface ReplayState {
  phase: 'picking' | 'active';
  source: Candle[];
  cursor: number;
  playing: boolean;
  speed: number;
  /** Set only on a picking state entered from an active replay: the cursor Cancel returns to. */
  resumeCursor?: number;
}

/** The full loaded bars: the span behind a chart range, else the bars replay began on, else what the chart shows. */
export function selectDataCandles(s: Pick<ChartState, 'candles' | 'fullCandles' | 'replay'>): Candle[] {
  return s.fullCandles ?? selectBars(s);
}

/** The bars the chart would show without a replay cut: what backtests and optimizer runs use (a chart range still crops). */
export function selectBars(s: Pick<ChartState, 'candles' | 'replay'>): Candle[] {
  return s.replay?.phase === 'active' ? s.replay.source : s.candles;
}

/** What a chart starts from: the part of the saved prefs that belongs to one chart. */
export interface ChartInitial {
  providerId: string;
  symbol: string;
  timeframe: Interval;
  bars: number;
  indicators: IndicatorSpec[];
  btConfig: BacktestConfig;
  showTrades: boolean;
  btRange: TimeRange;
}

export function defaultChartInitial(): ChartInitial {
  return {
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
    btRange: { from: null, to: null },
  };
}

/** A chart's only link to app state; tests can pass a stub. */
export interface ChartEnv {
  pushToast(kind: 'info' | 'success' | 'error', text: string): void;
  pushMessage(source: string, severity: MessageSeverity, text: string): void;
  /** IANA zone every date is shown in. */
  timeZone(): string;
  /** Whether higher timeframes are built from lower ones. */
  buildTimeframes(): boolean;
  /** How history loads: the latest page plus older pages on scroll, or everything at once. */
  historyLoading(): HistoryLoading;
  /** The saved local datasets. */
  datasets(): Dataset[];
  addDataset(dataset: Dataset): void;
  removeDataset(id: string): void;
  /** A persisted per-chart field changed: the app should save the prefs. */
  onPrefsChange(): void;
  /** A committed change on chart `sourceId` that the other charts of the layout may follow (see lib/layoutSync). */
  onSync(sourceId: string, change: SyncChange): void;
}

export interface ChartState {
  id: string;

  /* preferences (persisted) */
  providerId: string;
  symbol: string;
  timeframe: Interval;
  bars: number;
  indicators: IndicatorSpec[];
  showTrades: boolean;
  /** Pine run state by indicator id (not persisted). */
  pineRuns: Record<string, PineRunState>;
  selectedPineId: string | null;

  /* market data */
  candles: Candle[];
  /** Changes whenever the full dataset is replaced (forces a chart rebuild). */
  dataKey: string;
  /** Chart range window (UTC seconds) applied to the loaded bars; null = none (not persisted). */
  chartRange: TimeRange | null;
  /** The full loaded bars while a chart range crops `candles`; null otherwise. */
  fullCandles: Candle[] | null;
  /** True while `fullCandles` is a span fetched from the provider for the chart range. */
  chartRangeFetched: boolean;
  dataLabel: string;
  /** True once the provider has no bars older than the first loaded one, so paging stops (reset by every new series). */
  historyStart: boolean;
  /** True while an older page is being fetched. */
  olderLoading: boolean;
  activeDatasetId: string | null;
  loadState: LoadState;
  /**
   * Bar replay (not persisted). While `active`, `candles` is `source.slice(0, cursor + 1)` and `source` holds the
   * bars shown when replay began, plus any live bars that arrived since. `picking` waits for a start bar.
   */
  replay: ReplayState | null;

  /* live streaming */
  live: boolean;
  liveStatus: LiveStatus;
  liveDetail: string;
  /** the person's live choice, apart from the stream state; never persisted */
  liveWanted: boolean;

  /* backtest */
  btConfig: BacktestConfig;
  /** Time window the backtester and optimizer run on (UTC seconds, null = open end). */
  btRange: TimeRange;
  btRunning: boolean;
  btProgress: number;
  /** Step of the running backtest, null when none runs or before the first report. */
  btStage: BacktestStage | null;
  btResult: BacktestResult | null;
  btError: string | null;
  /** Monte Carlo settings of the Results tab. */
  mcConfig: MonteCarloOptions;
  mcRunning: boolean;
  mcError: string | null;
  /** The last Monte Carlo result and the backtest result it came from; only current while `source === btResult`. */
  mcResult: { source: BacktestResult; result: MonteCarloResult; options: MonteCarloOptions } | null;
  /** Inputs declared by the Pine script in the Backtest panel (not persisted). */
  pineInputs: PineInput[];

  /* optimizer */
  optConfig: OptimizeConfig;
  optRunning: boolean;
  optProgress: number;
  /** The last finished run, with the settings it ran with (kept for the export). */
  optResult: {
    rows: OptimizeRow[];
    keys: string[];
    metric: MetricKey;
    combos: number;
    errored: number;
    validation?: ValidationOutput;
    walkForward?: WalkForwardOutput;
    context: OptimizeRunContext;
  } | null;

  symbolQuery: string;
  symbolSuggestions: SymbolSuggestion[];

  /* actions */
  setProvider(id: string, opts?: BroadcastOpt): void;
  /** Switches to a watchlist item's provider and symbol and loads the chart once. */
  openWatchItem(providerId: string, symbol: string, opts?: BroadcastOpt): void;
  setSymbol(symbol: string, opts?: { load?: boolean } & BroadcastOpt): void;
  setTimeframe(tf: Interval, opts?: { load?: boolean } & BroadcastOpt): void;
  setBars(bars: number): void;
  loadData(): Promise<void>;
  /**
   * Loads the page of bars before the first loaded one and merges it in (same series, same `dataKey`). One page in
   * flight at a time: a call meanwhile returns that page's result. Never pages a dataset, a chart range or a replay.
   */
  loadOlder(): Promise<OlderResult>;
  /** Pages older bars in until the first loaded bar is at or before `time`, or the history start, a failure or the cap stops it. */
  loadHistoryTo(time: number): Promise<void>;
  clearData(): void;
  addDataset(input: { name: string; candles: Candle[]; source: string; description: string; barSeconds: number; barLabel: string }): string;
  saveCurrentDataset(name?: string): void;
  activateDataset(id: string): void;
  removeDataset(id: string): void;
  /** Adds an indicator and returns its id. */
  addIndicator(kind: IndicatorKind): string;
  removeIndicator(id: string): void;
  updateIndicator(id: string, patch: Partial<Pick<IndicatorSpec, 'params' | 'color' | 'visible' | 'source'>> & { inputs?: Record<string, PineInputValue> }): void;
  setShowTrades(v: boolean): void;
  setBtConfig(patch: Partial<BacktestConfig>): void;
  setBtRange(range: TimeRange): void;
  /**
   * Shows a time window of the chart: crops the loaded bars, or fetches the span from the provider
   * when it lies outside them; an open range clears. Resolves true when applied.
   */
  setChartRange(range: TimeRange, opts?: BroadcastOpt): Promise<boolean>;
  clearChartRange(opts?: BroadcastOpt): Promise<void>;
  /** Replay: wait for a start bar, begin at a time, step, play, pause, change speed, leave. */
  startReplayPick(): void;
  cancelReplay(): void;
  /** Replay: from an active replay, go back to choosing a start bar; Cancel there resumes the replay. */
  reselectReplayStart(): void;
  startReplayAt(time: number): boolean;
  stepReplay(delta: number): void;
  playReplay(): void;
  pauseReplay(): void;
  setReplaySpeed(speed: number): void;
  exitReplay(): void;
  runBacktest(): Promise<void>;
  refreshPineInputs(): Promise<void>;
  clearBacktest(): void;
  setMcConfig(patch: Partial<MonteCarloOptions>): void;
  /** Reshuffles or resamples the current backtest's trades; a reply that lands after the backtest was replaced is dropped. */
  runMonteCarlo(): Promise<void>;
  setOptConfig(patch: Partial<OptimizeConfig>): void;
  runOptimizer(): Promise<void>;
  /** Stop a running optimizer sweep and bring back the result shown before it started. */
  cancelOptimizer(): void;
  applyOptimizeRow(row: OptimizeRow): Promise<void>;
  setLive(v: boolean): void;
  searchSymbols(query: string): Promise<void>;
}

export type ChartStore = StoreApi<ChartState>;

export function createChartStore(id: string, initial: ChartInitial, env: ChartEnv): ChartStore {
  return createStore<ChartState>()((set, get) => {
  const id0 = id; // the chart's id, for actions whose own argument is named id
  /* Per-chart singletons: each chart owns its own live stream, replay timer and request tokens. */
  let liveHandle: LiveHandle | null = null;
  /** The running optimizer sweep: its cancel handle and the result shown before it started. */
  let mcToken = 0;
  let optRun: { cancel: () => void; previous: ChartState['optResult'] } | null = null;
  /** The replay play timer; every path that ends replay clears it. */
  let replayTimer: ReturnType<typeof setTimeout> | null = null;
  const clearReplayTimer = () => {
    if (replayTimer != null) clearTimeout(replayTimer);
    replayTimer = null;
  };
  /** Bumped by every data load and chart range fetch; only the newest result may be applied. */
  let requestToken = 0;
  /** Bumped whenever a live stream starts or stops, so a late backfill can tell it is stale. */
  let liveSession = 0;
  /** Bumped whenever the series is replaced or cropped, so an older page in flight can tell it is stale. */
  let olderSeq = 0;
  let olderInflight: Promise<OlderResult> | null = null;

  /** `source: 'built'` when the setting is on and the provider is a remote one (the demo provider ignores it). */
  const sourceOpt = (provider: { offline?: boolean }): { source?: Source } =>
    env.buildTimeframes() && !provider.offline ? { source: 'built' } : {};

  /* ---- Pine runs: one at a time per indicator, results from superseded runs dropped ---- */
  const pineInflight = new Set<string>();
  const pineDirty = new Set<string>();

  const setPineRun = (id: string, patch: PineRunState | null) => {
    const next = { ...get().pineRuns };
    if (patch) next[id] = patch;
    else delete next[id];
    set({ pineRuns: next });
  };

  const sameInputs = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && Object.is(a[k], b[k]));
  };

  const runPineIndicator = async (id: string): Promise<void> => {
    const spec = get().indicators.find((i) => i.id === id);
    if (!spec || spec.kind !== 'pine') return;
    const { candles } = get();
    if (candles.length === 0) return;
    pineInflight.add(id);
    pineDirty.delete(id);
    const { source, inputs } = { source: spec.source ?? '', inputs: spec.inputs ?? {} };
    const prev = get().pineRuns[id];
    setPineRun(id, { ...prev, running: true });
    let outcome: PineRunOutcome;
    try {
      const res = await workerCall({ type: 'pine', source, candles, inputs });
      outcome =
        res.type === 'pineResult' ? res.outcome : { ok: false, error: { message: 'Unexpected worker reply' } };
    } catch (err) {
      outcome = { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
    }
    pineInflight.delete(id);
    if (!get().indicators.some((i) => i.id === id)) {
      setPineRun(id, null);
      return;
    }
    if (pineDirty.has(id)) {
      // Source or inputs changed, or newer bars were requested, while this ran. A result that still holds
      // for the current bars (same source and inputs, bars a prefix of the current ones) is kept so a slow
      // run shows during a replay; the usual draw filter hides anything past the visible bars.
      const now = get().indicators.find((i) => i.id === id);
      if (
        outcome.ok &&
        now &&
        (now.source ?? '') === source &&
        sameInputs(now.inputs ?? {}, inputs) &&
        runIsPrefixOf(candles, get().candles)
      ) {
        setPineRun(id, { running: true, result: outcome, candles });
      }
      void runPineIndicator(id);
      return;
    }
    if (outcome.ok) setPineRun(id, { running: false, result: outcome, candles });
    else setPineRun(id, { running: false, error: outcome.error });
  };

  /** (Re)run one pine indicator, or coalesce into the run already in flight. */
  const schedulePine = (id: string) => {
    const spec = get().indicators.find((i) => i.id === id);
    if (!spec || spec.kind !== 'pine' || !spec.visible) return;
    if (pineInflight.has(id)) pineDirty.add(id);
    else void runPineIndicator(id);
  };

  const schedulePineAll = () => {
    for (const i of get().indicators) if (i.kind === 'pine') schedulePine(i.id);
  };

  const dropReplay = () => clearReplayTimer();

  const setCandles = (candles: Candle[], dataLabel: string, activeDatasetId: string | null) => {
    dropReplay();
    if (activeDatasetId != null && (get().live || liveHandle)) stopLive(); // a local dataset never streams
    set({
      candles,
      chartRange: null,
      fullCandles: null,
      chartRangeFetched: false,
      dataKey: uid('data_'),
      replay: null,
      dataLabel,
      activeDatasetId,
      loadState: 'ready',
      btResult: null,
      btError: null,
      optResult: null,
      historyStart: false,
      olderLoading: false,
    });
    olderSeq++;
    olderInflight = null;
    schedulePineAll();
  };

  const applyRange = (slice: Candle[], full: Candle[], range: TimeRange, fetched: boolean) => {
    dropReplay();
    olderSeq++;
    olderInflight = null;
    set({ olderLoading: false });
    set({
      replay: null,
      candles: slice,
      fullCandles: full,
      chartRange: { from: range.from, to: range.to },
      chartRangeFetched: fetched,
      dataKey: uid('data_'),
      btResult: null,
      btError: null,
      optResult: null,
    });
    schedulePineAll();
  };

  const restoreFull = (fullCandles: Candle[]) => {
    dropReplay();
    set({
      replay: null,
      candles: fullCandles,
      fullCandles: null,
      chartRange: null,
      dataKey: uid('data_'),
      btResult: null,
      btError: null,
      optResult: null,
    });
    schedulePineAll();
  };

  const stopLive = () => {
    liveSession++;
    liveHandle?.stop();
    liveHandle = null;
    set({ live: false, liveStatus: 'off', liveDetail: '' });
  };

  // Opens the live stream for the current symbol and timeframe (a no-op target is the caller's check).
  const startStream = () => {
    const { providerId, symbol, timeframe } = get();
    const provider = getProvider(providerId);
    if (!provider.startLive) return;
    get().exitReplay(); // live bars land at the end of the real chart
    if (get().chartRangeFetched) {
      // a fetched span is not the latest bars: reload them, which reconnects live
      set({ live: true, liveStatus: 'connecting', liveDetail: '' });
      void get().loadData().then(() => {
        if (get().loadState === 'error') stopLive();
      });
      return;
    }
    const { fullCandles } = get();
    if (fullCandles) restoreFull(fullCandles); // live bars land at the end of the full data
    liveSession++;
    const session = liveSession;
    liveHandle?.stop();
    set({ live: true, liveStatus: 'connecting', liveDetail: '' });

    // After an outage (the exchange feed or the connection to the server) the stream
    // resumes at the current bar: fetch what was missed once and merge it by time.
    const liveBars = () => {
      const rp = get().replay;
      return rp?.phase === 'active' ? rp.source : get().candles;
    };
    let backfilling = false;
    const backfill = async (): Promise<void> => {
      const bars = liveBars();
      const last = bars[bars.length - 1];
      if (!last || backfilling) return;
      backfilling = true;
      const dataKey = get().dataKey;
      const elapsed = Math.floor((Date.now() / 1000 - last.time) / intervalSeconds(timeframe));
      const count = Math.min(MAX_BARS, Math.max(2, elapsed + 2));
      try {
        const recent = await provider.fetchHistory({ symbol, timeframe, bars: count, ...sourceOpt(provider) });
        if (session !== liveSession || get().dataKey !== dataKey) return; // stopped or switched meanwhile
        const rp = get().replay;
        if (rp?.phase === 'active') set({ replay: { ...rp, source: mergeCandles(rp.source, recent) } });
        else {
          set({ candles: mergeCandles(get().candles, recent) });
          schedulePineAll();
        }
      } catch (err) {
        if (session !== liveSession) return;
        env.pushMessage(
          'Live',
          'warning',
          `Live data came back for ${symbol} ${timeframe}, but the bars missed meanwhile could not be loaded (${err instanceof Error ? err.message : String(err)}). The chart may have a gap; reload the data to fill it.`,
        );
      } finally {
        backfilling = false;
      }
    };

    // A drop can surface as reconnecting -> connecting -> live (the server relay opens a fresh upstream
    // entry, so its first status is 'connecting'), so remember any disruption, not just the status before live.
    let wasLive = false;
    let disrupted = false;
    liveHandle = provider.startLive({
      symbol,
      timeframe,
      ...sourceOpt(provider),
      onLog: (severity, text) => env.pushMessage('Live', severity, text),
      onStatus: (status, detail) => {
        set({ liveStatus: status, liveDetail: detail ?? '', live: status !== 'off' });
        if (status === 'reconnecting' || status === 'error' || (status === 'connecting' && wasLive)) disrupted = true;
        if (status === 'live') {
          if (disrupted) void backfill();
          disrupted = false;
          wasLive = true;
        }
      },
      onKline: (candle, closed) => {
        const rp = get().replay;
        if (rp?.phase === 'active') {
          // the chart stays where replay is; the live bar waits in the source
          const next = applyKline(rp.source, candle);
          if (next !== rp.source) set({ replay: { ...rp, source: next } });
        } else {
          const prev = get().candles;
          const next = applyKline(prev, candle);
          if (next !== prev) {
            set({ candles: next });
            schedulePineAll();
          }
        }
        if (closed && get().showTrades && get().btResult) {
          /* keep backtest results untouched; user re-runs manually */
        }
      },
    });
  };

  return {
    id,
    ...initial,
    pineRuns: {},
    selectedPineId: null,
    candles: [],
    dataKey: '',
    chartRange: null,
    fullCandles: null,
    chartRangeFetched: false,
    dataLabel: '',
    historyStart: false,
    olderLoading: false,
    activeDatasetId: null,
    loadState: 'idle',
    replay: null,
    live: false,
    liveStatus: 'off',
    liveDetail: '',
    liveWanted: true,
    pineInputs: [],
    btRunning: false,
    btProgress: 0,
    btStage: null,
    btResult: null,
    btError: null,
    mcConfig: { ...DEFAULT_MONTE_CARLO },
    mcRunning: false,
    mcError: null,
    mcResult: null,
    optConfig: defaultOptimizeConfig(initial.btConfig),
    optRunning: false,
    optProgress: 0,
    optResult: null,
    symbolQuery: '',
    symbolSuggestions: [],

    setProvider(id, opts) {
      const provider = getProvider(id);
      stopLive();
      set({
        providerId: id,
        symbol: provider.defaultSymbol,
        timeframe: provider.defaultTimeframe,
      });
      env.onPrefsChange();
      void get().loadData();
      if (opts?.broadcast !== false) env.onSync(id0, { kind: 'symbol', providerId: id, symbol: provider.defaultSymbol });
    },

    openWatchItem(providerId, symbol, opts) {
      stopLive();
      set({ providerId, symbol });
      env.onPrefsChange();
      void get().loadData();
      if (opts?.broadcast !== false) env.onSync(id0, { kind: 'symbol', providerId, symbol });
    },

    setSymbol(symbol, opts) {
      set({ symbol });
      env.onPrefsChange();
      if (opts?.load) {
        void get().loadData();
        if (opts.broadcast !== false) env.onSync(id0, { kind: 'symbol', providerId: get().providerId, symbol });
      }
    },

    setTimeframe(tf, opts) {
      stopLive();
      set({ timeframe: tf });
      env.onPrefsChange();
      if (opts?.load !== false) {
        void get().loadData();
        if (opts?.broadcast !== false) env.onSync(id0, { kind: 'interval', timeframe: tf });
      }
    },
    setBars(bars) {
      set({ bars });
      env.onPrefsChange();
    },

    async loadData() {
      const { providerId, symbol, timeframe, bars: savedBars } = get();
      const bars = env.historyLoading() === 'scroll' ? HISTORY_PAGE_BARS : savedBars;
      const provider = getProvider(providerId);
      const tf = servable(provider, timeframe) ? timeframe : provider.defaultTimeframe;
      const token = ++requestToken;
      get().exitReplay();
      set({ loadState: 'loading', timeframe: tf });
      try {
        const candles = await provider.fetchHistory({ symbol, timeframe: tf, bars, ...sourceOpt(provider) });
        if (token !== requestToken) return; // a newer load or range fetch owns the data now
        if (candles.length < 2) throw new Error(`Not enough data returned for ${symbol}.`);
        setCandles(candles, `${provider.name} · ${symbol} · ${tf}`, null);
        const s = get();
        if (s.liveWanted && provider.startLive) startStream(); // (re)connect for the new symbol/tf
        else if (s.live || liveHandle) stopLive();
      } catch (err) {
        if (token !== requestToken) return;
        set({ loadState: 'error' });
        env.pushToast('error', `Could not load data: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    loadOlder() {
      if (olderInflight) return olderInflight;
      const s = get();
      if (
        env.historyLoading() !== 'scroll' ||
        s.historyStart ||
        s.activeDatasetId != null ||
        s.chartRange != null ||
        s.replay != null ||
        s.candles.length === 0 ||
        !belowHistoryCap(s.candles.length)
      ) {
        return Promise.resolve('skipped');
      }
      const { providerId, symbol, timeframe, dataKey } = s;
      const provider = getProvider(providerId);
      const token = requestToken;
      const seq = ++olderSeq;
      const stale = () => {
        const now = get();
        return (
          seq !== olderSeq ||
          token !== requestToken ||
          now.dataKey !== dataKey ||
          now.providerId !== providerId ||
          now.symbol !== symbol ||
          now.timeframe !== timeframe ||
          now.activeDatasetId != null ||
          now.chartRange != null ||
          now.replay != null
        );
      };
      set({ olderLoading: true });
      const run = async (): Promise<OlderResult> => {
        try {
          const older = await provider.fetchHistory({ symbol, timeframe, ...nextPageRequest(s.candles[0].time), ...sourceOpt(provider) });
          if (stale()) return 'skipped';
          const current = get().candles;
          if (isHistoryStart(older, current[0].time)) {
            set({ historyStart: true });
            return 'start';
          }
          set({ candles: mergeCandles(current, older) }); // merged at reply time: live ticks and backfill kept
          schedulePineAll();
          return 'loaded';
        } catch (err) {
          if (stale()) return 'skipped';
          if (err instanceof ApiHttpError && err.status === 404) {
            set({ historyStart: true });
            return 'start';
          }
          env.pushMessage(
            provider.name,
            'warning',
            `Older bars for ${symbol} ${timeframe} could not be loaded (${err instanceof Error ? err.message : String(err)}). Scroll back again to retry.`,
          );
          return 'error';
        } finally {
          if (seq === olderSeq) {
            olderInflight = null;
            set({ olderLoading: false });
          }
        }
      };
      olderInflight = run();
      return olderInflight;
    },

    async loadHistoryTo(time) {
      for (;;) {
        const { candles } = get();
        if (candles.length === 0 || candles[0].time <= time) return;
        if ((await get().loadOlder()) !== 'loaded') return;
      }
    },

    clearData() {
      stopLive();
      dropReplay();
      set({
        replay: null,
        candles: [],
        chartRange: null,
        fullCandles: null,
        chartRangeFetched: false,
        dataKey: uid('data_'),
        dataLabel: '',
        historyStart: false,
        olderLoading: false,
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
      env.addDataset(dataset);
      set({ activeDatasetId: dataset.id });
      setCandles(dataset.candles, `Local · ${dataset.name}`, dataset.id);
      return dataset.id;
    },

    saveCurrentDataset(name) {
      const { dataLabel, activeDatasetId, providerId } = get();
      const candles = selectDataCandles(get());
      if (candles.length === 0) {
        env.pushToast('info', 'Nothing to save — load some data first.');
        return;
      }
      if (activeDatasetId && env.datasets().some((d) => d.id === activeDatasetId)) {
        env.pushToast('info', 'This dataset is already in your library.');
        return;
      }
      get().addDataset({
        name: name ?? `${dataLabel || 'Dataset'} · ${fmtTime(Date.now() / 1000, { dateOnly: true, timeZone: env.timeZone() })}`,
        candles,
        source: providerId,
        description: dataLabel,
        barSeconds: 0,
        barLabel: '',
      });
      env.pushToast('success', 'Saved to your local library — available offline.');
    },

    activateDataset(id) {
      const ds = env.datasets().find((d) => d.id === id);
      if (!ds) return;
      stopLive();
      setCandles(ds.candles, `Local · ${ds.name}`, ds.id);
      env.pushToast('info', `Loaded "${ds.name}" (${ds.candles.length} bars) — charting works fully offline.`);
    },

    removeDataset(id) {
      env.removeDataset(id);
      if (get().activeDatasetId === id) set({ activeDatasetId: null });
    },

    addIndicator(kind) {
      const indicators = [...get().indicators, defaultIndicator(kind)];
      set({ indicators });
      env.onPrefsChange();
      const id = indicators[indicators.length - 1].id;
      if (kind === 'pine') schedulePine(id);
      return id;
    },

    removeIndicator(id) {
      const before = get().indicators;
      set({
        indicators: before.filter((i) => i.id !== id),
        selectedPineId: nextPineSelection(before, get().selectedPineId, id),
      });
      setPineRun(id, null);
      env.onPrefsChange();
    },

    updateIndicator(id, patch) {
      set({
        indicators: get().indicators.map((i) =>
          i.id === id
            ? {
                ...i,
                ...patch,
                params: { ...i.params, ...(patch.params ?? {}) },
                ...(i.kind === 'pine' && { inputs: { ...(i.inputs ?? {}), ...(patch.inputs ?? {}) } }),
              }
            : i,
        ),
      });
      env.onPrefsChange();
      if (patch.source !== undefined || patch.inputs !== undefined || patch.visible === true) schedulePine(id);
    },

    setShowTrades(v) {
      set({ showTrades: v });
      env.onPrefsChange();
    },

    setBtConfig(patch) {
      const btConfig = { ...get().btConfig, ...patch };
      set({ btConfig });
      env.onPrefsChange();
    },

    setBtRange(range) {
      set({ btRange: sanitizeTimeRange(range) });
      env.onPrefsChange();
    },

    async setChartRange(range, opts) {
      const state = get();
      const full = selectDataCandles(state);
      const open = range.from == null && range.to == null;
      const announce = (change: SyncChange) => {
        if (opts?.broadcast !== false) env.onSync(id0, change);
      };
      if (open) {
        await get().clearChartRange({ broadcast: false });
        announce({ kind: 'range', range: null });
        return true;
      }
      // The toast comes after the announce: layout sync dedupes it against the receivers' identical text.
      let paused = false;
      const pauseLive = () => {
        if (!get().live) return;
        stopLive();
        paused = true;
      };
      const pausedToast = () => {
        if (paused) env.pushToast('info', 'Live is paused while the chart is cropped. Clear the range to go live again.');
      };
      const crop = cropToChartRange(full, range);
      if (crop.ok) {
        pauseLive();
        applyRange(crop.slice, full, range, state.chartRangeFetched);
        announce({ kind: 'range', range });
        pausedToast();
        return true;
      }
      if (crop.error !== 'outside' || state.activeDatasetId != null) {
        env.pushToast('error', chartRangeErrorText(crop.error));
        return false;
      }

      // outside the provider's loaded bars: fetch that span
      const { providerId, symbol, timeframe } = state;
      const bars = env.historyLoading() === 'scroll' ? MAX_BARS : state.bars;
      const provider = getProvider(providerId);
      const token = ++requestToken;
      const req: HistoryRequest = { symbol, timeframe, bars, ...sourceOpt(provider) };
      if (range.from != null) req.from = range.from;
      if (range.to != null) req.to = range.to;
      set({ loadState: 'loading' });
      try {
        const fetched = await provider.fetchHistory(req);
        const now = get();
        if (token !== requestToken || now.providerId !== providerId || now.symbol !== symbol || now.activeDatasetId != null || now.timeframe !== timeframe) {
          return false; // stale: the user moved on, a newer request owns the state
        }
        const slice = sliceByTimeRange(fetched, range);
        if (slice.length < CHART_MIN_BARS) {
          set({ loadState: 'ready' });
          env.pushToast('error', chartRangeErrorText('too-few-bars'));
          return false;
        }
        pauseLive();
        applyRange(slice, fetched, range, true);
        set({ loadState: 'ready' });
        if (range.from != null && slice[0].time - range.from > intervalSeconds(timeframe)) {
          const date = fmtTime(slice[0].time, { timeZone: env.timeZone() });
          const text = `${provider.name} has data for this range only from ${date}`;
          env.pushMessage(provider.name, 'warning', text);
          env.pushToast('info', text);
        }
        announce({ kind: 'range', range });
        pausedToast();
        return true;
      } catch (err) {
        if (token !== requestToken) return false;
        set({ loadState: 'ready' });
        env.pushToast('error', `Could not load range: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },

    async clearChartRange(opts) {
      const { fullCandles, chartRangeFetched } = get();
      if (opts?.broadcast !== false) env.onSync(id0, { kind: 'range', range: null });
      if (!fullCandles) return;
      if (chartRangeFetched || (get().liveWanted && getProvider(get().providerId).startLive)) {
        await get().loadData(); // back to the latest bars (and live); setCandles resets the range state
        return;
      }
      restoreFull(fullCandles);
    },

    startReplayPick() {
      if (get().candles.length < REPLAY_MIN_VISIBLE + 1) {
        env.pushToast('error', 'Load some data before starting a replay.');
        return;
      }
      if (get().replay) return;
      set({ replay: { phase: 'picking', source: [], cursor: 0, playing: false, speed: REPLAY_SPEEDS[0] } });
    },

    cancelReplay() {
      const rp = get().replay;
      if (rp?.phase !== 'picking') return;
      if (rp.resumeCursor == null) {
        set({ replay: null });
        return;
      }
      const source = get().candles;
      const cursor = stepPosition({ source, cursor: rp.resumeCursor }, 0);
      set({ replay: { phase: 'active', source, cursor, playing: false, speed: rp.speed }, candles: replayVisible(source, cursor) });
      schedulePineAll();
    },

    reselectReplayStart() {
      const rp = get().replay;
      if (rp?.phase !== 'active') return;
      clearReplayTimer();
      set({
        replay: { phase: 'picking', source: [], cursor: 0, playing: false, speed: rp.speed, resumeCursor: rp.cursor },
        candles: rp.source,
      });
      schedulePineAll();
    },

    startReplayAt(time) {
      const rp = get().replay;
      if (rp?.phase !== 'picking') return false;
      const source = get().candles;
      const cursor = replayStartIndex(source, time);
      if (cursor == null) {
        env.pushToast('error', 'That time is outside the loaded bars, or too close to the end to replay.');
        return false;
      }
      set({ replay: { phase: 'active', source, cursor, playing: false, speed: rp.speed }, candles: replayVisible(source, cursor) });
      schedulePineAll();
      return true;
    },

    stepReplay(delta) {
      const rp = get().replay;
      if (rp?.phase !== 'active') return;
      get().pauseReplay();
      const cursor = stepPosition(rp, delta);
      if (cursor === rp.cursor) return;
      set({ replay: { ...get().replay!, cursor }, candles: replayVisible(rp.source, cursor) });
      schedulePineAll();
    },

    playReplay() {
      const rp = get().replay;
      if (rp?.phase !== 'active' || rp.playing || replayAtEnd(rp)) return;
      clearReplayTimer();
      set({ replay: { ...rp, playing: true } });
      const tick = () => {
        replayTimer = null;
        const cur = get().replay;
        if (cur?.phase !== 'active' || !cur.playing) return;
        const cursor = stepPosition(cur, 1);
        const next = { ...cur, cursor, playing: !replayAtEnd({ source: cur.source, cursor }) };
        set({ replay: next, candles: replayVisible(cur.source, cursor) });
        schedulePineAll();
        if (next.playing) replayTimer = setTimeout(tick, replayIntervalMs(get().replay!.speed));
      };
      replayTimer = setTimeout(tick, replayIntervalMs(rp.speed));
    },

    pauseReplay() {
      clearReplayTimer();
      const rp = get().replay;
      if (rp?.playing) set({ replay: { ...rp, playing: false } });
    },

    setReplaySpeed(speed) {
      const rp = get().replay;
      if (!rp || !(REPLAY_SPEEDS as readonly number[]).includes(speed)) return;
      set({ replay: { ...rp, speed } });
    },

    exitReplay() {
      const rp = get().replay;
      clearReplayTimer();
      if (!rp) return;
      if (rp.phase === 'picking') {
        set({ replay: null });
        return;
      }
      set({ replay: null, candles: rp.source });
      schedulePineAll();
    },

    async runBacktest() {
      const { btConfig, btRange } = get();
      const all = selectBars(get());
      if (all.length < 3) {
        env.pushToast('error', 'Load some data before running a backtest.');
        return;
      }
      const { slice: candles, error } = describeTimeRange(all, btRange);
      if (error) {
        env.pushToast('error', timeRangeErrorText(error));
        return;
      }
      set({ btRunning: true, btProgress: 0, btStage: null, btError: null });
      try {
        const t0 = performance.now();
        const msg = await workerCall({ type: 'run', candles, config: btConfig }, (pct, stage) =>
          set({ btProgress: pct, btStage: stage ?? null }),
        );
        if (msg.type !== 'result') throw new Error('Unexpected worker reply');
        const ms = Math.round(performance.now() - t0);
        set({ btResult: msg.result, btRunning: false, btProgress: 0, btStage: null });
        env.pushToast(
          'success',
          `Backtest finished in ${ms} ms — ${msg.result.trades.length} trade(s), ${candles.length} bars.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ btRunning: false, btProgress: 0, btStage: null, btError: message });
        env.pushToast('error', `Backtest failed: ${message}`);
      }
    },

    async refreshPineInputs() {
      const { btConfig } = get();
      const candles = selectBars(get());
      if (btConfig.strategyId !== 'pine' || candles.length === 0) {
        if (get().pineInputs.length > 0) set({ pineInputs: [] });
        return;
      }
      try {
        // Input declarations do not depend on the data; a short slice keeps this cheap.
        const msg = await workerCall({
          type: 'pine',
          source: btConfig.pineCode ?? DEFAULT_PINE_CODE,
          candles: candles.slice(0, 60),
        });
        if (msg.type !== 'pineResult') throw new Error('Unexpected worker reply');
        set({ pineInputs: msg.outcome.ok ? msg.outcome.inputs : [] });
      } catch {
        set({ pineInputs: [] });
      }
    },

    clearBacktest() {
      set({ btResult: null, btError: null });
    },

    setMcConfig(patch) {
      set({ mcConfig: { ...get().mcConfig, ...patch } });
    },

    async runMonteCarlo() {
      const source = get().btResult;
      if (!source) return;
      const options = { ...get().mcConfig };
      const token = ++mcToken;
      set({ mcRunning: true, mcError: null });
      try {
        const msg = await workerCall({
          type: 'montecarlo',
          trades: source.trades,
          initialCapital: source.metrics.initialCapital,
          options,
        });
        if (msg.type !== 'monteCarloResult') throw new Error('Unexpected worker reply');
        if (token !== mcToken) return;
        // The backtest was replaced while this ran: the result belongs to a run that is gone.
        if (get().btResult !== source) {
          set({ mcRunning: false });
          return;
        }
        set({ mcResult: { source, result: msg.result, options }, mcRunning: false });
      } catch (err) {
        if (token !== mcToken) return;
        set({ mcRunning: false, mcError: err instanceof Error ? err.message : String(err) });
      }
    },

    setOptConfig(patch) {
      set({ optConfig: { ...get().optConfig, ...patch } });
    },

    async runOptimizer() {
      const { btConfig, optConfig, btRange } = get();
      const all = selectBars(get());
      if (all.length < 3) {
        env.pushToast('error', 'Load some data before optimizing.');
        return;
      }
      const { slice: candles, error } = describeTimeRange(all, btRange);
      if (error) {
        env.pushToast('error', timeRangeErrorText(error));
        return;
      }
      const problem = validationProblem(optConfig.validation, candles.length);
      if (problem) {
        env.pushToast('error', problem);
        return;
      }
      const previous = optRun ? optRun.previous : get().optResult;
      const swept = new Set(optConfig.sweeps.map((sw) => sw.key));
      const context: OptimizeRunContext = {
        strategyId: btConfig.strategyId,
        strategyName: getStrategy(btConfig.strategyId).name,
        params: Object.fromEntries(Object.entries(btConfig.params).filter(([k]) => !swept.has(k) && !k.startsWith('__'))),
        symbol: get().symbol,
        timeframe: get().timeframe,
        dataLabel: get().dataLabel,
        rangeFrom: candles[0]?.time ?? null,
        rangeTo: candles[candles.length - 1]?.time ?? null,
        bars: candles.length,
        initialCapital: btConfig.initialCapital,
        positionSizePct: btConfig.positionSizePct,
        feeBps: btConfig.feeBps,
        slippageBps: btConfig.slippageBps,
        stopLossPct: btConfig.stopLossPct,
        takeProfitPct: btConfig.takeProfitPct,
        allowShort: btConfig.allowShort,
        sweeps: optConfig.sweeps.map((sw) => ({ ...sw })),
      };
      const v = optConfig.validation;
      if (v && v.method === 'robustness') {
        context.validation = { method: 'robustness', radius: v.radius, rankByScore: v.rankByScore };
      } else if (v && v.method === 'split') {
        const parts = splitBars(candles, v.inSamplePct);
        context.validation = { method: 'split', inSamplePct: v.inSamplePct, topN: v.topN, inSample: spanOf(parts.inSample), heldOut: spanOf(parts.heldOut) };
      }
      if (v && v.method === 'monte-carlo') {
        context.validation = { method: 'monte-carlo', topN: v.topN, iterations: v.iterations, mcMethod: v.mcMethod, seed: v.seed };
      }
      if (v && v.method === 'walk-forward') {
        const spans = walkForwardWindows(candles.length, v).map((w) => ({
          inSample: spanOf(candles.slice(w.inSample.from, w.inSample.to)),
          heldOut: spanOf(candles.slice(w.heldOut.from, w.heldOut.to)),
        }));
        context.walkForward = { method: 'walk-forward', windows: v.windows, inSamplePct: v.inSamplePct, anchored: v.anchored, spans };
      }
      optRun?.cancel();
      set({ optRunning: true, optProgress: 0, optResult: null });
      const call = optimizerCall({ type: 'optimize', candles, config: btConfig, optimize: optConfig }, (pct) => {
        if (optRun === run) set({ optProgress: pct });
      });
      const run = { cancel: call.cancel, previous };
      optRun = run;
      try {
        const msg = await call.promise;
        if (optRun !== run) return;
        optRun = null;
        if (msg.type !== 'optimizeResult') throw new Error('Unexpected worker reply');
        set({
          optResult: { rows: msg.rows, keys: msg.keys, metric: msg.metric, combos: msg.combos, errored: msg.errored, validation: msg.validation, walkForward: msg.walkForward, context },
          optRunning: false,
          optProgress: 1,
        });
        if (msg.errored > 0) {
          env.pushToast('error', `${msg.errored} of ${msg.combos} parameter combinations failed (see custom code).`);
        }
      } catch (err) {
        if (optRun !== run || err instanceof CancelledError) return;
        optRun = null;
        set({ optRunning: false, optResult: previous });
        env.pushToast('error', `Optimizer failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    cancelOptimizer() {
      const run = optRun;
      if (!run) return;
      optRun = null;
      run.cancel();
      set({ optRunning: false, optProgress: 0, optResult: run.previous });
      env.pushToast('info', 'Optimizer cancelled');
    },

    async applyOptimizeRow(row) {
      get().setBtConfig({ params: { ...get().btConfig.params, ...row.params } });
      await get().runBacktest();
    },

    setLive(v) {
      const provider = getProvider(get().providerId);
      set({ liveWanted: v });
      if (!v) {
        stopLive();
        return;
      }
      if (!provider.startLive) {
        env.pushToast('info', `Live streaming is not available for ${provider.name} data.`);
        return;
      }
      startStream();
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
  };
  });
}

/** Whether older pages may still come for this chart: scroll mode, a live series (no dataset, chart range or replay) and no history start yet. */
export function canPageOlder(s: ChartState, mode: HistoryLoading): boolean {
  return mode === 'scroll' && !s.historyStart && s.activeDatasetId == null && s.chartRange == null && s.replay == null && s.candles.length > 0;
}
