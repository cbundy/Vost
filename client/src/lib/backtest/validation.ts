/**
 * Validation of an optimizer run. The first method is an in-sample / out-of-sample split:
 * the grid is searched on the first part of the range and its best results are run again on
 * the held-out rest. Later methods add their own members to the same unions.
 */
import type { Candle } from '../../types';
import { MIN_RANGE_BARS } from '../timeRange';
import { gridSize, runOptimizeAsync, type OptimizeConfig, type OptimizeOutput } from './optimizer';
import { runAnyBacktest } from './runner';
import type { BacktestConfig, Metrics } from './types';

export type ValidationConfig =
  | { method: 'none' }
  | { method: 'split'; inSamplePct: number; topN: number };

export const DEFAULT_SPLIT = { method: 'split', inSamplePct: 70, topN: 10 } as const satisfies ValidationConfig;
export const SPLIT_PCT_MIN = 50;
export const SPLIT_PCT_MAX = 95;
export const SPLIT_TOPN_MIN = 1;
export const SPLIT_TOPN_MAX = 50;

/** A stretch of bars: unix seconds of the first and last bar, and how many there are. */
export interface Span {
  from: number;
  to: number;
  bars: number;
}

/** The settings and spans of a split run (also stored in the run's context). */
export interface SplitSettings {
  method: 'split';
  inSamplePct: number;
  topN: number;
  inSample: Span;
  heldOut: Span;
}

export interface Check {
  /** 1-based rank in the in-sample results. */
  rank: number;
  params: Record<string, number>;
  inSample: Metrics;
  /** Null when the held-out run threw. */
  heldOut: Metrics | null;
  heldOutValue: number | null;
  /** Rank by held-out ranking value, higher first; null when the value is null. */
  heldOutRank: number | null;
}

export type ValidationOutput = SplitSettings & {
  checks: Check[];
  /** Held-out runs that threw. */
  failed: number;
};

export type ValidatedOptimizeOutput = OptimizeOutput & { validation?: ValidationOutput };

export interface SplitBars {
  inSample: Candle[];
  heldOut: Candle[];
}

/** The in-sample part is the first floor(n * pct / 100) bars; the held-out part is the rest. */
export function splitBars(candles: Candle[], inSamplePct: number): SplitBars {
  const cut = Math.floor((candles.length * inSamplePct) / 100);
  return { inSample: candles.slice(0, cut), heldOut: candles.slice(cut) };
}

export function spanOf(candles: Candle[]): Span {
  return { from: candles[0]?.time ?? 0, to: candles[candles.length - 1]?.time ?? 0, bars: candles.length };
}

/** Why a validation setting cannot run on `bars` bars, or null. Shared by the pane, the state and the engine. */
export function validationProblem(v: ValidationConfig | undefined, bars: number): string | null {
  if (!v || v.method === 'none') return null;
  if (!Number.isInteger(v.inSamplePct) || v.inSamplePct < SPLIT_PCT_MIN || v.inSamplePct > SPLIT_PCT_MAX) {
    return `In-sample % must be a whole number from ${SPLIT_PCT_MIN} to ${SPLIT_PCT_MAX}.`;
  }
  if (!Number.isInteger(v.topN) || v.topN < SPLIT_TOPN_MIN || v.topN > SPLIT_TOPN_MAX) {
    return `Top results to check must be a whole number from ${SPLIT_TOPN_MIN} to ${SPLIT_TOPN_MAX}.`;
  }
  const inSample = Math.floor((bars * v.inSamplePct) / 100);
  const heldOut = bars - inSample;
  if (inSample < MIN_RANGE_BARS) return `In-sample part has ${inSample} bars; it needs at least ${MIN_RANGE_BARS}`;
  if (heldOut < MIN_RANGE_BARS) return `Held-out part has ${heldOut} bars; it needs at least ${MIN_RANGE_BARS}`;
  return null;
}

function rankValue(metrics: Metrics, metric: OptimizeConfig['metric']): number | null {
  const v = metrics[metric] as number | null;
  return v != null && !Number.isNaN(v) ? v : null;
}

/**
 * Runs the optimizer, with the validation the config asks for. With none (or no validation) this is
 * exactly runOptimizeAsync on the whole range. Progress runs 0..1 across the whole job.
 */
export async function runValidatedOptimize(
  candles: Candle[],
  baseConfig: BacktestConfig,
  opt: OptimizeConfig,
  onProgress?: (pct: number) => void,
): Promise<ValidatedOptimizeOutput> {
  const v = opt.validation;
  if (!v || v.method === 'none') return runOptimizeAsync(candles, baseConfig, opt, onProgress);

  const problem = validationProblem(v, candles.length);
  if (problem) throw new Error(problem);
  const { inSample, heldOut } = splitBars(candles, v.inSamplePct);

  // The number of checks is only known once the grid has ranked; until then assume the most it could be.
  let last = 0;
  const report = (p: number) => {
    const next = Math.min(1, Math.max(last, p));
    if (next === last) return;
    last = next;
    onProgress?.(next);
  };
  const combos = gridSize(opt);
  const gridShare = combos / (combos + Math.min(v.topN, combos));
  const gridOut = await runOptimizeAsync(inSample, baseConfig, opt, (p) => report(p * gridShare));

  const top = gridOut.rows.map((row, i) => ({ row, rank: i + 1 })).filter((r) => r.row.value != null).slice(0, v.topN);
  const total = gridOut.combos + top.length;
  report(gridOut.combos / total);

  const checks: Check[] = [];
  let failed = 0;
  for (const [i, { row, rank }] of top.entries()) {
    let metrics: Metrics | null = null;
    try {
      metrics = (await runAnyBacktest(heldOut, { ...baseConfig, params: { ...baseConfig.params, ...row.params } })).metrics;
    } catch {
      failed++;
    }
    checks.push({
      rank,
      params: row.params,
      inSample: row.metrics,
      heldOut: metrics,
      heldOutValue: metrics ? rankValue(metrics, opt.metric) : null,
      heldOutRank: null,
    });
    report((gridOut.combos + i + 1) / total);
  }

  // Higher is better; ties keep the checks' order; null values stay unranked.
  const ranked = checks
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.heldOutValue != null)
    .sort((a, b) => {
      const x = a.c.heldOutValue as number;
      const y = b.c.heldOutValue as number;
      return x === y ? a.i - b.i : x > y ? -1 : 1;
    });
  ranked.forEach((x, k) => {
    x.c.heldOutRank = k + 1;
  });

  report(1);
  return {
    ...gridOut,
    validation: {
      method: 'split',
      inSamplePct: v.inSamplePct,
      topN: v.topN,
      inSample: spanOf(inSample),
      heldOut: spanOf(heldOut),
      checks,
      failed,
    },
  };
}
