import { describe, expect, it } from 'vitest';
import type { OptimizeRow } from './optimizer';
import { firstDirection, METRIC_COLUMNS, pageOf, paramColumnId, sortOptimizeRows } from './optimizerTable';
import type { Metrics } from './types';

function metrics(over: Partial<Metrics> = {}): Metrics {
  return {
    initialCapital: 10000, finalEquity: 10000, totalReturnPct: 0, cagrPct: 0, sharpe: 0, sortino: 0, calmar: 0,
    maxDrawdownPct: 0, maxDrawdownBars: 0, exposurePct: 0, buyHoldPct: 0, trades: 0, winRatePct: 0, profitFactor: 0,
    expectancy: 0, avgTradePct: 0, bestTradePct: 0, worstTradePct: 0, avgBarsInTrade: 0, totalFees: 0, barsPerYear: 365,
    ...over,
  };
}
const row = (fast: number, over: Partial<Metrics> = {}, value: number | null = null): OptimizeRow => ({ params: { fast }, metrics: metrics(over), value });
const ranks = (rows: OptimizeRow[], col: string, dir: 'asc' | 'desc') => sortOptimizeRows(rows, col, dir).map((r) => r.rank);

describe('sortOptimizeRows', () => {
  // ranking order: ranks 1..5
  const rows = [row(5, { sharpe: 1, trades: 3 }, 1), row(2, { sharpe: 3, trades: 3 }, 3), row(9, { sharpe: null, trades: 1 }, null), row(4, { sharpe: Number.POSITIVE_INFINITY, trades: 7 }, Infinity), row(7, { sharpe: Number.NaN, trades: 2 }, 0)];

  it('sorts every column in both directions with missing values last and ties in ranking order', () => {
    const cols = ['rank', 'value', paramColumnId('fast'), ...METRIC_COLUMNS.map((c) => c.id)];
    for (const col of cols) {
      for (const dir of ['asc', 'desc'] as const) {
        const out = sortOptimizeRows(rows, col, dir);
        expect(out).toHaveLength(rows.length);
        const vals = out.map((r) => (col === 'rank' ? r.rank : col === 'value' ? r.row.value : col.startsWith('p:') ? r.row.params[col.slice(2)] : (r.row.metrics as unknown as Record<string, number | null>)[col]));
        const present = vals.filter((v) => v != null && !Number.isNaN(v)) as number[];
        const sortedPresent = [...present].sort((a, b) => (dir === 'asc' ? a - b : b - a));
        expect(vals.slice(0, present.length)).toEqual(sortedPresent);
        expect(vals.slice(present.length).every((v) => v == null || Number.isNaN(v))).toBe(true);
        for (let i = 1; i < out.length; i++) if (vals[i] === vals[i - 1]) expect(out[i].rank).toBeGreaterThan(out[i - 1].rank);
      }
    }
  });

  it('puts +Infinity first when descending and nulls/NaN last both ways', () => {
    expect(ranks(rows, 'sharpe', 'desc')).toEqual([4, 2, 1, 3, 5]);
    expect(ranks(rows, 'sharpe', 'asc')).toEqual([1, 2, 4, 3, 5]);
  });

  it('keeps ranking order on ties', () => {
    expect(ranks(rows, 'trades', 'desc')).toEqual([4, 1, 2, 5, 3]);
  });

  it('Rank ascending restores the default order and keeps the ranking position', () => {
    const out = sortOptimizeRows(rows, 'trades', 'desc');
    expect(out.map((r) => r.row)).not.toEqual(rows);
    expect(sortOptimizeRows(rows, 'rank', 'asc').map((r) => r.row)).toEqual(rows);
    expect(ranks(rows, 'rank', 'desc')).toEqual([5, 4, 3, 2, 1]);
  });

  it('starts descending for measures and ascending for rank and parameters', () => {
    expect(firstDirection('rank')).toBe('asc');
    expect(firstDirection(paramColumnId('fast'))).toBe('asc');
    expect(firstDirection('sharpe')).toBe('desc');
  });
});

describe('pageOf', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  it('returns the first, a middle and the last partial page', () => {
    expect(pageOf(items, 0, 100)).toMatchObject({ from: 1, to: 100, total: 250, pages: 3, page: 0 });
    expect(pageOf(items, 1, 100).items[0]).toBe(100);
    const last = pageOf(items, 2, 100);
    expect(last).toMatchObject({ from: 201, to: 250, page: 2 });
    expect(last.items).toHaveLength(50);
  });
  it('clamps out-of-range pages and handles empty input', () => {
    expect(pageOf(items, 99, 100).page).toBe(2);
    expect(pageOf(items, -3, 100).page).toBe(0);
    expect(pageOf([], 0, 100)).toMatchObject({ items: [], from: 0, to: 0, total: 0, pages: 1, page: 0 });
  });
});
