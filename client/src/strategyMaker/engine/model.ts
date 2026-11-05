/**
 * The strategy maker's learning model: a small decision tree that learns from the highlighted trades which
 * indicator readings mean "in a trade", says so as readable rules, and narrows the search to the settings those
 * rules point to. Pure: no DOM, no React; runs in a worker and in Vitest.
 */
import type { SweepParam } from '../../lib/backtest/optimizer';
import { getStrategy } from '../../lib/backtest/strategies';
import { splitBars } from '../../lib/backtest/validation';
import type { Candle } from '../../types';
import { FEATURES, featureColumn, formatValue, isKnownFeature, type Feature } from './features';
import { marksOf, scoreOf, tally, usedTrades, type Marks, type UsedTrade } from './match';
import { DEFAULT_SPACE, DEFAULT_TOLERANCE, SELECTION_PCT } from './search';
import { featuresUsed, importanceOf, predictRow, rulesText, trainTree, type State, type TreeNode } from './tree';
import { MIN_TRADES, SIGNAL_FAMILIES, type MatchScore, type SeriesInput, type SkippedTrade } from './types';

export const MODEL_VERSION = 1;
export const DEFAULT_DEPTH = 4;
/** Share of the training rows a leaf must hold, at least (and never fewer than MIN_LEAF_ROWS). */
const MIN_LEAF_SHARE = 0.005;
const MIN_LEAF_ROWS = 20;
/** The third family is searched only when it carries at least this share of the importance. */
const THIRD_FAMILY_SHARE = 0.1;
const MAX_TREE_DEPTH = 32;

export interface ModelFile {
  version: 1;
  features: Feature[];
  tree: TreeNode;
  trainedOn: { sets: number; trades: number; bars: number };
  /** ISO time. */
  createdAt: string;
}

export interface TrainInput {
  series: SeriesInput[];
  /** Families the narrowed search must include even when the tree gave them no importance. */
  requireFamilies?: string[];
  /** Default 4. */
  maxDepth?: number;
  /** Default a share of the training rows, at least 20. */
  minLeaf?: number;
  /** Default: now, taken once. */
  createdAt?: string;
  signal?: AbortSignal;
  /** `pct` is 0..1 and never decreases. */
  onProgress?: (pct: number, stage: TrainStage) => void;
}

export type TrainStage = 'features' | 'tree' | 'evaluating' | 'done';

export interface FeatureImportance {
  id: string;
  label: string;
  family: string | null;
  importance: number;
}

export interface FamilyImportance {
  /** Null for the readings that belong to no family. */
  family: string | null;
  importance: number;
}

export interface ModelImportance {
  /** Features with any importance, largest first. Sums to 1 when the tree has any split. */
  byFeature: FeatureImportance[];
  /** Largest first. Sums to 1 when the tree has any split. */
  byFamily: FamilyImportance[];
}

export interface ModelInsights {
  /** For example `long when SMA 8 / SMA 34 distance > 0.03%`, then `flat otherwise`. */
  rules: string[];
  importance: ModelImportance;
  /** The families to search: the top 2 or 3 by importance plus the required ones. */
  families: string[];
  /** Ranges for `searchStrategies`, per family in `families`. Never a `direction` key. */
  space: Record<string, SweepParam[]>;
}

export interface HeldOutReport {
  /** Share of held-out bars whose predicted state matches the highlighted one. */
  accuracy: number;
  /** Entry and exit match of the predicted states turned back into trades, within the search's tolerance. */
  f1: number;
  precision: number;
  recall: number;
  bars: number;
}

export interface TrainResult extends ModelInsights {
  kind: 'ok';
  model: ModelFile;
  heldOut: HeldOutReport;
  skipped: SkippedTrade[];
  usedTrades: number;
}

export type TrainOutcome =
  | TrainResult
  | { kind: 'too-few'; have: number; need: number; skipped: SkippedTrade[] }
  | { kind: 'refused'; reason: string };

const abortError = (): Error => new DOMException('The training was cancelled', 'AbortError');
const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/* ----------------------------- labels ----------------------------- */

/** Held state per bar: a bar is held from its entry bar up to, not including, its exit bar. */
function labelsOf(bars: number, trades: UsedTrade[]): Uint8Array {
  const out = new Uint8Array(bars);
  for (const t of trades) out.fill(t.side === 'long' ? 1 : 2, t.entry, Math.min(t.exit, bars));
  return out;
}

/* --------------------------- prediction --------------------------- */

/** Predicted state per bar. A bar where a feature the tree reads is not defined yet is flat. */
export function predictStates(model: ModelFile, candles: Candle[]): State[] {
  const columns = new Map<number, Float64Array>();
  for (const f of featuresUsed(model.tree)) columns.set(f, featureColumn(model.features[f].id, candles));
  return statesFrom(model.tree, columns, candles.length);
}

function statesFrom(tree: TreeNode, columns: Map<number, Float64Array>, bars: number): State[] {
  const used = [...columns.values()];
  const out = new Array<State>(bars).fill(0);
  for (let i = 0; i < bars; i++) {
    if (used.some((c) => Number.isNaN(c[i]))) continue;
    out[i] = predictRow(tree, (f) => (columns.get(f) as Float64Array)[i]);
  }
  return out;
}

/* ---------------------------- insights ---------------------------- */

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** A range centred on `v`, five points wide, kept inside the setting's own limits. */
function centred(family: string, key: string, v: number): SweepParam {
  const spec = getStrategy(family).params.find((p) => p.key === key);
  const unit = spec?.type === 'int' ? 1 : (spec?.step ?? 1);
  const step = round6(Math.max(unit, Math.round((v * 0.06) / unit) * unit));
  const reach = (limit: number | undefined, dir: 1 | -1): number => {
    let k = 2;
    while (k > 0 && limit != null && (dir === 1 ? v + k * step > limit : v - k * step < limit)) k--;
    return k;
  };
  return { key, from: round6(v - reach(spec?.min, -1) * step), to: round6(v + reach(spec?.max, 1) * step), step };
}

/** The family's search ranges, centred on `feature`'s settings; a setting the feature lacks keeps its default range. */
function spaceFor(family: string, feature: Feature | null): SweepParam[] {
  const defaults = DEFAULT_SPACE[family];
  if (!feature) return defaults.map((s) => ({ ...s }));
  const sweeps = defaults.map((d) => {
    const v = feature.params[d.key];
    return v == null ? { ...d } : centred(family, d.key, v);
  });
  // A fast average has to stay below the slow one.
  const fast = sweeps.find((s) => s.key === 'fast');
  const slow = sweeps.find((s) => s.key === 'slow');
  if (fast && slow && feature.params.fast != null && feature.params.slow != null) {
    while (fast.to >= slow.to && fast.to > feature.params.fast) fast.to = round6(fast.to - fast.step);
    while (slow.from <= fast.from && slow.from < feature.params.slow) slow.from = round6(slow.from + slow.step);
  }
  return sweeps;
}

/** Rules, importance and the narrowed search of a model (a trained one or one loaded from a file). */
export function describeModel(model: ModelFile, requireFamilies: string[] = []): ModelInsights {
  const { features, tree } = model;
  const imp = importanceOf(tree, features.length);
  const byFeature = features
    .map((f, i) => ({ id: f.id, label: f.label, family: f.family, importance: imp[i], index: i }))
    .filter((f) => f.importance > 0)
    .sort((a, b) => b.importance - a.importance || a.index - b.index);
  const sums = new Map<string | null, number>();
  for (const f of byFeature) sums.set(f.family, (sums.get(f.family) ?? 0) + f.importance);
  const byFamily = [...sums].map(([family, importance]) => ({ family, importance })).sort((a, b) => b.importance - a.importance);

  const ranked = byFamily.filter((f): f is { family: string; importance: number } => f.family != null);
  const families: string[] = ranked.slice(0, 2).map((f) => f.family);
  if (ranked[2] && ranked[2].importance >= THIRD_FAMILY_SHARE) families.push(ranked[2].family);
  for (const id of requireFamilies) if (!families.includes(id)) families.push(id);
  if (families.length === 0) families.push(...SIGNAL_FAMILIES);

  const space: Record<string, SweepParam[]> = {};
  for (const id of families) {
    const best = byFeature.find((f) => f.family === id);
    space[id] = spaceFor(id, best ? features[best.index] : null);
  }

  const rules = rulesText(
    tree,
    (f) => features[f].label,
    (f, v) => formatValue(features[f].id, v),
  );
  rules.push(rules.length ? 'flat otherwise' : 'flat on every bar');
  return {
    rules,
    importance: { byFeature: byFeature.map(({ index: _index, ...rest }) => rest), byFamily },
    families,
    space,
  };
}

/* ----------------------------- training ----------------------------- */

/** Trains the model. Resolves with the outcome; rejects with an AbortError when `signal` aborts. */
export async function trainModel(input: TrainInput): Promise<TrainOutcome> {
  const { series, signal, onProgress } = input;
  const requireFamilies = input.requireFamilies ?? [];
  const refuse = (reason: string): TrainOutcome => ({ kind: 'refused', reason });
  const checkAbort = (): void => {
    if (signal?.aborted) throw abortError();
  };
  let last = 0;
  const report = (pct: number, stage: TrainStage): void => {
    last = Math.max(last, Math.min(1, pct));
    onProgress?.(last, stage);
  };

  if (series.length === 0) return refuse('Give at least one chart with highlighted trades.');
  for (const id of requireFamilies) {
    if (!(SIGNAL_FAMILIES as readonly string[]).includes(id)) {
      return refuse(`Unknown strategy family "${id}". The model can use: ${SIGNAL_FAMILIES.join(', ')}.`);
    }
  }
  const createdAt = input.createdAt ?? new Date().toISOString();

  const skipped: SkippedTrade[] = [];
  const used = series.map((s, i) => usedTrades(s.candles, s.trades, i, 'both', skipped));
  const have = used.reduce((a, t) => a + t.length, 0);
  if (have < MIN_TRADES) return { kind: 'too-few', have, need: MIN_TRADES, skipped };

  // Every feature over every series; the first 70% of each is what the tree trains on.
  const cuts = series.map((s) => splitBars(s.candles, SELECTION_PCT).inSample.length);
  const columns: Float64Array[][] = series.map(() => []);
  for (let f = 0; f < FEATURES.length; f++) {
    checkAbort();
    series.forEach((s, k) => columns[k].push(featureColumn(FEATURES[f].id, s.candles)));
    report(0.4 * ((f + 1) / FEATURES.length), 'features');
    await yieldNow();
  }

  const labelsPerSeries = series.map((s, k) => labelsOf(s.candles.length, used[k]));
  const rowsPerSeries = series.map((_, k) => {
    const rows: number[] = [];
    for (let i = 0; i < cuts[k]; i++) if (columns[k].every((c) => !Number.isNaN(c[i]))) rows.push(i);
    return rows;
  });
  const bars = rowsPerSeries.reduce((a, r) => a + r.length, 0);
  if (bars === 0) return refuse('The charts are too short: no bar has every indicator defined yet.');
  const trainColumns = FEATURES.map((_, f) => {
    const col = new Float64Array(bars);
    let at = 0;
    rowsPerSeries.forEach((rows, k) => rows.forEach((i) => (col[at++] = columns[k][f][i])));
    return col;
  });
  const labels = new Uint8Array(bars);
  let at = 0;
  rowsPerSeries.forEach((rows, k) => rows.forEach((i) => (labels[at++] = labelsPerSeries[k][i])));

  const maxDepth = Math.max(0, Math.floor(input.maxDepth ?? DEFAULT_DEPTH));
  const minLeaf = Math.max(1, Math.floor(input.minLeaf ?? Math.max(MIN_LEAF_ROWS, Math.floor(bars * MIN_LEAF_SHARE))));
  const tree = await trainTree(trainColumns, labels, { maxDepth, minLeaf }, {
    level: async (done, total) => {
      checkAbort();
      report(0.4 + 0.5 * (done / total), 'tree');
      await yieldNow();
    },
  });

  const model: ModelFile = {
    version: MODEL_VERSION,
    features: FEATURES.map((f) => ({ ...f, params: { ...f.params } })),
    tree,
    trainedOn: { sets: series.length, trades: have, bars },
    createdAt,
  };

  // Held-out: the last 30% of each series, never seen by the tree.
  checkAbort();
  report(0.9, 'evaluating');
  const usedCols = featuresUsed(tree);
  let right = 0;
  let total = 0;
  const tallies = series.map((s, k) => {
    const states = statesFrom(tree, new Map(usedCols.map((f) => [f, columns[k][f]])), s.candles.length);
    const cut = cuts[k];
    for (let i = cut; i < states.length; i++) {
      total++;
      if (states[i] === labelsPerSeries[k][i]) right++;
    }
    const found = marksOf(states.slice(cut).map((st) => (st === 1 ? 1 : st === 2 ? -1 : 0)));
    const truth: Marks = {
      entries: used[k].map((t) => t.entry).filter((b) => b >= cut).map((b) => b - cut).sort((a, b) => a - b),
      exits: used[k].map((t) => t.exit).filter((b) => b >= cut).map((b) => b - cut).sort((a, b) => a - b),
    };
    return tally(found, truth, DEFAULT_TOLERANCE);
  });
  const score: MatchScore = scoreOf(tallies);
  const heldOut: HeldOutReport = { accuracy: total ? right / total : 0, f1: score.f1, precision: score.precision, recall: score.recall, bars: total };

  report(1, 'done');
  return { kind: 'ok', model, ...describeModel(model, requireFamilies), heldOut, skipped, usedTrades: have };
}

/* ---------------------------- model file ---------------------------- */

export function serializeModel(model: ModelFile): string {
  return JSON.stringify(model);
}

export type ParseResult = { ok: true; model: ModelFile } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseNode(v: unknown, featureCount: number, depth: number): TreeNode {
  if (depth > MAX_TREE_DEPTH) throw new Error('the tree is too deep');
  if (!isObject(v)) throw new Error('a tree node is not an object');
  if (v.leaf === true) {
    if (v.state !== 0 && v.state !== 1 && v.state !== 2) throw new Error('a leaf has a state other than 0, 1 or 2');
    return { leaf: true, state: v.state };
  }
  if (v.leaf !== false) throw new Error('a tree node says neither leaf nor split');
  if (v.left == null) throw new Error('a split node is missing its left child');
  if (v.right == null) throw new Error('a split node is missing its right child');
  const { feature, threshold, gain } = v;
  if (typeof feature !== 'number' || !Number.isInteger(feature) || feature < 0 || feature >= featureCount) {
    throw new Error(`a split node's feature index is out of range (${String(feature)} of ${featureCount} features)`);
  }
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) throw new Error('a split node has a threshold that is not a finite number');
  if (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0) throw new Error('a split node has a gain that is not a finite number');
  return {
    leaf: false,
    feature,
    threshold,
    gain,
    left: parseNode(v.left, featureCount, depth + 1),
    right: parseNode(v.right, featureCount, depth + 1),
  };
}

/** Reads a model file. Never throws: a problem comes back as a message. */
export function parseModel(text: string): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('The model file is not valid JSON.');
  }
  if (!isObject(raw)) return fail('The model file is not a model.');
  if (raw.version !== MODEL_VERSION) return fail(`The model file has version ${String(raw.version)}; this app reads version ${MODEL_VERSION}.`);
  if (!Array.isArray(raw.features) || raw.features.length === 0) return fail('The model file has no features.');
  const features: Feature[] = [];
  for (const f of raw.features as unknown[]) {
    if (!isObject(f) || typeof f.id !== 'string' || typeof f.label !== 'string' || !isObject(f.params)) return fail('The model file has a malformed feature.');
    const feature = { id: f.id, label: f.label, family: (f.family ?? null) as string | null, params: f.params as Record<string, number> };
    if (!isKnownFeature(feature)) return fail(`The model file uses an unknown feature "${f.id}".`);
    features.push(feature);
  }
  let tree: TreeNode;
  try {
    tree = parseNode(raw.tree, features.length, 0);
  } catch (e) {
    return fail(`The model file has a malformed tree: ${(e as Error).message}.`);
  }
  const on = raw.trainedOn;
  if (!isObject(on) || ![on.sets, on.trades, on.bars].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return fail('The model file has malformed training details.');
  }
  if (typeof raw.createdAt !== 'string') return fail('The model file has no creation time.');
  return {
    ok: true,
    model: {
      version: 1,
      features,
      tree,
      trainedOn: { sets: on.sets as number, trades: on.trades as number, bars: on.bars as number },
      createdAt: raw.createdAt,
    },
  };
}
