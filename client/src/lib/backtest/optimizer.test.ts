import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import {
  MAX_GRID_COMBOS,
  gridSize,
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
    const opt: OptimizeConfig = { sweeps: [{ key: 'slow', from: 20, to: 40, step: 5 }], metric: 'totalReturnPct' };
    const out = runOptimize(wavy, config, opt);
    expect(out.keys).toEqual(['slow']);
    expect(out.rows).toHaveLength(5);
    for (const r of out.rows) expect(Object.keys(r.params)).toEqual(['slow']);
    expectRowsMatchSingleBacktests(wavy, config, out);
  });

  it('2D sweep on SMA crossover', () => {
    const config = base();
    const opt: OptimizeConfig = {
      sweeps: [{ key: 'fast', from: 5, to: 15, step: 5 }, { key: 'slow', from: 20, to: 40, step: 10 }],
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
      sweeps: [{ key: 'fast', from: 6, to: 12, step: 3 }, { key: 'slow', from: 20, to: 30, step: 5 }],
      metric: 'calmar',
    };
    const out = await runOptimizeAsync(wavy, config, opt);
    expect(out.rows).toHaveLength(9);
    expectRowsMatchSingleBacktests(wavy, config, out);
  });
});

describe('ranking', () => {
  const opt = (metric: MetricKey): OptimizeConfig => ({
    sweeps: [{ key: 'fast', from: 3, to: 20, step: 1 }, { key: 'slow', from: 25, to: 45, step: 5 }],
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
      sweeps: [{ key: 'fast', from: 3, to: 6, step: 1 }, { key: 'slow', from: 20, to: 30, step: 5 }],
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
    sweeps: [{ key: 'fast', from: 1, to: 400, step: 1 }, { key: 'slow', from: 1, to: 400, step: 1 }],
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

describe('any number of sweeps', () => {
  const macdConfig = () => base({ strategyId: 'macd_cross', params: { fast: 12, slow: 26, signal: 9, direction: 1 } });
  const three: OptimizeConfig = {
    sweeps: [
      { key: 'fast', from: 8, to: 12, step: 2 },
      { key: 'slow', from: 20, to: 30, step: 5 },
      { key: 'signal', from: 5, to: 9, step: 4 },
    ],
    metric: 'sharpe',
  };

  it('3-sweep grid runs every combination once, keys in sweep order, rows equal single backtests', () => {
    const config = macdConfig();
    const out = runOptimize(wavy, config, three);
    expect(out.keys).toEqual(['fast', 'slow', 'signal']);
    expect(out.combos).toBe(3 * 3 * 2);
    expect(out.rows.length + out.errored).toBe(18);
    const seen = new Set(out.rows.map((r) => `${r.params.fast}|${r.params.slow}|${r.params.signal}`));
    expect(seen.size).toBe(out.rows.length);
    expectRowsMatchSingleBacktests(wavy, config, out);
  });

  it('gridSize is the product, 0 for no sweeps or a non-finite sweep', () => {
    expect(gridSize(three)).toBe(18);
    expect(gridSize({ sweeps: [] })).toBe(0);
    expect(gridSize({ sweeps: [{ key: 'a', from: 1, to: Number.NaN, step: 1 }, three.sweeps[0]] })).toBe(0);
  });

  it('refuses empty sweeps and a repeated key', async () => {
    expect(() => runOptimize(wavy, base(), { sweeps: [], metric: 'sharpe' })).toThrow(/at least one/);
    const dup: OptimizeConfig = { sweeps: [three.sweeps[0], { ...three.sweeps[0] }], metric: 'sharpe' };
    expect(() => runOptimize(wavy, base(), dup)).toThrow(/more than once/);
    await expect(runOptimizeAsync(wavy, base(), dup)).rejects.toThrow(/more than once/);
    await expect(runOptimizeAsync(wavy, base(), { sweeps: [], metric: 'sharpe' })).rejects.toThrow(/at least one/);
  });

  it('applies the limit to a 3-sweep product', () => {
    const big: OptimizeConfig = {
      sweeps: [
        { key: 'fast', from: 1, to: 50, step: 1 },
        { key: 'slow', from: 1, to: 50, step: 1 },
        { key: 'signal', from: 1, to: 50, step: 1 },
      ],
      metric: 'sharpe',
    };
    expect(gridSize(big)).toBe(125_000);
    expect(() => runOptimize(wavy, macdConfig(), big)).toThrow(/limit/);
  });

  it('visits combinations first-sweep-outermost', () => {
    // Constant series: every row ties, so the stable sort leaves grid order.
    const flat = series(() => 100, 60);
    const out = runOptimize(flat, base(), {
      sweeps: [{ key: 'fast', from: 3, to: 4, step: 1 }, { key: 'slow', from: 10, to: 12, step: 1 }],
      metric: 'sharpe',
    });
    expect(out.rows.map((r) => `${r.params.fast},${r.params.slow}`)).toEqual(['3,10', '3,11', '3,12', '4,10', '4,11', '4,12']);
    // 3 sweeps: last sweep innermost
    const out3 = runOptimize(flat, macdConfig(), {
      sweeps: [{ key: 'fast', from: 3, to: 4, step: 1 }, { key: 'slow', from: 10, to: 11, step: 1 }, { key: 'signal', from: 2, to: 3, step: 1 }],
      metric: 'sharpe',
    });
    expect(out3.rows.map((r) => Object.values(r.params).join(','))).toEqual(['3,10,2', '3,10,3', '3,11,2', '3,11,3', '4,10,2', '4,10,3', '4,11,2', '4,11,3']);
  });

  it('defaults: the first two numeric params', () => {
    expect(defaultOptimizeConfig(base()).sweeps.map((x) => x.key)).toEqual(['fast', 'slow']);
    // never more than the first two numeric params, even for a three-param strategy
    expect(defaultOptimizeConfig(macdConfig()).sweeps.map((x) => x.key)).toEqual(['fast', 'slow']);
  });
});
