import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import {
  MAX_GRID_COMBOS,
  defaultOptimizeConfig,
  paramValues,
  runOptimize,
  runOptimizeAsync,
  type MetricKey,
  type OptimizeConfig,
  type OptimizeOutput,
} from './optimizer';
import { runFullBacktest } from './runner';
import { defaultBacktestConfig, type BacktestConfig } from './types';

function series(close: (i: number) => number, n = 300): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = close(i);
    return { time: 1_600_000_000 + i * 86400, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 };
  });
}

const wavy = series((i) => 100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + i * 0.05);
const base = (patch: Partial<BacktestConfig> = {}): BacktestConfig => ({ ...defaultBacktestConfig(), ...patch });
const METRICS: MetricKey[] = ['totalReturnPct', 'cagrPct', 'sharpe', 'sortino', 'profitFactor', 'maxDrawdownPct', 'calmar', 'winRatePct'];

function expectRowsMatchSingleBacktests(candles: Candle[], config: BacktestConfig, out: OptimizeOutput) {
  expect(out.rows.length).toBeGreaterThan(0);
  for (const row of out.rows) {
    expect(Object.keys(row.params).sort()).toEqual([...out.keys].sort());
    const single = runFullBacktest(candles, { ...config, params: { ...config.params, ...row.params } });
    expect(row.metrics).toEqual(single.metrics);
  }
}

describe('paramValues', () => {
  it('1..100 step 1 gives 100 values', () => {
    const v = paramValues({ key: 'x', from: 1, to: 100, step: 1 });
    expect(v).toHaveLength(100);
    expect(v[99]).toBe(100);
  });
  it('0.1..1.0 step 0.1 gives exactly 10 values ending at 1', () => {
    const v = paramValues({ key: 'x', from: 0.1, to: 1.0, step: 0.1 });
    expect(v).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });
});

describe('optimizer rows equal single backtests', () => {
  it('1D sweep of slow on SMA crossover has only the swept key', () => {
    const config = base();
    const opt: OptimizeConfig = { sweepA: { key: 'slow', from: 20, to: 40, step: 5 }, sweepB: null, metric: 'totalReturnPct' };
    const out = runOptimize(wavy, config, opt);
    expect(out.keys).toEqual(['slow']);
    expect(out.rows).toHaveLength(5);
    for (const r of out.rows) expect(Object.keys(r.params)).toEqual(['slow']);
    expectRowsMatchSingleBacktests(wavy, config, out);
  });

  it('2D sweep on SMA crossover', () => {
    const config = base();
    const opt: OptimizeConfig = {
      sweepA: { key: 'fast', from: 5, to: 15, step: 5 },
      sweepB: { key: 'slow', from: 20, to: 40, step: 10 },
      metric: 'sharpe',
    };
    const out = runOptimize(wavy, config, opt);
    expect(out.keys).toEqual(['fast', 'slow']);
    expect(out.rows).toHaveLength(9);
    expectRowsMatchSingleBacktests(wavy, config, out);
  });

  it('2D sweep on another built-in (EMA crossover), async', async () => {
    const config = base({ strategyId: 'ema_cross', params: { fast: 12, slow: 26, direction: 1 } });
    const opt: OptimizeConfig = {
      sweepA: { key: 'fast', from: 6, to: 12, step: 3 },
      sweepB: { key: 'slow', from: 20, to: 30, step: 5 },
      metric: 'calmar',
    };
    const out = await runOptimizeAsync(wavy, config, opt);
    expect(out.rows).toHaveLength(9);
    expectRowsMatchSingleBacktests(wavy, config, out);
  });
});

describe('ranking', () => {
  const opt = (metric: MetricKey): OptimizeConfig => ({
    sweepA: { key: 'fast', from: 3, to: 20, step: 1 },
    sweepB: { key: 'slow', from: 25, to: 45, step: 5 },
    metric,
  });

  for (const metric of METRICS) {
    it(`sorts by ${metric}, best first, null last`, () => {
      const out = runOptimize(wavy, base(), opt(metric));
      const vals = out.rows.map((r) => r.value);
      let seenNull = false;
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] == null) seenNull = true;
        else {
          expect(seenNull).toBe(false);
          if (i > 0 && vals[i - 1] != null) expect(vals[i - 1]! >= vals[i]!).toBe(true);
        }
      }
    });
  }

  it('puts +Infinity profit factor first and keeps grid order for ties', () => {
    // Falls then rises: every crossover happens in the rise and closes at the end with a profit, no losers.
    const candles = series((i) => (i < 40 ? 200 - i : 160 + (i - 40) * 2), 200);
    const config = base({ feeBps: 0, slippageBps: 0 });
    const out = runOptimize(candles, config, {
      sweepA: { key: 'fast', from: 3, to: 6, step: 1 },
      sweepB: { key: 'slow', from: 20, to: 30, step: 5 },
      metric: 'profitFactor',
    });
    const inf = out.rows.filter((r) => r.value === Number.POSITIVE_INFINITY);
    expect(inf.length).toBeGreaterThan(1);
    expect(out.rows.slice(0, inf.length)).toEqual(inf);
    const order = (r: { params: Record<string, number> }) => r.params.fast * 1000 + r.params.slow;
    const sorted = [...inf].sort((a, b) => order(a) - order(b));
    expect(inf.map(order)).toEqual(sorted.map(order));
  });
});

describe('grid limit', () => {
  const huge: OptimizeConfig = {
    sweepA: { key: 'fast', from: 1, to: 400, step: 1 },
    sweepB: { key: 'slow', from: 1, to: 400, step: 1 },
    metric: 'sharpe',
  };
  it('exports a 100,000 limit', () => expect(MAX_GRID_COMBOS).toBe(100_000));
  it('runOptimize throws above the limit', () => {
    expect(() => runOptimize(wavy, base(), huge)).toThrow(/limit/);
  });
  it('runOptimizeAsync rejects above the limit', async () => {
    await expect(runOptimizeAsync(wavy, base(), huge)).rejects.toThrow(/limit/);
  });
  it('default config has no maxCombos', () => {
    expect('maxCombos' in defaultOptimizeConfig(base())).toBe(false);
  });
});
