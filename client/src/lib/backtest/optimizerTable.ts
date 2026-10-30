import { fmtMoney, fmtNum, fmtPct } from '../format';
import type { MetricKey, OptimizeRow } from './optimizer';
import type { Metrics } from './types';

export type SortDir = 'asc' | 'desc';

/** A result row with its 1-based position in the ranking order. */
export interface RankedRow {
  row: OptimizeRow;
  rank: number;
}

/** A column id: 'rank', 'value' (the ranking metric), `p:<param key>` or a Metrics key. */
export type ColumnId = string;

export interface MetricColumn {
  id: keyof Metrics;
  label: string;
  /** Whole-number display (bars, trades). */
  format: (v: number | null) => string;
  /** Colour by sign (pnlClass). */
  pnl?: boolean;
}

const pct1 = (v: number | null): string => fmtPct(v, 1);
const num2 = (v: number | null): string => fmtNum(v, 2);
const int = (v: number | null): string => fmtNum(v, 0);

/** The measure columns after the ranking metric, in display order. */
export const METRIC_COLUMNS: MetricColumn[] = [
  { id: 'totalReturnPct', label: 'Total return', format: (v) => fmtPct(v), pnl: true },
  { id: 'cagrPct', label: 'CAGR', format: (v) => fmtPct(v), pnl: true },
  { id: 'sharpe', label: 'Sharpe', format: num2 },
  { id: 'sortino', label: 'Sortino', format: num2 },
  { id: 'calmar', label: 'Calmar', format: num2 },
  { id: 'profitFactor', label: 'Profit factor', format: (v) => (v === Number.POSITIVE_INFINITY ? '∞' : fmtNum(v, 2)) },
  { id: 'winRatePct', label: 'Win rate', format: pct1 },
  { id: 'maxDrawdownPct', label: 'Max drawdown', format: (v) => fmtPct(v) },
  { id: 'maxDrawdownBars', label: 'Max DD duration (bars)', format: int },
  { id: 'trades', label: 'Trades', format: int },
  { id: 'exposurePct', label: 'Exposure', format: pct1 },
  { id: 'expectancy', label: 'Expectancy', format: (v) => fmtMoney(v), pnl: true },
  { id: 'buyHoldPct', label: 'Buy & hold', format: (v) => fmtPct(v), pnl: true },
];

export function formatMetric(metric: MetricKey, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? '∞' : '—';
  if (metric.endsWith('Pct')) return fmtPct(value, 1);
  return fmtNum(value, 2);
}

export const paramColumnId = (key: string): ColumnId => `p:${key}`;

function cellValue(r: RankedRow, column: ColumnId): number | null | undefined {
  if (column === 'rank') return r.rank;
  if (column === 'value') return r.row.value;
  if (column.startsWith('p:')) return r.row.params[column.slice(2)];
  return r.row.metrics[column as keyof Metrics] as number | null;
}

const missing = (v: number | null | undefined): v is null | undefined => v == null || Number.isNaN(v);

/** First direction a click on a column header sorts by: ascending for Rank and parameters, descending for measures. */
export function firstDirection(column: ColumnId): SortDir {
  return column === 'rank' || column.startsWith('p:') ? 'asc' : 'desc';
}

/**
 * Sorts rows (given in ranking order) by a column. Stable: ties keep ranking order. Missing values
 * (null, NaN) are last in either direction; +Infinity sorts as the largest number.
 */
export function sortOptimizeRows(rows: OptimizeRow[], column: ColumnId, dir: SortDir): RankedRow[] {
  const ranked = rows.map((row, i) => ({ row, rank: i + 1 }));
  const sign = dir === 'asc' ? 1 : -1;
  return ranked.sort((a, b) => {
    const x = cellValue(a, column);
    const y = cellValue(b, column);
    const mx = missing(x);
    const my = missing(y);
    if (mx || my) return mx && my ? a.rank - b.rank : mx ? 1 : -1;
    if (x !== y) return (x < y ? -1 : 1) * sign;
    return a.rank - b.rank;
  });
}

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  /** 1-based first and last row shown (0 when empty). */
  from: number;
  to: number;
  total: number;
}

export const PAGE_SIZE = 100;

/** One page (0-based `page`, clamped into range) of `size` items. */
export function pageOf<T>(rows: T[], page: number, size = PAGE_SIZE): Page<T> {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  const start = p * size;
  const items = rows.slice(start, start + size);
  return { items, page: p, pages, from: total === 0 ? 0 : start + 1, to: start + items.length, total };
}
