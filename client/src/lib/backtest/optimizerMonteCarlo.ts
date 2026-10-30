/**
 * Monte Carlo validation of an optimizer run: the grid runs on the whole range, the top results are each
 * run once more to get their trades, and the backtester's Monte Carlo is run on each with the same settings.
 */
import type { Candle } from '../../types';
import { runMonteCarlo, MC_MIN_TRADES, type MonteCarloMethod, type MonteCarloResult } from './monteCarlo';
import { runOptimizeAsync, gridSize, type OptimizeConfig, type OptimizeOutput } from './optimizer';
import { runAnyBacktest } from './runner';
import type { BacktestConfig } from './types';

/** The settings of a Monte Carlo validation (also stored in the run's context). */
export interface MonteCarloValidationSettings {
  method: 'monte-carlo';
  topN: number;
  iterations: number;
  mcMethod: MonteCarloMethod;
  seed: number;
}

export const DEFAULT_MONTE_CARLO_VALIDATION = {
  method: 'monte-carlo',
  topN: 10,
  iterations: 1000,
  mcMethod: 'shuffle',
  seed: 1,
} as const satisfies MonteCarloValidationSettings;

export interface McCheck {
  /** 1-based rank in the grid results. */
  rank: number;
  params: Record<string, number>;
  value: number | null;
  trades: number | null;
  status: 'ok' | 'failed' | 'too-few-trades';
  result: MonteCarloResult | null;
}

export type MonteCarloValidationOutput = MonteCarloValidationSettings & {
  checks: McCheck[];
  /** Re-runs that threw. */
  failed: number;
};

export async function runMonteCarloValidation(
  candles: Candle[],
  baseConfig: BacktestConfig,
  opt: OptimizeConfig,
  v: MonteCarloValidationSettings,
  onProgress?: (pct: number) => void,
): Promise<OptimizeOutput & { validation: MonteCarloValidationOutput }> {
  let last = 0;
  const report = (p: number) => {
    const next = Math.min(1, Math.max(last, p));
    if (next === last) return;
    last = next;
    onProgress?.(next);
  };
  const combos = gridSize(opt);
  const gridShare = combos / (combos + Math.min(v.topN, combos));
  const gridOut = await runOptimizeAsync(candles, baseConfig, opt, (p) => report(p * gridShare));

  const top = gridOut.rows.map((row, i) => ({ row, rank: i + 1 })).filter((r) => r.row.value != null).slice(0, v.topN);
  const total = gridOut.combos + top.length;
  report(gridOut.combos / total);

  const checks: McCheck[] = [];
  let failed = 0;
  for (const [i, { row, rank }] of top.entries()) {
    const check: McCheck = { rank, params: row.params, value: row.value, trades: null, status: 'failed', result: null };
    try {
      const res = await runAnyBacktest(candles, { ...baseConfig, params: { ...baseConfig.params, ...row.params } });
      check.trades = res.trades.length;
      if (res.trades.length < MC_MIN_TRADES) {
        check.status = 'too-few-trades';
      } else {
        check.result = runMonteCarlo(
          { trades: res.trades, initialCapital: res.metrics.initialCapital },
          { iterations: v.iterations, method: v.mcMethod, seed: v.seed },
        );
        check.status = 'ok';
      }
    } catch {
      failed++;
      check.trades = null;
      check.result = null;
      check.status = 'failed';
    }
    checks.push(check);
    report((gridOut.combos + i + 1) / total);
  }
  report(1);
  return {
    ...gridOut,
    validation: { method: 'monte-carlo', topN: v.topN, iterations: v.iterations, mcMethod: v.mcMethod, seed: v.seed, checks, failed },
  };
}

export type McColumn =
  | 'rank'
  | 'value'
  | 'trades'
  | 'returnP5'
  | 'returnP50'
  | 'returnP95'
  | 'drawdownP5'
  | 'drawdownP50'
  | 'drawdownP95'
  | 'probLoss';

export function mcColumnValue(c: McCheck, column: McColumn): number | null {
  const r = c.result;
  switch (column) {
    case 'rank':
      return c.rank;
    case 'value':
      return c.value != null && !Number.isNaN(c.value) ? c.value : null;
    case 'trades':
      return c.trades;
    case 'returnP5':
      return r ? r.finalReturn.p5 : null;
    case 'returnP50':
      return r ? r.finalReturn.p50 : null;
    case 'returnP95':
      return r ? r.finalReturn.p95 : null;
    case 'drawdownP5':
      return r ? r.maxDrawdown.p5 : null;
    case 'drawdownP50':
      return r ? r.maxDrawdown.p50 : null;
    case 'drawdownP95':
      return r ? r.maxDrawdown.p95 : null;
    case 'probLoss':
      return r ? r.probLossPct : null;
  }
}

/** The checks sorted by a column; rows without a figure go last in either direction; ties keep rank order. */
export function sortMcChecks(checks: McCheck[], column: McColumn, dir: 'asc' | 'desc'): McCheck[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...checks].sort((a, b) => {
    const x = mcColumnValue(a, column);
    const y = mcColumnValue(b, column);
    if (x == null && y == null) return a.rank - b.rank;
    if (x == null) return 1;
    if (y == null) return -1;
    return x === y ? a.rank - b.rank : x < y ? -sign : sign;
  });
}
