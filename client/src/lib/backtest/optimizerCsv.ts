import { rowsToCsv, sanitizeFileName } from '../export';
import { METRIC_LABELS, type MetricKey, type OptimizeRow, type SweepParam } from './optimizer';
import type { MonteCarloValidationSettings } from './optimizerMonteCarlo';
import type { Metrics } from './types';
import type { RobustnessSettings, Span, SplitSettings, ValidationOutput } from './validation';
import type { WalkForwardOutput, WalkForwardSettings } from './walkForward';

/** The settings an optimizer run started with; stored beside its result so later edits do not change an export. */
export interface OptimizeRunContext {
  strategyId: string;
  strategyName: string;
  /** The run's params minus the swept ones. */
  params: Record<string, number>;
  /** The Pine strategy's text inputs (color, source, symbol, session, timeframe, text), which no sweep changes. */
  pineInputs?: Record<string, string>;
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
  validation?: SplitSettings | RobustnessSettings | MonteCarloValidationSettings;
  /** The walk-forward the run used (absent otherwise). */
  walkForward?: WalkForwardSettings;
}

export interface OptimizeResultLike {
  rows: OptimizeRow[];
  keys: string[];
  metric: MetricKey;
  combos: number;
  errored: number;
  validation?: ValidationOutput;
  walkForward?: WalkForwardOutput;
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
    .concat(Object.entries(c.pineInputs ?? {}).map(([k, v]) => `${k}=${oneLine(v)}`))
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
  } else if (v?.method === 'monte-carlo') {
    lines.push(
      `validation: ${v.method}`,
      `top results checked: ${v.topN}`,
      `runs: ${v.iterations}`,
      `method: ${v.mcMethod} (${v.mcMethod === 'shuffle' ? 'shuffle trade order' : 'resample trades'})`,
      `seed: ${v.seed}`,
      'max drawdown is measured trade to trade',
    );
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
  const w = result.walkForward;
  if (c.walkForward) {
    lines.push(
      'validation: walk-forward',
      `windows: ${c.walkForward.windows}`,
      `in-sample %: ${c.walkForward.inSamplePct}`,
      `mode: ${c.walkForward.anchored ? 'anchored' : 'rolling'}`,
    );
    const spanLines = (name: string, s: Span) => [`${name} from: ${iso(s.from)}`, `${name} to: ${iso(s.to)}`, `${name} bars: ${s.bars}`];
    const num = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '' : String(v));
    c.walkForward.spans.forEach((s, i) => {
      const n = i + 1;
      const r = w?.results[i];
      lines.push(...spanLines(`window ${n} in-sample`, s.inSample), ...spanLines(`window ${n} held-out`, s.heldOut));
      if (!r) return;
      lines.push(`window ${n} params: ${r.params ? Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join('; ') : ''}`);
      lines.push(`window ${n} in-sample ${result.metric}: ${num(r.inSampleValue)}`);
      if (r.status === 'ok' && r.heldOutMetrics) {
        lines.push(
          `window ${n} held-out return %: ${num(r.heldOutMetrics.totalReturnPct)}`,
          `window ${n} held-out max drawdown %: ${num(r.heldOutMetrics.maxDrawdownPct)}`,
          `window ${n} held-out trades: ${num(r.heldOutMetrics.trades)}`,
        );
      } else {
        lines.push(`window ${n} held-out: ${r.status === 'failed' ? 'failed' : 'no winner'}`);
      }
    });
    if (w?.combined) {
      lines.push(
        `combined held-out return %: ${num(w.combined.totalReturnPct)}`,
        `combined held-out max drawdown %: ${num(w.combined.maxDrawdownPct)}`,
        `combined held-out trades: ${num(w.combined.trades)}`,
        `walk-forward efficiency: ${num(w.combined.efficiency) || 'n/a'}`,
      );
    } else if (w) {
      lines.push(`combined held-out: incomplete (${w.results.length - w.incomplete} of ${w.windows} windows have a held-out result)`);
    }
  }
  return lines.map((l) => `# ${oneLine(l)}`);
}

function cell(v: number | null | undefined): string | number {
  if (v == null || Number.isNaN(v)) return '';
  if (v === Number.POSITIVE_INFINITY) return 'Infinity';
  if (v === Number.NEGATIVE_INFINITY) return '-Infinity';
  return v;
}

const MC_CSV_COLUMNS = [
  'mc_status',
  'mc_trades',
  'mc_return_p5',
  'mc_return_p50',
  'mc_return_p95',
  'mc_drawdown_p5',
  'mc_drawdown_p50',
  'mc_drawdown_p95',
  'mc_prob_loss_pct',
];

/** The whole run as CSV: `# ` context lines, then rank, swept params and every Metrics field, one row per combination in ranking order. */
export function optimizeResultToCsv(result: OptimizeResultLike, context: OptimizeRunContext): string {
  const rv = result.validation?.method === 'robustness' ? result.validation : null;
  const v = result.validation?.method === 'split' ? result.validation : null;
  const mc = result.validation?.method === 'monte-carlo' ? result.validation : null;
  const header = [
    'rank',
    ...result.keys,
    ...METRIC_KEYS,
    ...(v ? ['heldout_rank', ...METRIC_KEYS.map((k) => `heldout_${k}`)] : []),
    ...(mc ? MC_CSV_COLUMNS : []),
    ...(rv ? ['neighbour_mean', 'neighbour_min', 'neighbour_count', 'robustness'] : []),
  ];
  const checks = new Map((v?.checks ?? []).map((ch) => [ch.rank, ch]));
  const mcChecks = new Map((mc?.checks ?? []).map((ch) => [ch.rank, ch]));
  const rows = result.rows.map((r, i) => {
    const base = [i + 1, ...result.keys.map((k) => cell(r.params[k])), ...METRIC_KEYS.map((k) => cell(r.metrics[k]))];
    if (rv) {
      const s = rv.scores[i];
      return [...base, cell(s?.neighbourMean), cell(s?.neighbourMin), cell(s?.neighbourCount), cell(s?.robustness)];
    }
    if (mc) {
      const ch = mcChecks.get(i + 1);
      const m = ch?.result;
      return [
        ...base,
        ch?.status ?? '',
        cell(ch?.trades),
        cell(m?.finalReturn.p5),
        cell(m?.finalReturn.p50),
        cell(m?.finalReturn.p95),
        cell(m?.maxDrawdown.p5),
        cell(m?.maxDrawdown.p50),
        cell(m?.maxDrawdown.p95),
        cell(m?.probLossPct),
      ];
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
