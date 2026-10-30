import { rowsToCsv, sanitizeFileName } from '../export';
import { METRIC_LABELS, type MetricKey, type OptimizeRow, type SweepParam } from './optimizer';
import type { Metrics } from './types';
import type { RobustnessSettings, SplitSettings, ValidationOutput } from './validation';

/** The settings an optimizer run started with; stored beside its result so later edits do not change an export. */
export interface OptimizeRunContext {
  strategyId: string;
  strategyName: string;
  /** The run's params minus the swept ones. */
  params: Record<string, number>;
  symbol: string;
  timeframe: string;
  dataLabel: string;
  /** Unix seconds of the first and last bar of the sliced range (null with no bars). */
  rangeFrom: number | null;
  rangeTo: number | null;
  bars: number;
  initialCapital: number;
  positionSizePct: number;
  feeBps: number;
  slippageBps: number;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  allowShort: boolean;
  sweeps: SweepParam[];
  /** The validation the run used (absent with none). */
  validation?: SplitSettings | RobustnessSettings;
}

export interface OptimizeResultLike {
  rows: OptimizeRow[];
  keys: string[];
  metric: MetricKey;
  combos: number;
  errored: number;
  validation?: ValidationOutput;
}

/** Every Metrics field, in file order. The type forces a new Metrics field to be listed here. */
const METRIC_FIELDS: Record<keyof Metrics, true> = {
  initialCapital: true,
  finalEquity: true,
  totalReturnPct: true,
  cagrPct: true,
  sharpe: true,
  sortino: true,
  calmar: true,
  maxDrawdownPct: true,
  maxDrawdownBars: true,
  exposurePct: true,
  buyHoldPct: true,
  trades: true,
  winRatePct: true,
  profitFactor: true,
  expectancy: true,
  avgTradePct: true,
  bestTradePct: true,
  worstTradePct: true,
  avgBarsInTrade: true,
  totalFees: true,
  barsPerYear: true,
};
export const METRIC_KEYS = Object.keys(METRIC_FIELDS) as Array<keyof Metrics>;

const iso = (t: number | null): string => (t == null ? '' : new Date(t * 1000).toISOString());
const off = (v: number | null): string => (v == null ? 'off' : String(v));
/** Context lines are free text: keep each on one line. */
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ');

export function optimizeContextLines(c: OptimizeRunContext, result: OptimizeResultLike): string[] {
  const fixed = Object.entries(c.params)
    .filter(([k]) => !k.startsWith('__') && !c.sweeps.some((s) => s.key === k))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const sweeps = c.sweeps.map((s) => `${s.key} ${s.from}..${s.to} step ${s.step}`).join('; ');
  const lines = [
    `strategy: ${c.strategyName} (${c.strategyId})`,
    `fixed params: ${fixed}`,
    `symbol: ${c.symbol}`,
    `timeframe: ${c.timeframe}`,
    `data: ${c.dataLabel}`,
    `range from: ${iso(c.rangeFrom)}`,
    `range to: ${iso(c.rangeTo)}`,
    `bars: ${c.bars}`,
    `initial capital: ${c.initialCapital}`,
    `position size %: ${c.positionSizePct}`,
    `fee bps: ${c.feeBps}`,
    `slippage bps: ${c.slippageBps}`,
    `stop loss %: ${off(c.stopLossPct)}`,
    `take profit %: ${off(c.takeProfitPct)}`,
    `shorts: ${c.allowShort ? 'yes' : 'no'}`,
    `rank metric: ${result.metric} (${METRIC_LABELS[result.metric]})`,
    `sweeps: ${sweeps}`,
    `combinations: ${result.combos}`,
    `failed: ${result.errored}`,
  ];
  const v = c.validation;
  if (v?.method === 'robustness') {
    lines.push(`validation: ${v.method}`, `neighbourhood: ${v.radius}`, `rank by robustness: ${v.rankByScore ? 'yes' : 'no'}`);
  } else if (v) {
    const span = (name: string, s: SplitSettings['inSample']) => [
      `${name} from: ${iso(s.from)}`,
      `${name} to: ${iso(s.to)}`,
      `${name} bars: ${s.bars}`,
    ];
    lines.push(
      `validation: ${v.method}`,
      `in-sample %: ${v.inSamplePct}`,
      `top results checked: ${v.topN}`,
      ...span('in-sample', v.inSample),
      ...span('held-out', v.heldOut),
    );
  }
  return lines.map((l) => `# ${oneLine(l)}`);
}

function cell(v: number | null | undefined): string | number {
  if (v == null || Number.isNaN(v)) return '';
  if (v === Number.POSITIVE_INFINITY) return 'Infinity';
  if (v === Number.NEGATIVE_INFINITY) return '-Infinity';
  return v;
}

/** The whole run as CSV: `# ` context lines, then rank, swept params and every Metrics field, one row per combination in ranking order. */
export function optimizeResultToCsv(result: OptimizeResultLike, context: OptimizeRunContext): string {
  const rv = result.validation?.method === 'robustness' ? result.validation : null;
  const v = result.validation?.method === 'split' ? result.validation : null;
  const header = [
    'rank',
    ...result.keys,
    ...METRIC_KEYS,
    ...(v ? ['heldout_rank', ...METRIC_KEYS.map((k) => `heldout_${k}`)] : []),
    ...(rv ? ['neighbour_mean', 'neighbour_min', 'neighbour_count', 'robustness'] : []),
  ];
  const checks = new Map((v?.checks ?? []).map((ch) => [ch.rank, ch]));
  const rows = result.rows.map((r, i) => {
    const base = [i + 1, ...result.keys.map((k) => cell(r.params[k])), ...METRIC_KEYS.map((k) => cell(r.metrics[k]))];
    if (rv) {
      const s = rv.scores[i];
      return [...base, cell(s?.neighbourMean), cell(s?.neighbourMin), cell(s?.neighbourCount), cell(s?.robustness)];
    }
    if (!v) return base;
    const ch = checks.get(i + 1);
    return [...base, cell(ch?.heldOutRank), ...METRIC_KEYS.map((k) => cell(ch?.heldOut?.[k]))];
  });
  return [...optimizeContextLines(context, result), rowsToCsv(header, rows)].join('\n');
}

export function optimizerCsvFileName(c: Pick<OptimizeRunContext, 'symbol' | 'timeframe'>): string {
  return sanitizeFileName(`vost_optimizer_${c.symbol}_${c.timeframe}.csv`);
}
