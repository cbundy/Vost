import { rowsToCsv, sanitizeFileName } from '../export';
import type { MonteCarloResult } from './monteCarlo';

/** The settings of the backtest a Monte Carlo result came from. */
export interface MonteCarloContext {
  strategyId: string;
  strategyName: string;
  /** The run's params. */
  params: Record<string, number>;
}

const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ');
const METHOD_LABEL = { shuffle: 'shuffle trade order', bootstrap: 'resample trades' } as const;

export function monteCarloContextLines(c: MonteCarloContext, r: MonteCarloResult): string[] {
  const params = Object.entries(c.params)
    .filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return [
    `strategy: ${c.strategyName} (${c.strategyId})`,
    `params: ${params}`,
    `method: ${r.method} (${METHOD_LABEL[r.method]})`,
    `runs: ${r.iterations}`,
    `seed: ${r.seed}`,
    `trades: ${r.trades}`,
    `initial capital: ${r.initialCapital}`,
    'max drawdown is measured trade to trade',
  ].map((l) => `# ${oneLine(l)}`);
}

/** The result as CSV: `# ` context lines, then a statistic,value table. */
export function monteCarloCsv(r: MonteCarloResult, context: MonteCarloContext): string {
  const rows: Array<[string, string | number]> = [];
  for (const p of ['p5', 'p25', 'p50', 'p75', 'p95'] as const) rows.push([`final_return_pct_${p}`, r.finalReturn[p]]);
  for (const p of ['p5', 'p25', 'p50', 'p75', 'p95'] as const) rows.push([`max_drawdown_pct_${p}`, r.maxDrawdown[p]]);
  rows.push(['probability_of_loss_pct', r.probLossPct]);
  rows.push(['original_final_return_pct', r.original.finalReturnPct]);
  rows.push(['original_final_return_percentile', r.original.finalReturnRankPct]);
  rows.push(['original_max_drawdown_pct', r.original.maxDrawdownPct]);
  rows.push(['original_max_drawdown_percentile', r.original.maxDrawdownRankPct]);
  return [...monteCarloContextLines(context, r), rowsToCsv(['statistic', 'value'], rows)].join('\n');
}

export function monteCarloCsvFileName(dataLabel: string): string {
  return `vost_montecarlo_${sanitizeFileName(dataLabel || 'run')}.csv`;
}
