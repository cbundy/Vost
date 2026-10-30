import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { runOptimizeAsync, type OptimizeConfig } from './optimizer';
import { runFullBacktest } from './runner';
import { defaultBacktestConfig, type BacktestConfig } from './types';
import { runValidatedOptimize, spanOf, splitBars, validationProblem } from './validation';

function series(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + i * 0.05;
    return { time: 1_600_000_000 + i * 86400, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 };
  });
}
const candles = series(300);
const base: BacktestConfig = { ...defaultBacktestConfig() };
const opt = (validation: OptimizeConfig['validation'], patch: Partial<OptimizeConfig> = {}): OptimizeConfig => ({
  sweeps: [{ key: 'fast', from: 5, to: 9, step: 1 }, { key: 'slow', from: 20, to: 40, step: 5 }],
  metric: 'totalReturnPct',
  validation,
  ...patch,
});

describe('splitBars', () => {
  const cases: Array<[number, number, number]> = [
    [10, 50, 5], [10, 70, 7], [10, 95, 9],
    [11, 50, 5], [11, 70, 7], [11, 95, 10],
    [100, 50, 50], [100, 70, 70], [100, 95, 95],
  ];
  it.each(cases)('n=%i at %i%% cuts after %i bars', (n, pct, cut) => {
    const c = series(n);
    const s = splitBars(c, pct);
    expect(s.inSample).toHaveLength(cut);
    expect(s.heldOut).toHaveLength(n - cut);
    expect(s.inSample[0].time).toBe(c[0].time);
    expect(s.inSample[cut - 1].time).toBe(c[cut - 1].time);
    expect(s.heldOut[0].time).toBe(c[cut].time);
    expect(s.heldOut[n - cut - 1].time).toBe(c[n - 1].time);
    expect(spanOf(s.heldOut)).toEqual({ from: c[cut].time, to: c[n - 1].time, bars: n - cut });
  });
});

describe('validationProblem', () => {
  const ok = { method: 'split', inSamplePct: 70, topN: 10 } as const;
  it('accepts none, absent and a good split', () => {
    expect(validationProblem(undefined, 1)).toBeNull();
    expect(validationProblem({ method: 'none' }, 1)).toBeNull();
    expect(validationProblem(ok, 100)).toBeNull();
  });
  it('refuses a part with too few bars, naming it', () => {
    expect(validationProblem({ ...ok, inSamplePct: 50 }, 5)).toBe('In-sample part has 2 bars; it needs at least 3');
    expect(validationProblem({ ...ok, inSamplePct: 95 }, 40)).toBe('Held-out part has 2 bars; it needs at least 3');
  });
  it('refuses out-of-range and fractional settings', () => {
    for (const pct of [49, 96, 99, 70.5, NaN]) expect(validationProblem({ ...ok, inSamplePct: pct }, 300)).toMatch(/In-sample %/);
    for (const n of [0, 51, 2.5, NaN]) expect(validationProblem({ ...ok, topN: n }, 300)).toMatch(/Top results/);
  });
});

describe('runValidatedOptimize', () => {
  it('none and absent return exactly runOptimizeAsync on the whole range', async () => {
    const expected = await runOptimizeAsync(candles, base, opt(undefined));
    const none = await runValidatedOptimize(candles, base, opt({ method: 'none' }));
    const absent = await runValidatedOptimize(candles, base, opt(undefined));
    expect(none).toStrictEqual(expected);
    expect(absent).toStrictEqual(expected);
    expect(none.validation).toBeUndefined();
  });

  it('throws on an invalid split', async () => {
    await expect(runValidatedOptimize(series(5), base, opt({ method: 'split', inSamplePct: 50, topN: 3 }))).rejects.toThrow(/In-sample part has 2 bars/);
  });

  it('searches the in-sample bars only and checks each top row on the held-out bars alone', async () => {
    const o = opt({ method: 'split', inSamplePct: 70, topN: 4 });
    const out = await runValidatedOptimize(candles, base, o);
    const { inSample, heldOut } = splitBars(candles, 70);
    const grid = await runOptimizeAsync(inSample, base, o);
    expect(out.rows).toEqual(grid.rows);
    expect(out.combos).toBe(grid.combos);
    const v = out.validation!;
    expect(v.inSample).toEqual(spanOf(inSample));
    expect(v.heldOut).toEqual(spanOf(heldOut));
    expect(v.checks).toHaveLength(4);
    v.checks.forEach((ch, i) => {
      expect(ch.rank).toBe(i + 1);
      expect(ch.params).toEqual(grid.rows[i].params);
      expect(ch.inSample).toEqual(grid.rows[i].metrics);
      const single = runFullBacktest(heldOut, { ...base, params: { ...base.params, ...ch.params } }).metrics;
      expect(ch.heldOut).toEqual(single);
      expect(ch.heldOutValue).toBe(single.totalReturnPct);
    });
    const ranks = v.checks.map((c) => c.heldOutRank);
    expect([...ranks].sort()).toEqual([1, 2, 3, 4]);
    const byRank = [...v.checks].sort((a, b) => a.heldOutRank! - b.heldOutRank!);
    for (let i = 1; i < byRank.length; i++) expect(byRank[i - 1].heldOutValue!).toBeGreaterThanOrEqual(byRank[i].heldOutValue!);
  });

  it('checks nothing when no row has a ranking value, and caps at the non-null count', async () => {
    const flat = candles.map((c) => ({ ...c, open: 100, high: 100, low: 100, close: 100 }));
    const o = opt({ method: 'split', inSamplePct: 70, topN: 50 }, { metric: 'sharpe', sweeps: [{ key: 'fast', from: 5, to: 6, step: 1 }] });
    const out = await runValidatedOptimize(flat, base, o);
    expect(out.rows.every((r) => r.value == null)).toBe(true);
    expect(out.validation!.checks).toEqual([]);
    const big = await runValidatedOptimize(candles, base, opt({ method: 'split', inSamplePct: 70, topN: 50 }));
    expect(big.validation!.checks).toHaveLength(big.rows.filter((r) => r.value != null).length);
  });

  it('ranks held-out values with ties in check order and null values unranked', async () => {
    // a sweep of a parameter the strategy ignores gives identical held-out values: all tie
    const o = opt({ method: 'split', inSamplePct: 70, topN: 3 }, { sweeps: [{ key: 'unused_param', from: 1, to: 3, step: 1 }] });
    const out = await runValidatedOptimize(candles, base, o);
    expect(out.validation!.checks.map((c) => c.heldOutRank)).toEqual([1, 2, 3]);
  });

  it('reports monotonic progress ending at 1, with the grid taking combos / (combos + checks)', async () => {
    const o = opt({ method: 'split', inSamplePct: 70, topN: 5 });
    const seen: number[] = [];
    const out = await runValidatedOptimize(candles, base, o, (p) => seen.push(p));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[seen.length - 1]).toBe(1);
    const share = out.combos / (out.combos + out.validation!.checks.length);
    expect(seen.some((p) => Math.abs(p - share) < 1e-12)).toBe(true);
    expect(seen.filter((p) => p < share - 1e-12).length).toBeGreaterThan(0);
  });
});
