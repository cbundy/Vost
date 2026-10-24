/**
 * Parameter sweep optimizer. Grid search over one or two strategy parameters,
 * ranked by a chosen metric. Runs entirely in the browser (Web Worker).
 */
import type { Candle } from '../../types';
import { runAnyBacktest, runFullBacktest } from './runner';
import { getStrategy } from './strategies';
import type { BacktestConfig, Metrics } from './types';

export type MetricKey = 'totalReturnPct' | 'cagrPct' | 'sharpe' | 'sortino' | 'profitFactor' | 'maxDrawdownPct' | 'calmar' | 'winRatePct';

export const METRIC_LABELS: Record<MetricKey, string> = {
  totalReturnPct: 'Total return %',
  cagrPct: 'CAGR %',
  sharpe: 'Sharpe',
  sortino: 'Sortino',
  profitFactor: 'Profit factor',
  maxDrawdownPct: 'Max drawdown % (less negative = better)',
  calmar: 'Calmar',
  winRatePct: 'Win rate %',
};

export interface SweepParam {
  key: string;
  from: number;
  to: number;
  step: number;
}

export interface OptimizeConfig {
  sweepA: SweepParam;
  /** Optional second parameter (creates a 2D grid). */
  sweepB: SweepParam | null;
  metric: MetricKey;
  /** Keep only this many best rows (also the full grid is returned). */
  maxCombos: number;
}

export interface OptimizeRow {
  params: Record<string, number>;
  metrics: Metrics;
  value: number | null;
}

export interface OptimizeOutput {
  rows: OptimizeRow[];
  metric: MetricKey;
  combos: number;
  errored: number;
}

export function defaultOptimizeConfig(config: BacktestConfig): OptimizeConfig {
  const strategy = getStrategy(config.strategyId);
  const numeric = strategy.params.filter((p) => p.type !== 'select' && !p.key.startsWith('__'));
  const a = numeric[0]?.key ?? 'fast';
  const b = numeric[1]?.key ?? 'slow';
  const aDefault = config.params[a] ?? strategy.params.find((p) => p.key === a)?.default ?? 10;
  const bDefault = config.params[b] ?? strategy.params.find((p) => p.key === b)?.default ?? 30;
  return {
    sweepA: { key: a, from: Math.max(1, Math.round(aDefault * 0.5)), to: Math.max(2, Math.round(aDefault * 1.5)), step: 1 },
    sweepB: b !== a ? { key: b, from: Math.max(2, Math.round(bDefault * 0.5)), to: Math.max(3, Math.round(bDefault * 1.5)), step: 2 } : null,
    metric: 'sharpe',
    maxCombos: 400,
  };
}

export function paramValues(s: SweepParam): number[] {
  const step = Math.abs(s.step) || 1;
  const from = Math.min(s.from, s.to);
  const to = Math.max(s.from, s.to);
  const out: number[] = [];
  for (let v = from; v <= to + step * 1e-9; v += step) {
    out.push(Math.round(v * 1e6) / 1e6);
    if (out.length >= 60) break; // guard
  }
  return out;
}

function* gridCombos(baseConfig: BacktestConfig, opt: OptimizeConfig): Generator<Record<string, number>> {
  const valuesB = opt.sweepB ? paramValues(opt.sweepB) : [null];
  for (const va of paramValues(opt.sweepA)) {
    for (const vb of valuesB) {
      const params = { ...baseConfig.params, [opt.sweepA.key]: va };
      if (vb != null && opt.sweepB) params[opt.sweepB.key] = vb;
      yield params;
    }
  }
}

function gridSize(opt: OptimizeConfig): number {
  return paramValues(opt.sweepA).length * (opt.sweepB ? paramValues(opt.sweepB).length : 1);
}

function toRow(params: Record<string, number>, metrics: Metrics, metric: MetricKey): OptimizeRow {
  const value = metrics[metric] as number | null;
  return { params, metrics, value: Number.isFinite(value as number) ? (value as number) : null };
}

export function runOptimize(
  candles: Candle[],
  baseConfig: BacktestConfig,
  opt: OptimizeConfig,
  onProgress?: (pct: number) => void,
): OptimizeOutput {
  const combos = gridSize(opt);
  const rows: OptimizeRow[] = [];
  let errored = 0;
  let done = 0;

  for (const params of gridCombos(baseConfig, opt)) {
    try {
      rows.push(toRow(params, runFullBacktest(candles, { ...baseConfig, params }).metrics, opt.metric));
    } catch {
      errored++;
    }
    done++;
    if (onProgress && (done % 5 === 0 || done === combos)) onProgress(done / combos);
  }
  return finish(rows, opt.metric, combos, errored);
}

/** Async grid sweep: awaits every combination, so it also covers Pine strategies. */
export async function runOptimizeAsync(
  candles: Candle[],
  baseConfig: BacktestConfig,
  opt: OptimizeConfig,
  onProgress?: (pct: number) => void,
): Promise<OptimizeOutput> {
  const combos = gridSize(opt);
  const rows: OptimizeRow[] = [];
  let errored = 0;
  let done = 0;

  for (const params of gridCombos(baseConfig, opt)) {
    try {
      rows.push(toRow(params, (await runAnyBacktest(candles, { ...baseConfig, params })).metrics, opt.metric));
    } catch {
      errored++;
    }
    done++;
    if (onProgress && (done % 5 === 0 || done === combos)) onProgress(done / combos);
  }
  return finish(rows, opt.metric, combos, errored);
}

function finish(rows: OptimizeRow[], metric: MetricKey, combos: number, errored: number): OptimizeOutput {
  rows.sort((a, b) => {
    if (a.value == null && b.value == null) return 0;
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    return b.value - a.value;
  });

  return { rows, metric, combos, errored };
}
