import { mulberry32 } from '../random';
import type { Trade } from './types';

export type MonteCarloMethod = 'shuffle' | 'bootstrap';

export interface MonteCarloInput {
  trades: Trade[];
  initialCapital: number;
}

export interface MonteCarloOptions {
  iterations: number;
  method: MonteCarloMethod;
  seed: number;
}

export const DEFAULT_MONTE_CARLO: MonteCarloOptions = { iterations: 1000, method: 'shuffle', seed: 1 };
export const MC_MIN_RUNS = 100;
export const MC_MAX_RUNS = 10000;
export const MC_MIN_TRADES = 2;
export const MC_BINS = 20;
export const MC_PERCENTILES = [5, 25, 50, 75, 95] as const;

export interface Percentiles {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface MonteCarloResult {
  method: MonteCarloMethod;
  iterations: number;
  seed: number;
  trades: number;
  initialCapital: number;
  /** Final return in percent of initial capital. */
  finalReturn: Percentiles;
  /** Max drawdown in percent (positive), measured trade to trade. */
  maxDrawdown: Percentiles;
  /** Share of simulated paths ending below initial capital, in percent. */
  probLossPct: number;
  /** The finished run itself, measured the same way as the simulations. */
  original: {
    finalReturnPct: number;
    maxDrawdownPct: number;
    /** Share of simulations at or below the original, in percent. */
    finalReturnRankPct: number;
    maxDrawdownRankPct: number;
  };
  /** Equal-width bins of final return from min to max (one bin when they are equal). */
  histogram: HistogramBin[];
}

/** Tolerance for comparing floating point paths that should be equal (e.g. shuffled final returns). */
const EPS = 1e-9;

/** Trades in the order they closed: by exit time, then id. Does not mutate the input. */
export function orderedTrades(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => a.exitTime - b.exitTime || a.id - b.id);
}

/** Per-trade return r_i = pnl_i / E_{i-1}, where E_0 is the initial capital and E_i = E_{i-1} + pnl_i. */
export function tradeReturns(trades: Trade[], initialCapital: number): number[] {
  const out: number[] = [];
  let equity = initialCapital;
  for (const t of orderedTrades(trades)) {
    out.push(equity === 0 ? 0 : t.pnl / equity);
    equity += t.pnl;
  }
  return out;
}

/** Final return % and max drawdown % of the path E'_k = E'_(k-1) * (1 + r_k), measured on [E'_0 .. E'_n] (the peak includes the start). */
export function pathStats(returns: ArrayLike<number>, initialCapital: number): { finalReturnPct: number; maxDrawdownPct: number } {
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDd = 0;
  for (let k = 0; k < returns.length; k++) {
    equity *= 1 + returns[k];
    if (equity > peak) peak = equity;
    else if (peak > 0) {
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return { finalReturnPct: (equity / initialCapital - 1) * 100, maxDrawdownPct: maxDd };
}

/** Nearest rank: for an ascending list of N values, the p-th percentile is sorted[ceil(p / 100 * N) - 1]. */
export function nearestRank(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))];
}

function percentiles(sorted: ArrayLike<number>): Percentiles {
  return {
    p5: nearestRank(sorted, 5),
    p25: nearestRank(sorted, 25),
    p50: nearestRank(sorted, 50),
    p75: nearestRank(sorted, 75),
    p95: nearestRank(sorted, 95),
  };
}

/** Share of values at or below `x`, in percent. */
function rankPct(sorted: ArrayLike<number>, x: number): number {
  let n = 0;
  for (let i = 0; i < sorted.length; i++) if (sorted[i] <= x + EPS) n++;
  return (n / sorted.length) * 100;
}

/** Seeded Fisher-Yates, in place. */
export function shuffleInPlace(a: Float64Array, rand: () => number): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
}

export function histogram(values: ArrayLike<number>, bins = MC_BINS): HistogramBin[] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  // Equal within float noise (a shuffle reorders the same product): one bin.
  if (max - min <= EPS) return [{ from: min, to: max, count: values.length }];
  const width = (max - min) / bins;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (let i = 0; i < values.length; i++) {
    out[Math.min(bins - 1, Math.floor((values[i] - min) / width))].count++;
  }
  return out;
}

/**
 * Reshuffles (`shuffle`) or resamples with replacement (`bootstrap`) the run's per-trade returns `iterations` times and
 * reports the spread of final return and max drawdown. Pure and seeded: the same input and options give the same result.
 */
export function runMonteCarlo(input: MonteCarloInput, opts: Partial<MonteCarloOptions> = {}): MonteCarloResult {
  const { iterations, method, seed } = { ...DEFAULT_MONTE_CARLO, ...opts };
  if (input.trades.length < MC_MIN_TRADES) throw new Error(`Monte Carlo needs at least ${MC_MIN_TRADES} trades`);
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error('Monte Carlo needs a whole number of runs');
  const { initialCapital } = input;
  const base = Float64Array.from(tradeReturns(input.trades, initialCapital));
  const n = base.length;
  const rand = mulberry32(seed);
  const finals = new Float64Array(iterations);
  const dds = new Float64Array(iterations);
  const path = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    if (method === 'shuffle') {
      path.set(base);
      shuffleInPlace(path, rand);
    } else {
      for (let k = 0; k < n; k++) path[k] = base[Math.floor(rand() * n)];
    }
    const s = pathStats(path, initialCapital);
    finals[it] = s.finalReturnPct;
    dds[it] = s.maxDrawdownPct;
  }
  const original = pathStats(base, initialCapital);
  const sortedFinals = Float64Array.from(finals).sort();
  const sortedDds = Float64Array.from(dds).sort();
  let losses = 0;
  for (let i = 0; i < iterations; i++) if (finals[i] < -EPS) losses++;
  return {
    method,
    iterations,
    seed,
    trades: n,
    initialCapital,
    finalReturn: percentiles(sortedFinals),
    maxDrawdown: percentiles(sortedDds),
    probLossPct: (losses / iterations) * 100,
    original: {
      finalReturnPct: original.finalReturnPct,
      maxDrawdownPct: original.maxDrawdownPct,
      finalReturnRankPct: rankPct(sortedFinals, original.finalReturnPct),
      maxDrawdownRankPct: rankPct(sortedDds, original.maxDrawdownPct),
    },
    histogram: histogram(finals),
  };
}
