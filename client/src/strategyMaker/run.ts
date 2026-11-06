/** The find pipeline: load candles, train the model, search, validate. Pure: no DOM, no React. */
import { runParts } from './engine/backtest';
import {
  MIN_TRADES,
  searchStrategies,
  trainModel,
  type SearchDirection,
  type SearchResult,
  type SeriesInput,
  type Targets,
  type TrainResult,
  type RiskInput,
  classifyTrades,
  buildStyleReport,
  type StyleReport,
} from './engine';
import { defaultBacktestConfig, type BacktestConfig } from '../lib/backtest/types';
import type { Candle } from '../../../shared/market.ts';
import type { Loaded } from './data';
import type { HighlightSet, SetSource } from './store';

/** What the engine needs to know, after the form has been read. */
export interface FindInputs {
  direction: SearchDirection;
  families: string[];
  risk: Required<Pick<RiskInput, 'feeBps' | 'slippageBps'>> & { stopLossPct: number | null; takeProfitPct: number | null; riskPct?: number } & Pick<
    RiskInput,
    'stopMode' | 'stopAtrMult' | 'takeProfitMode' | 'takeProfitAtrMult' | 'takeProfitR' | 'trailMode' | 'trailPct' | 'trailAtrMult' | 'atrLength' | 'atrTimeframe'
  >;
  targets: Targets;
  /** Search only the families of the leading style of the marked trades. Absent means off. */
  useStyle?: boolean;
}

export type FindStage = 'Loading data' | 'Training' | 'Searching' | 'Validating';

/** The part of a run that happens in the worker. */
export type EngineOutcome =
  | { kind: 'ok'; model: TrainResult; search: SearchResult; style?: StyleReport }
  | { kind: 'too-few'; have: number; need: number }
  | { kind: 'refused'; reason: string };

/** What training alone gives (Retrain). */
export type TrainedOutcome =
  | { kind: 'trained'; model: TrainResult }
  | { kind: 'too-few'; have: number; need: number }
  | { kind: 'refused'; reason: string };

export interface FoundTrade {
  side: 'long' | 'short';
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
}

export interface SkippedSet {
  label: string;
  reason: string;
}

/** A whole run, as the page shows it. */
export interface FindResult {
  outcome: EngineOutcome;
  inputs: FindInputs;
  /** The label of each series that was loaded, in the order of the engine's skipped-trade indexes. */
  seriesLabels: string[];
  skippedSets: SkippedSet[];
  /** The sets whose candles loaded, in the order of `seriesLabels` (what the model was trained on, or reused for). */
  usedSets: HighlightSet[];
  /** True when the run used the model it was given instead of training. */
  reused: boolean;
}

export type Progress = (pct: number, stage: FindStage) => void;

export interface Loaders {
  /** Fetches the candles of a provider set again. */
  provider(source: Extract<SetSource, { kind: 'provider' }>, signal?: AbortSignal): Promise<Loaded>;
  /** Reads the candles of a saved dataset of the main app. */
  library(datasetId: string): Loaded;
}

const abortError = (): Error => new DOMException('The run was cancelled', 'AbortError');

export const moreNeeded = (have: number, need = MIN_TRADES): string => `${need - have} more trade${need - have === 1 ? '' : 's'} needed`;

export function tooFewMessage(have: number, need: number): string {
  return `Only ${have} of the ${need} trades needed could be used - ${moreNeeded(have, need)}. Mark more trades and try again.`;
}

export function sourceLabel(s: SetSource, datasetName?: (id: string) => string | undefined): string {
  if (s.kind === 'provider') return `${s.provider} - ${s.symbol} - ${s.timeframe}`;
  if (s.kind === 'library') return datasetName?.(s.datasetId) ?? `Saved dataset ${s.datasetId}`;
  return s.name;
}

/** The candles of each chosen set. A set that cannot load is listed with its reason and skipped. */
export async function loadSeries(
  sets: HighlightSet[],
  loaders: Loaders,
  opts: { signal?: AbortSignal; label?: (s: SetSource) => string; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ series: SeriesInput[]; labels: string[]; skipped: SkippedSet[]; used: HighlightSet[] }> {
  const series: SeriesInput[] = [];
  const used: HighlightSet[] = [];
  const labels: string[] = [];
  const skipped: SkippedSet[] = [];
  for (let i = 0; i < sets.length; i++) {
    if (opts.signal?.aborted) throw abortError();
    const set = sets[i];
    const label = (opts.label ?? sourceLabel)(set.source);
    let loaded: Loaded;
    try {
      if (set.source.kind === 'provider') loaded = await loaders.provider(set.source, opts.signal);
      else if (set.source.kind === 'library') loaded = loaders.library(set.source.datasetId);
      else if (set.candles?.length) loaded = { ok: true, candles: set.candles, label };
      else loaded = { ok: false, error: 'The candles of this file were not kept.' };
    } catch (e) {
      loaded = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (opts.signal?.aborted) throw abortError();
    if (loaded.ok) {
      series.push({ candles: loaded.candles, trades: set.trades });
      labels.push(label);
      used.push(set);
    } else {
      skipped.push({ label, reason: loaded.error });
    }
    opts.onProgress?.(i + 1, sets.length);
  }
  return { series, labels, skipped, used };
}

/** Training alone, for Retrain. Rejects with an AbortError on abort. */
export async function runTrain(series: SeriesInput[], signal?: AbortSignal, onProgress?: Progress): Promise<TrainedOutcome> {
  if (signal?.aborted) throw abortError();
  const model = await trainModel({ series, signal, onProgress: (p) => onProgress?.(Math.min(1, p), 'Training') });
  if (model.kind === 'ok') return { kind: 'trained', model };
  if (model.kind === 'too-few') return { kind: 'too-few', have: model.have, need: model.need };
  return { kind: 'refused', reason: model.reason };
}

/**
 * Training, then the search narrowed by the model, then the search's validation. Rejects with an AbortError on abort.
 * With `trained` (a model that is up to date for these series, in the order it was trained on) training is skipped.
 */
export async function runEngine(
  series: SeriesInput[],
  inputs: FindInputs,
  signal?: AbortSignal,
  onProgress?: Progress,
  trained?: TrainResult,
): Promise<EngineOutcome> {
  if (signal?.aborted) throw abortError();
  let last = 0;
  const report = (pct: number, stage: FindStage): void => {
    last = Math.max(last, Math.min(1, pct));
    onProgress?.(last, stage);
  };
  const model = trained ?? (await trainModel({ series, signal, onProgress: (p) => report(0.35 * p, 'Training') }));
  if (model.kind === 'too-few') return { kind: 'too-few', have: model.have, need: model.need };
  if (model.kind === 'refused') return { kind: 'refused', reason: model.reason };

  const style = buildStyleReport(classifyTrades(series, inputs.direction), inputs.families, inputs.useStyle === true);
  const allowed = style.families;
  const chosen = model.families.filter((f) => allowed.includes(f));
  const families = chosen.length ? chosen : [...allowed];
  const space = Object.fromEntries(Object.entries(model.space).filter(([f]) => families.includes(f)));
  const search = await searchStrategies({
    series,
    targets: inputs.targets,
    direction: inputs.direction,
    families,
    space,
    risk: inputs.risk,
    signal,
    onProgress: (p, stage) => {
      if (stage === 'validating') report(0.85, 'Validating');
      else if (stage === 'done') report(1, 'Validating');
      else report(0.35 + 0.5 * Math.min(1, p / 0.95), 'Searching');
    },
  });
  if (search.kind === 'too-few') return { kind: 'too-few', have: search.have, need: search.need };
  if (search.kind === 'refused') return { kind: 'refused', reason: search.reason };
  return { kind: 'ok', model, search, style };
}

export type EngineRunner = (
  series: SeriesInput[],
  inputs: FindInputs,
  signal?: AbortSignal,
  onProgress?: Progress,
  trained?: TrainResult,
) => Promise<EngineOutcome>;
export type TrainRunner = (series: SeriesInput[], signal?: AbortSignal, onProgress?: Progress) => Promise<TrainedOutcome>;

const LOAD_SHARE = 0.05;

/** The whole run. `engine` is the worker's `find` on the page and `runEngine` in tests. */
export async function runFind(args: {
  sets: HighlightSet[];
  inputs: FindInputs;
  loaders: Loaders;
  engine?: EngineRunner;
  /** A model that is up to date for `sets` (in its training order): the run then starts at the search. */
  model?: TrainResult;
  label?: (s: SetSource) => string;
  signal?: AbortSignal;
  onProgress?: Progress;
}): Promise<FindResult> {
  const { sets, inputs, loaders, signal, onProgress } = args;
  const engine = args.engine ?? runEngine;
  let last = 0;
  const report = (pct: number, stage: FindStage): void => {
    last = Math.max(last, pct);
    onProgress?.(last, stage);
  };
  report(0, 'Loading data');
  const loaded = await loadSeries(sets, loaders, {
    signal,
    label: args.label,
    onProgress: (done, total) => report(LOAD_SHARE * (done / total), 'Loading data'),
  });
  // A set that would not load changes the series the model was trained on, so the model is then not reused.
  const reuse = args.model && loaded.skipped.length === 0 ? args.model : undefined;
  const base = { inputs, seriesLabels: loaded.labels, skippedSets: loaded.skipped, usedSets: loaded.used, reused: !!reuse };
  if (loaded.series.length === 0) {
    return { ...base, outcome: { kind: 'refused', reason: 'None of the chosen sets could be loaded, so there is nothing to learn from.' } };
  }
  const outcome = await engine(loaded.series, inputs, signal, (pct, stage) => report(LOAD_SHARE + (1 - LOAD_SHARE) * pct, stage), reuse);
  return { ...base, outcome };
}

/** Loads the chosen sets and trains on them, without a search. `trainer` is the worker's `train` on the page. */
export async function runRetrain(args: {
  sets: HighlightSet[];
  loaders: Loaders;
  trainer?: TrainRunner;
  label?: (s: SetSource) => string;
  signal?: AbortSignal;
  onProgress?: Progress;
}): Promise<{ outcome: TrainedOutcome; usedSets: HighlightSet[]; skippedSets: SkippedSet[] }> {
  const { sets, loaders, signal, onProgress } = args;
  const trainer = args.trainer ?? runTrain;
  let last = 0;
  const report = (pct: number, stage: FindStage): void => {
    last = Math.max(last, pct);
    onProgress?.(last, stage);
  };
  report(0, 'Loading data');
  const loaded = await loadSeries(sets, loaders, {
    signal,
    label: args.label,
    onProgress: (done, total) => report(LOAD_SHARE * (done / total), 'Loading data'),
  });
  const base = { usedSets: loaded.used, skippedSets: loaded.skipped };
  if (loaded.series.length === 0) {
    return { ...base, outcome: { kind: 'refused', reason: 'None of the chosen sets could be loaded, so there is nothing to learn from.' } };
  }
  const outcome = await trainer(loaded.series, signal, (pct, stage) => report(LOAD_SHARE + (1 - LOAD_SHARE) * pct, stage));
  return { ...base, outcome };
}

/** The backtest config a candidate is run with on the page's chart. */
export function configFor(inputs: Pick<FindInputs, 'direction' | 'risk'>): BacktestConfig {
  return { ...defaultBacktestConfig(), ...inputs.risk, allowShort: inputs.direction !== 'long' };
}

/** The trades a candidate takes on the given candles, for drawing on the chart. */
export function tradesOf(candles: Candle[], strategyId: string, params: Record<string, number>, inputs: Pick<FindInputs, 'direction' | 'risk'>): FoundTrade[] {
  const run = runParts([candles], configFor(inputs), strategyId, params);
  return run.trades.map((t) => ({ side: t.side, entryTime: t.entryTime, exitTime: t.exitTime, entryPrice: t.entryPrice, exitPrice: t.exitPrice }));
}
