import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../types';
import { defaultBacktestConfig } from './types';

// Counts every backtest (both entry points), running the real one; the re-run can be told to throw or to lose trades.
const hook = vi.hoisted(() => ({ n: 0, lengths: new Set<number>(), throwFast: -1, oneTradeFast: -1, seenFast: new Set<number>() }));
vi.mock('./runner', async (orig) => {
  const real = await orig<typeof import('./runner')>();
  return {
    ...real,
    runFullBacktest: (c: Candle[], cfg: Parameters<typeof real.runFullBacktest>[1]) => {
      hook.n++;
      hook.lengths.add(c.length);
      return real.runFullBacktest(c, cfg);
    },
    runAnyBacktest: async (c: Candle[], cfg: Parameters<typeof real.runAnyBacktest>[1], p?: Parameters<typeof real.runAnyBacktest>[2]) => {
      hook.n++;
      hook.lengths.add(c.length);
      // The grid runs each param set first (through this same entry), so only the second run of a set is the re-run.
      const rerun = hook.seenFast.has(cfg.params.fast);
      hook.seenFast.add(cfg.params.fast);
      if (rerun && cfg.params.fast === hook.throwFast) throw new Error('re-run boom');
      const res = await real.runAnyBacktest(c, cfg, p);
      if (rerun && cfg.params.fast === hook.oneTradeFast) return { ...res, trades: res.trades.slice(0, 1) };
      return res;
    },
  };
});

import { runFullBacktest } from './runner';
import { MC_MIN_TRADES, runMonteCarlo } from './monteCarlo';
import { gridSize } from './optimizer';
import { sortMcChecks, type McCheck } from './optimizerMonteCarlo';
import { totalBacktests, runValidatedOptimize, type ValidationConfig } from './validation';

const candles: Candle[] = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + i * 0.05;
  return { time: 1_600_000_000 + i * 86400, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 };
});
const mc = { method: 'monte-carlo', topN: 4, iterations: 200, mcMethod: 'shuffle', seed: 7 } as const;
const o = (validation: ValidationConfig, metric: 'totalReturnPct' | 'sharpe' = 'totalReturnPct') => ({
  sweeps: [{ key: 'fast', from: 5, to: 9, step: 1 }, { key: 'slow', from: 20, to: 40, step: 5 }],
  metric,
  validation,
});

describe('runValidatedOptimize with Monte Carlo', () => {
  it('runs the grid on the whole range then one re-run per checked row, equal to the backtester Monte Carlo', async () => {
    for (const mcMethod of ['shuffle', 'bootstrap'] as const) {
      hook.n = 0;
      hook.lengths.clear();
      const opt = o({ ...mc, mcMethod });
      const seen: number[] = [];
      const out = await runValidatedOptimize(candles, defaultBacktestConfig(), opt, (p) => seen.push(p));
      const v = out.validation as import('./optimizerMonteCarlo').MonteCarloValidationOutput;
      expect(v).toMatchObject({ method: 'monte-carlo', topN: 4, iterations: 200, mcMethod, seed: 7, failed: 0 });
      expect(v.checks).toHaveLength(4);
      expect(hook.n).toBe(gridSize(opt) + v.checks.length);
      expect([...hook.lengths]).toEqual([300]);
      for (const ch of v.checks) {
        const cfg = { ...defaultBacktestConfig(), params: { ...defaultBacktestConfig().params, ...ch.params } };
        const run = runFullBacktest(candles, cfg);
        expect(ch.status).toBe('ok');
        expect(ch.trades).toBe(run.trades.length);
        expect(ch.result).toEqual(runMonteCarlo({ trades: run.trades, initialCapital: run.metrics.initialCapital }, { iterations: 200, method: mcMethod, seed: 7 }));
      }
      expect(v.checks.map((c) => c.rank)).toEqual([1, 2, 3, 4]);
      for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
      expect(seen[seen.length - 1]).toBe(1);
    }
  });

  it('checks every row with a value when topN is above the row count, and skips null-value rows', async () => {
    const opt = { sweeps: [{ key: 'fast', from: 5, to: 7, step: 1 }], metric: 'sharpe' as const, validation: { ...mc, topN: 50 } };
    const out = await runValidatedOptimize(candles, defaultBacktestConfig(), opt);
    const v = out.validation as import('./optimizerMonteCarlo').MonteCarloValidationOutput;
    expect(v.checks).toHaveLength(out.rows.filter((r) => r.value != null).length);
    expect(v.checks.length).toBeLessThanOrEqual(3);
  });

  it('marks a throwing re-run failed and counts it', async () => {
    hook.throwFast = 6;
    hook.seenFast.clear();
    try {
      const out = await runValidatedOptimize(candles, defaultBacktestConfig(), { ...o({ ...mc, topN: 50 }), sweeps: [{ key: 'fast', from: 5, to: 8, step: 1 }] });
      const v = out.validation as import('./optimizerMonteCarlo').MonteCarloValidationOutput;
      expect(v.failed).toBe(1);
      const bad = v.checks.find((c) => c.params.fast === 6)!;
      expect(bad).toMatchObject({ status: 'failed', result: null, trades: null });
      expect(v.checks).toHaveLength(4);
    } finally {
      hook.throwFast = -1;
    }
  });

  it('gives too-few-trades with no result for under MC_MIN_TRADES trades', async () => {
    hook.oneTradeFast = 6;
    hook.seenFast.clear();
    try {
      const out = await runValidatedOptimize(candles, defaultBacktestConfig(), { ...o({ ...mc, topN: 50 }), sweeps: [{ key: 'fast', from: 5, to: 8, step: 1 }] });
      const v = out.validation as import('./optimizerMonteCarlo').MonteCarloValidationOutput;
      const few = v.checks.find((c) => c.params.fast === 6)!;
      expect(few).toMatchObject({ status: 'too-few-trades', result: null, trades: 1 });
      expect(1).toBeLessThan(MC_MIN_TRADES);
      expect(v.failed).toBe(0);
      expect(v.checks.filter((c) => c.status === 'ok').length).toBe(3);
    } finally {
      hook.oneTradeFast = -1;
    }
  });

  it('refuses each bad setting before any backtest, with the exact message', async () => {
    const topN = /Top results to check must be a whole number from 1 to 50\./;
    const runs = /Runs must be a whole number from 100 to 10,000\./;
    const seed = /Seed must be a whole number\./;
    const cases: Array<[Partial<{ topN: number; iterations: number; seed: number }>, RegExp]> = [
      [{ topN: 0 }, topN],
      [{ topN: 51 }, topN],
      [{ topN: Number.NaN }, topN],
      [{ iterations: 99 }, runs],
      [{ iterations: 10001 }, runs],
      [{ iterations: 1.5 }, runs],
      [{ iterations: Number.NaN }, runs],
      [{ seed: 1.5 }, seed],
      [{ seed: Number.NaN }, seed],
    ];
    for (const [bad, re] of cases) {
      hook.n = 0;
      await expect(runValidatedOptimize(candles, defaultBacktestConfig(), o({ ...mc, ...bad }))).rejects.toThrow(re);
      expect(hook.n).toBe(0);
    }
    await expect(runValidatedOptimize(candles, defaultBacktestConfig(), o({ ...mc, mcMethod: 'nope' as never }))).rejects.toThrow(/Method/);
  });

  it('counts combos plus the checked rows in totalBacktests', () => {
    expect(totalBacktests(o({ ...mc, topN: 4 }))).toBe(gridSize(o(mc)) + 4);
    expect(totalBacktests(o({ ...mc, topN: 50 }))).toBe(gridSize(o(mc)) * 2);
  });
});

describe('sortMcChecks', () => {
  const res = (r: number, d: number, l: number) =>
    ({ finalReturn: { p5: r - 1, p50: r, p95: r + 1 }, maxDrawdown: { p5: d - 1, p50: d, p95: d + 1 }, probLossPct: l }) as never;
  const checks: McCheck[] = [
    { rank: 1, params: {}, value: 3, trades: 5, status: 'ok', result: res(10, 5, 30) },
    { rank: 2, params: {}, value: 2, trades: 1, status: 'too-few-trades', result: null },
    { rank: 3, params: {}, value: 1, trades: 9, status: 'ok', result: res(20, 2, 10) },
    { rank: 4, params: {}, value: null, trades: null, status: 'failed', result: null },
  ];
  const ranks = (c: Parameters<typeof sortMcChecks>[1], d: 'asc' | 'desc') => sortMcChecks(checks, c, d).map((x) => x.rank);
  it('sorts every column both ways with figureless rows last', () => {
    expect(ranks('rank', 'asc')).toEqual([1, 2, 3, 4]);
    expect(ranks('rank', 'desc')).toEqual([4, 3, 2, 1]);
    expect(ranks('value', 'asc')).toEqual([3, 2, 1, 4]);
    expect(ranks('value', 'desc')).toEqual([1, 2, 3, 4]);
    expect(ranks('trades', 'asc')).toEqual([2, 1, 3, 4]);
    expect(ranks('trades', 'desc')).toEqual([3, 1, 2, 4]);
    for (const col of ['returnP5', 'returnP50', 'returnP95'] as const) {
      expect(ranks(col, 'asc')).toEqual([1, 3, 2, 4]);
      expect(ranks(col, 'desc')).toEqual([3, 1, 2, 4]);
    }
    for (const col of ['drawdownP5', 'drawdownP50', 'drawdownP95'] as const) {
      expect(ranks(col, 'asc')).toEqual([3, 1, 2, 4]);
      expect(ranks(col, 'desc')).toEqual([1, 3, 2, 4]);
    }
    expect(ranks('probLoss', 'asc')).toEqual([3, 1, 2, 4]);
    expect(ranks('probLoss', 'desc')).toEqual([1, 3, 2, 4]);
  });
});
