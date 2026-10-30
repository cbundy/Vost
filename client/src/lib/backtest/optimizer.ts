/**
 * Parameter sweep optimizer. Grid search over any number of strategy parameters,
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
  /** One sweep per parameter, in sweep order (first outermost). The grid is their product. */
  sweeps: SweepParam[];
  metric: MetricKey;
}

export interface OptimizeRow {
  /** Only the swept parameters (see OptimizeOutput.keys); the rest come from the base config. */
  params: Record<string, number>;
  metrics: Metrics;
  value: number | null;
}

export interface OptimizeOutput {
  rows: OptimizeRow[];
  /** Swept parameter keys, in sweep order. */
  keys: string[];
  metric: MetricKey;
  combos: number;
  errored: number;
}

/** Largest grid (combinations) the optimizer accepts. */
export const MAX_GRID_COMBOS = 100_000;

export function defaultOptimizeConfig(config: BacktestConfig): OptimizeConfig {
  const strategy = getStrategy(config.strategyId);
  const numeric = strategy.params.filter((p) => p.type !== 'select' && !p.key.startsWith('__'));
  if (numeric.length === 0) {
    return { sweeps: [{ key: 'fast', from: 5, to: 15, step: 1 }, { key: 'slow', from: 15, to: 45, step: 2 }], metric: 'sharpe' };
  }
  const sweeps: SweepParam[] = numeric.slice(0, 2).map((p, i) => {
    const d = config.params[p.key] ?? p.default ?? (i === 0 ? 10 : 30);
    return i === 0
      ? { key: p.key, from: Math.max(1, Math.round(d * 0.5)), to: Math.max(2, Math.round(d * 1.5)), step: 1 }
      : { key: p.key, from: Math.max(2, Math.round(d * 0.5)), to: Math.max(3, Math.round(d * 1.5)), step: 2 };
  });
  return { sweeps, metric: 'sharpe' };
}

export function paramValues(s: SweepParam): number[] {
  const step = Math.abs(s.step) || 1;
  const from = Math.min(s.from, s.to);
  const to = Math.max(s.from, s.to);
  const n = Math.floor((to - from) / step + 1e-9) + 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round((from + i * step) * 1e6) / 1e6);
  return out;
}

/** Number of values a sweep produces, without building them. */
function valueCount(s: SweepParam): number {
  if (!Number.isFinite(s.from) || !Number.isFinite(s.to) || !Number.isFinite(s.step)) return 0;
  const step = Math.abs(s.step) || 1;
  return Math.floor((Math.abs(s.to - s.from)) / step + 1e-9) + 1;
}

/** Number of combinations in the grid (shared with the UI): the product of every sweep's value count. */
export function gridSize(opt: Pick<OptimizeConfig, 'sweeps'>): number {
  if (opt.sweeps.length === 0) return 0;
  let n = 1;
  for (const s of opt.sweeps) n *= valueCount(s);
  return n;
}

function sweptKeys(opt: OptimizeConfig): string[] {
  return opt.sweeps.map((s) => s.key);
}

function checkLimit(combos: number): void {
  if (combos > MAX_GRID_COMBOS) {
    throw new Error(`Grid has ${combos} combinations; the limit is ${MAX_GRID_COMBOS}. Narrow the ranges or raise the steps.`);
  }
}

function checkSweeps(opt: OptimizeConfig): void {
  if (opt.sweeps.length === 0) throw new Error('Add at least one parameter to sweep.');
  const seen = new Set<string>();
  for (const s of opt.sweeps) {
    if (seen.has(s.key)) throw new Error(`Parameter ${s.key} is swept more than once.`);
    seen.add(s.key);
  }
}

/** Every combination once, in odometer order (first sweep outermost, last innermost), without building the grid. */
function* gridCombos(opt: Pick<OptimizeConfig, 'sweeps'>): Generator<Record<string, number>> {
  const lists = opt.sweeps.map(paramValues);
  if (lists.length === 0 || lists.some((l) => l.length === 0)) return;
  const idx = lists.map(() => 0);
  for (;;) {
    const params: Record<string, number> = {};
    for (let i = 0; i < lists.length; i++) params[opt.sweeps[i].key] = lists[i][idx[i]];
    yield params;
    let d = lists.length - 1;
    while (d >= 0) {
      idx[d]++;
      if (idx[d] < lists[d].length) break;
      idx[d] = 0;
      d--;
    }
    if (d < 0) return;
  }
}

function toRow(params: Record<string, number>, metrics: Metrics, metric: MetricKey): OptimizeRow {
  const value = metrics[metric] as number | null;
  return { params, metrics, value: value != null && !Number.isNaN(value) ? value : null };
}

export function runOptimize(
  candles: Candle[],
  baseConfig: BacktestConfig,
  opt: OptimizeConfig,
  onProgress?: (pct: number) => void,
): OptimizeOutput {
  checkSweeps(opt);
  const combos = gridSize(opt);
  checkLimit(combos);
  const rows: OptimizeRow[] = [];
  let errored = 0;
  let done = 0;

  for (const params of gridCombos(opt)) {
    try {
      rows.push(toRow(params, runFullBacktest(candles, { ...baseConfig, params: { ...baseConfig.params, ...params } }).metrics, opt.metric));
    } catch {
      errored++;
    }
    done++;
    if (onProgress && (done % 5 === 0 || done === combos)) onProgress(done / combos);
  }
  return finish(rows, opt, combos, errored);
}

/** Async grid sweep: awaits every combination, so it also covers Pine strategies. */
export async function runOptimizeAsync(
  candles: Candle[],
  baseConfig: BacktestConfig,
  opt: OptimizeConfig,
  onProgress?: (pct: number) => void,
): Promise<OptimizeOutput> {
  checkSweeps(opt);
  const combos = gridSize(opt);
  checkLimit(combos);
  const rows: OptimizeRow[] = [];
  let errored = 0;
  let done = 0;

  for (const params of gridCombos(opt)) {
    try {
      rows.push(toRow(params, (await runAnyBacktest(candles, { ...baseConfig, params: { ...baseConfig.params, ...params } })).metrics, opt.metric));
    } catch {
      errored++;
    }
    done++;
    if (onProgress && (done % 5 === 0 || done === combos)) onProgress(done / combos);
  }
  return finish(rows, opt, combos, errored);
}

/** Higher is better for every metric; +Infinity first, null last, ties keep grid order (stable sort). */
function finish(rows: OptimizeRow[], opt: OptimizeConfig, combos: number, errored: number): OptimizeOutput {
  rows.sort((a, b) => {
    if (a.value == null || b.value == null) return a.value == null ? (b.value == null ? 0 : 1) : -1;
    if (a.value === b.value) return 0;
    return a.value > b.value ? -1 : 1;
  });
  return { rows, keys: sweptKeys(opt), metric: opt.metric, combos, errored };
}
