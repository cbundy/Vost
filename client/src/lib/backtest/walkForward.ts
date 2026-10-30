/**
 * Walk-forward validation. The range is cut into windows: each window's grid is searched on its
 * in-sample bars, the winner is run once on the held-out stretch right after them, and the held-out
 * stretches (which join without gaps and end at the last bar) are combined into one result.
 */
import type { Candle } from '../../types';
import { MIN_RANGE_BARS } from '../timeRange';
import { gridSize, MAX_GRID_COMBOS, runOptimizeAsync, type MetricKey, type OptimizeConfig, type OptimizeOutput } from './optimizer';
import { runAnyBacktest } from './runner';
import type { BacktestConfig, EquityPoint, Metrics } from './types';
import type { Span } from './validation';

export interface WalkForwardConfig {
  method: 'walk-forward';
  /** Whole number of windows. */
  windows: number;
  /** Share of each window's bars that is in-sample, in percent (whole number). */
  inSamplePct: number;
  /** Anchored: the in-sample part grows from the first bar. Rolling: it keeps its length and slides. */
  anchored: boolean;
}

export const DEFAULT_WALK_FORWARD = { method: 'walk-forward', windows: 5, inSamplePct: 70, anchored: false } as const satisfies WalkForwardConfig;
export const WF_WINDOWS_MIN = 2;
export const WF_WINDOWS_MAX = 20;
export const WF_PCT_MIN = 50;
export const WF_PCT_MAX = 95;

/** Half-open bar index range [from, to). */
export interface IndexRange {
  from: number;
  to: number;
}

export interface WindowRanges {
  inSample: IndexRange;
  heldOut: IndexRange;
}

/** Bars of the in-sample part (of the first window) and of each held-out block, for `n` bars. */
export function walkForwardSizes(n: number, cfg: Pick<WalkForwardConfig, 'windows' | 'inSamplePct'>): { isLen: number; oosLen: number } {
  const oosLen = Math.floor(n / (cfg.windows + cfg.inSamplePct / (100 - cfg.inSamplePct)));
  return { isLen: n - cfg.windows * oosLen, oosLen };
}

/**
 * The windows as bar index ranges. With n bars, k windows and p = in-sample %:
 *   oosLen = floor(n / (k + p / (100 - p)))      bars in each held-out block
 *   isLen  = n - k * oosLen                      bars in the in-sample part
 * Held-out block i (0..k-1) is [isLen + i*oosLen, isLen + (i+1)*oosLen): the blocks are contiguous and the last
 * ends at bar n-1. Rolling: window i's in-sample part is the isLen bars just before its block.
 * Anchored: it is every bar from the start up to its block, [0, isLen + i*oosLen).
 */
export function walkForwardWindows(n: number, cfg: WalkForwardConfig): WindowRanges[] {
  const { isLen, oosLen } = walkForwardSizes(n, cfg);
  const out: WindowRanges[] = [];
  for (let i = 0; i < cfg.windows; i++) {
    const start = isLen + i * oosLen;
    out.push({
      inSample: { from: cfg.anchored ? 0 : start - isLen, to: start },
      heldOut: { from: start, to: start + oosLen },
    });
  }
  return out;
}

/** Why a walk-forward setting cannot run on `bars` bars, or null. */
export function walkForwardProblem(v: WalkForwardConfig, bars: number): string | null {
  if (!Number.isInteger(v.windows) || v.windows < WF_WINDOWS_MIN || v.windows > WF_WINDOWS_MAX) {
    return `Windows must be a whole number from ${WF_WINDOWS_MIN} to ${WF_WINDOWS_MAX}.`;
  }
  if (!Number.isInteger(v.inSamplePct) || v.inSamplePct < WF_PCT_MIN || v.inSamplePct > WF_PCT_MAX) {
    return `In-sample % must be a whole number from ${WF_PCT_MIN} to ${WF_PCT_MAX}.`;
  }
  const { isLen, oosLen } = walkForwardSizes(bars, v);
  if (isLen < MIN_RANGE_BARS) return `In-sample part has ${isLen} bars; it needs at least ${MIN_RANGE_BARS}`;
  if (oosLen < MIN_RANGE_BARS) return `Held-out part has ${oosLen} bars; it needs at least ${MIN_RANGE_BARS}`;
  return null;
}

/** Backtests a walk-forward run does: one grid per window plus one held-out run per window. */
export function walkForwardBacktests(windows: number, combos: number): number {
  return windows * combos + windows;
}

export function checkWalkForwardLimit(windows: number, combos: number): void {
  const total = walkForwardBacktests(windows, combos);
  if (total > MAX_GRID_COMBOS) {
    throw new Error(`Walk-forward needs ${total} backtests (${windows} windows x ${combos} combinations + ${windows}); the limit is ${MAX_GRID_COMBOS}. Use fewer windows or narrow the grid.`);
  }
}

/** The settings and spans of a walk-forward run (also stored in the run's context). */
export interface WalkForwardSettings {
  method: 'walk-forward';
  windows: number;
  inSamplePct: number;
  anchored: boolean;
  spans: Array<{ inSample: Span; heldOut: Span }>;
}

export interface WalkForwardWindow {
  /** 1-based. */
  index: number;
  inSample: Span;
  heldOut: Span;
  /** ok: winner found and run held-out; no-winner: no row had a ranking value; failed: the held-out run threw. */
  status: 'ok' | 'no-winner' | 'failed';
  params: Record<string, number> | null;
  inSampleMetrics: Metrics | null;
  inSampleValue: number | null;
  heldOutMetrics: Metrics | null;
  heldOutValue: number | null;
}

export interface WalkForwardCombined {
  totalReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  /** Mean held-out CAGR over mean in-sample CAGR; null (n/a) when any is missing or the in-sample mean is not positive. */
  efficiency: number | null;
}

export interface WalkForwardOutput extends WalkForwardSettings {
  results: WalkForwardWindow[];
  /** Windows without a held-out result (no winner or failed). */
  incomplete: number;
  /** Held-out runs that threw. */
  failed: number;
  /** Null unless every window has a held-out result. */
  combined: WalkForwardCombined | null;
  /** The held-out equity joined into one series (empty when not combined). */
  equity: EquityPoint[];
}

/**
 * Joins the held-out equity curves. Each starts at the initial capital, so window i is scaled by the product of the
 * earlier windows' final / initial ratios. The drawdown is recomputed on the joined series, the peak carried across windows.
 */
export function stitchEquity(parts: EquityPoint[][], initialCapital: number): EquityPoint[] {
  const out: EquityPoint[] = [];
  let scale = 1;
  let peak = initialCapital;
  for (const part of parts) {
    for (const p of part) {
      const eq = p.equity * scale;
      if (eq > peak) peak = eq;
      out.push({ time: p.time, equity: eq, drawdownPct: peak > 0 ? (eq / peak - 1) * 100 : 0, position: p.position });
    }
    const last = part[part.length - 1];
    if (last && initialCapital > 0) scale *= last.equity / initialCapital;
  }
  return out;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The combined figures of windows that all have a held-out result. */
export function combineWalkForward(results: WalkForwardWindow[], equity: EquityPoint[]): WalkForwardCombined {
  let growth = 1;
  let trades = 0;
  for (const r of results) {
    growth *= 1 + (r.heldOutMetrics as Metrics).totalReturnPct / 100;
    trades += (r.heldOutMetrics as Metrics).trades;
  }
  let maxDrawdownPct = 0;
  for (const p of equity) if (p.drawdownPct < maxDrawdownPct) maxDrawdownPct = p.drawdownPct;
  const outCagr = results.map((r) => (r.heldOutMetrics as Metrics).cagrPct);
  const inCagr = results.map((r) => r.inSampleMetrics?.cagrPct ?? null);
  let efficiency: number | null = null;
  if (outCagr.every((v) => v != null) && inCagr.every((v) => v != null)) {
    const inMean = mean(inCagr as number[]);
    if (inMean > 0) efficiency = mean(outCagr as number[]) / inMean;
  }
  return { totalReturnPct: (growth - 1) * 100, maxDrawdownPct, trades, efficiency };
}

function spanOfSlice(c: Candle[]): Span {
  return { from: c[0]?.time ?? 0, to: c[c.length - 1]?.time ?? 0, bars: c.length };
}

function rankValue(metrics: Metrics, metric: MetricKey): number | null {
  const v = metrics[metric] as number | null;
  return v != null && !Number.isNaN(v) ? v : null;
}

/** Runs the walk-forward; `grid` is the last window's in-sample grid. Progress runs 0..1 across all windows and never moves backward. */
export async function runWalkForward(
  candles: Candle[],
  baseConfig: BacktestConfig,
  opt: OptimizeConfig,
  cfg: WalkForwardConfig,
  onProgress?: (pct: number) => void,
): Promise<{ walkForward: WalkForwardOutput; grid: OptimizeOutput }> {
  const problem = walkForwardProblem(cfg, candles.length);
  if (problem) throw new Error(problem);
  const combos = gridSize(opt);
  checkWalkForwardLimit(cfg.windows, combos);

  let lastP = 0;
  const report = (p: number) => {
    const next = Math.min(1, Math.max(lastP, p));
    if (next === lastP) return;
    lastP = next;
    onProgress?.(next);
  };
  const share = 1 / cfg.windows;
  const gridShare = combos / (combos + 1);

  const ranges = walkForwardWindows(candles.length, cfg);
  const results: WalkForwardWindow[] = [];
  const heldParts: EquityPoint[][] = [];
  let lastGrid: OptimizeOutput | null = null;
  let failed = 0;

  for (const [i, r] of ranges.entries()) {
    const inBars = candles.slice(r.inSample.from, r.inSample.to);
    const outBars = candles.slice(r.heldOut.from, r.heldOut.to);
    const grid = await runOptimizeAsync(inBars, baseConfig, opt, (p) => report((i + p * gridShare) * share));
    lastGrid = grid;
    const win: WalkForwardWindow = {
      index: i + 1,
      inSample: spanOfSlice(inBars),
      heldOut: spanOfSlice(outBars),
      status: 'no-winner',
      params: null,
      inSampleMetrics: null,
      inSampleValue: null,
      heldOutMetrics: null,
      heldOutValue: null,
    };
    const winner = grid.rows.find((row) => row.value != null);
    if (winner) {
      win.params = winner.params;
      win.inSampleMetrics = winner.metrics;
      win.inSampleValue = winner.value;
      try {
        const res = await runAnyBacktest(outBars, { ...baseConfig, params: { ...baseConfig.params, ...winner.params } });
        win.heldOutMetrics = res.metrics;
        win.heldOutValue = rankValue(res.metrics, opt.metric);
        win.status = 'ok';
        heldParts.push(res.equity);
      } catch {
        win.status = 'failed';
        failed++;
      }
    }
    results.push(win);
    report((i + 1) * share);
  }

  const incomplete = results.filter((w) => w.heldOutMetrics == null).length;
  const equity = incomplete === 0 ? stitchEquity(heldParts, baseConfig.initialCapital) : [];
  report(1);
  const walkForward: WalkForwardOutput = {
    method: 'walk-forward',
    windows: cfg.windows,
    inSamplePct: cfg.inSamplePct,
    anchored: cfg.anchored,
    spans: results.map((w) => ({ inSample: w.inSample, heldOut: w.heldOut })),
    results,
    incomplete,
    failed,
    combined: incomplete === 0 ? combineWalkForward(results, equity) : null,
    equity,
  };
  return { walkForward, grid: lastGrid as OptimizeOutput };
}
