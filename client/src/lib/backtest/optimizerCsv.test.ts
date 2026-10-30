import { describe, expect, it } from 'vitest';
import { optimizeContextLines, optimizeResultToCsv, optimizerCsvFileName, METRIC_KEYS, type OptimizeRunContext } from './optimizerCsv';
import type { OptimizeRow } from './optimizer';
import type { Metrics } from './types';

const sample: Metrics = {
  initialCapital: 10000, finalEquity: 11234.5678, totalReturnPct: 12.345678, cagrPct: null, sharpe: 1.23456789, sortino: Number.NaN,
  calmar: 0.5, maxDrawdownPct: -8.123456, maxDrawdownBars: 40, exposurePct: 55.5, buyHoldPct: 3.3, trades: 12, winRatePct: 50,
  profitFactor: Number.POSITIVE_INFINITY, expectancy: 12.5, avgTradePct: Number.NEGATIVE_INFINITY, bestTradePct: 9, worstTradePct: -4,
  avgBarsInTrade: 6, totalFees: 33.3, barsPerYear: 365,
};
const ctx: OptimizeRunContext = {
  strategyId: 'sma_cross', strategyName: 'SMA crossover', params: { threshold: 1.5, 'we"ird': 2, __hidden: 9 }, symbol: 'BTC/USD',
  timeframe: '1h', dataLabel: 'Coinbase, "demo"', rangeFrom: 1_700_000_000, rangeTo: 1_700_086_400, bars: 25, initialCapital: 10000,
  positionSizePct: 100, feeBps: 10, slippageBps: 2, stopLossPct: null, takeProfitPct: 5, allowShort: true,
  sweeps: [{ key: 'fast', from: 5, to: 15, step: 2 }, { key: 'slow', from: 20, to: 40, step: 5 }],
};
const rows: OptimizeRow[] = [
  { params: { fast: 5, slow: 20 }, metrics: sample, value: 1.23456789 },
  { params: { fast: 7, slow: 25 }, metrics: { ...sample, sharpe: null, trades: 0, totalReturnPct: -1.5 }, value: null },
];
const result = { rows, keys: ['fast', 'slow'], metric: 'sharpe' as const, combos: 2, errored: 1 };

/** Minimal CSV parser (quotes, doubled quotes, commas, newlines in quotes). */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { cur.push(f); f = ''; }
    else if (ch === '\n') { cur.push(f); out.push(cur); cur = []; f = ''; }
    else f += ch;
  }
  cur.push(f);
  out.push(cur);
  return out;
}

describe('optimizeResultToCsv', () => {
  const csv = optimizeResultToCsv(result, ctx);
  const lines = csv.split('\n');
  const contextLines = lines.filter((l) => l.startsWith('# '));
  const records = parseCsv(lines.slice(contextLines.length).join('\n'));

  it('starts with # context lines and then the header', () => {
    expect(lines.slice(0, contextLines.length).every((l) => l.startsWith('# '))).toBe(true);
    expect(contextLines).toEqual(optimizeContextLines(ctx, result));
    expect(records[0]).toEqual(['rank', 'fast', 'slow', ...METRIC_KEYS]);
  });

  it('lists every Metrics field', () => {
    expect(METRIC_KEYS.slice().sort()).toEqual(Object.keys(sample).sort());
  });

  it('records the run settings', () => {
    expect(contextLines).toEqual([
      '# strategy: SMA crossover (sma_cross)',
      '# fixed params: threshold=1.5; we"ird=2',
      '# symbol: BTC/USD',
      '# timeframe: 1h',
      '# data: Coinbase, "demo"',
      '# range from: 2023-11-14T22:13:20.000Z',
      '# range to: 2023-11-15T22:13:20.000Z',
      '# bars: 25',
      '# initial capital: 10000',
      '# position size %: 100',
      '# fee bps: 10',
      '# slippage bps: 2',
      '# stop loss %: off',
      '# take profit %: 5',
      '# shorts: yes',
      '# rank metric: sharpe (Sharpe)',
      '# sweeps: fast 5..15 step 2; slow 20..40 step 5',
      '# combinations: 2',
      '# failed: 1',
    ]);
  });

  it('writes one row per combination in ranking order with raw numbers', () => {
    expect(records).toHaveLength(3);
    const col = (name: string) => records[0].indexOf(name);
    expect(records[1].slice(0, 3)).toEqual(['1', '5', '20']);
    expect(records[2].slice(0, 3)).toEqual(['2', '7', '25']);
    expect(records[1][col('sharpe')]).toBe('1.23456789');
    expect(records[1][col('finalEquity')]).toBe('11234.5678');
    expect(records[1][col('profitFactor')]).toBe('Infinity');
    expect(records[1][col('avgTradePct')]).toBe('-Infinity');
    expect(records[1][col('cagrPct')]).toBe('');
    expect(records[1][col('sortino')]).toBe('');
    expect(records[2][col('sharpe')]).toBe('');
    expect(records[2][col('totalReturnPct')]).toBe('-1.5');
    expect(records.every((r) => r.length === records[0].length)).toBe(true);
  });

  it('round-trips every value', () => {
    for (const [i, r] of rows.entries()) {
      const rec = records[i + 1];
      METRIC_KEYS.forEach((k) => {
        const v = r.metrics[k] as number | null;
        const got = rec[records[0].indexOf(k)];
        if (v == null || Number.isNaN(v)) expect(got).toBe('');
        else expect(Number(got)).toBe(v);
      });
    }
  });

  it('sanitises the file name', () => {
    expect(optimizerCsvFileName(ctx)).toBe('vost_optimizer_BTC_USD_1h.csv');
  });
});
