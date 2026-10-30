import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { generateDemoCandles } from '../providers/demo';
import { runBacktest } from './engine';
import { buyHoldCurve, computeMetrics } from './metrics';
import { runFullBacktest } from './runner';
import { buildSignals, strategies } from './strategies';
import { defaultBacktestConfig, type BacktestConfig } from './types';

function makeCandles(prices: number[], spread = 1): Candle[] {
  return prices.map((p, i) => ({
    time: 1700000000 + i * 86400,
    open: p,
    high: p + spread,
    low: p - spread,
    close: p,
    volume: 1000 + i,
  }));
}

function cfg(over: Partial<BacktestConfig> = {}): BacktestConfig {
  return { ...defaultBacktestConfig(), feeBps: 0, slippageBps: 0, strategyId: 'buy_hold', params: {}, ...over };
}

describe('backtest engine', () => {
  it('buy & hold: enters at the next bar open and exits at the last close', () => {
    const prices = Array.from({ length: 101 }, (_, i) => 100 + i);
    const candles = makeCandles(prices);
    const signals = buildSignals(candles, 'buy_hold', {});
    const { trades, equity } = runBacktest(candles, signals, cfg());

    expect(trades).toHaveLength(1);
    expect(trades[0].entryBar).toBe(1);
    expect(trades[0].entryPrice).toBe(101); // open of bar 1
    expect(trades[0].exitBar).toBe(100);
    expect(trades[0].exitPrice).toBe(200);
    expect(trades[0].exitReason).toBe('end_of_data');

    const final = equity[equity.length - 1].equity;
    expect(final).toBeCloseTo(10000 * (200 / 101), 6);
  });

  it('does not look ahead: a signal on bar i fills at bar i+1 open', () => {
    const candles = makeCandles([100, 100, 120, 120, 120]);
    const signals: Array<1 | null> = [null, null, 1, null, null];
    const { trades } = runBacktest(candles, signals, cfg());
    expect(trades).toHaveLength(1);
    expect(trades[0].entryBar).toBe(3);
    expect(trades[0].entryPrice).toBe(120);
  });

  it('applies fees and slippage against the trader', () => {
    const candles = makeCandles(Array.from({ length: 50 }, () => 100));
    const signals = buildSignals(candles, 'buy_hold', {});
    const free = runBacktest(candles, signals, cfg());
    const costly = runBacktest(candles, signals, cfg({ feeBps: 20, slippageBps: 10 }));
    expect(costly.trades[0].pnl).toBeLessThan(free.trades[0].pnl);
    expect(costly.trades[0].pnl).toBeLessThan(0); // flat market + costs = loss
  });

  it('triggers stop losses intra-bar', () => {
    const prices = [100, 100, 100, 100];
    const candles = makeCandles(prices, 1);
    candles[3] = { ...candles[3], low: 80, high: 101 }; // crash bar
    const signals = buildSignals(candles, 'buy_hold', {});
    const { trades } = runBacktest(candles, signals, cfg({ stopLossPct: 10 }));
    expect(trades).toHaveLength(1);
    expect(trades[0].exitReason).toBe('stop_loss');
    expect(trades[0].exitPrice).toBeCloseTo(90, 9); // entry 100, 10% stop
  });

  it('triggers take profits intra-bar', () => {
    const candles = makeCandles([100, 100, 100, 100], 1);
    candles[3] = { ...candles[3], high: 130 };
    const signals = buildSignals(candles, 'buy_hold', {});
    const { trades } = runBacktest(candles, signals, cfg({ takeProfitPct: 20 }));
    expect(trades[0].exitReason).toBe('take_profit');
    expect(trades[0].exitPrice).toBeCloseTo(120, 9);
  });

  it('requires a signal reset after a stop before re-entering', () => {
    const candles = makeCandles([100, 100, 100, 80, 100, 100, 100, 100], 1);
    candles[3] = { ...candles[3], low: 70 };
    const signals = buildSignals(candles, 'buy_hold', {}); // always long
    const { trades } = runBacktest(candles, signals, cfg({ stopLossPct: 5 }));
    expect(trades).toHaveLength(1); // never re-enters while the signal still says long
  });

  it('supports shorts when enabled', () => {
    const candles = makeCandles(Array.from({ length: 30 }, (_, i) => 200 - i * 2));
    const signals = new Array(30).fill(null).map((_, i) => (i >= 1 ? -1 : null));
    const { trades, equity } = runBacktest(candles, signals, cfg({ allowShort: true }));
    expect(trades[0].side).toBe('short');
    expect(equity[equity.length - 1].equity).toBeGreaterThan(10000);
  });

  it('ignores short signals when shorts are disabled', () => {
    const candles = makeCandles(Array.from({ length: 30 }, (_, i) => 200 - i * 2));
    const signals = new Array(30).fill(null).map((_, i) => (i >= 1 ? -1 : null));
    const { trades } = runBacktest(candles, signals, cfg({ allowShort: false }));
    expect(trades).toHaveLength(0);
  });
});

describe('buyHoldCurve', () => {
  it('scales the capital by close over the first close', () => {
    expect(buyHoldCurve(makeCandles([100, 110, 120, 90]), 10000)).toEqual([10000, 11000, 12000, 9000]);
  });
  it('is flat when the first close is not positive, and empty without candles', () => {
    expect(buyHoldCurve(makeCandles([0, 5, 6]), 10000)).toEqual([10000, 10000, 10000]);
    expect(buyHoldCurve([], 10000)).toEqual([]);
  });
  it('runFullBacktest carries a curve matching the Buy & hold metric', () => {
    const candles = makeCandles([100, 110, 120, 90]);
    const r = runFullBacktest(candles, cfg());
    expect(r.buyHold).toHaveLength(r.equity.length);
    expect(r.buyHold[0]).toBe(r.metrics.initialCapital);
    const last = r.buyHold[r.buyHold.length - 1];
    expect(last).toBeCloseTo(0.9 * r.metrics.initialCapital, 6);
    expect(last).toBeCloseTo(r.metrics.initialCapital * (1 + r.metrics.buyHoldPct / 100), 6);
  });
});

describe('metrics', () => {
  it('computes drawdown, total return and buy & hold', () => {
    const prices = [100, 110, 120, 90];
    const candles = makeCandles(prices, 0);
    const signals = buildSignals(candles, 'buy_hold', {});
    const config = cfg();
    const { trades, equity, exposureBars } = runBacktest(candles, signals, config);
    const metrics = computeMetrics(candles, equity, trades, config.initialCapital, exposureBars);

    // entered at 110 with 10k: peak equity at 120 = 10909.09, trough at 90
    expect(metrics.totalReturnPct).toBeCloseTo((10000 + (90 - 110) * (10000 / 110)) / 10000 * 100 - 100, 3);
    expect(metrics.maxDrawdownPct).toBeLessThan(-24);
    expect(metrics.maxDrawdownPct).toBeGreaterThan(-26);
    expect(metrics.buyHoldPct).toBeCloseTo(-10, 6); // close 100 -> 90
    expect(metrics.trades).toBe(1);
    expect(metrics.exposurePct).toBeGreaterThan(0);
  });
});

describe('runner + strategies', () => {
  it('runs every built-in strategy without errors on demo data', () => {
    const candles = generateDemoCandles({ bars: 600, timeframe: '1d', seed: 7 });
    for (const s of strategies) {
      if (s.custom) continue;
      const config = cfg({
        strategyId: s.id,
        params: Object.fromEntries(s.params.map((p) => [p.key, p.default])),
      });
      const result = runFullBacktest(candles, config);
      expect(result.trades.length).toBeGreaterThanOrEqual(0);
      expect(result.equity.length).toBe(candles.length);
      expect(Number.isFinite(result.metrics.totalReturnPct)).toBe(true);
    }
  });

  it('sma crossover produces trades on trending demo data', () => {
    const candles = generateDemoCandles({ bars: 800, timeframe: '1d', seed: 42 });
    const config = cfg({ strategyId: 'sma_cross', params: { fast: 10, slow: 30, direction: 1 } });
    const result = runFullBacktest(candles, config);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.signals?.length).toBe(candles.length);
  });

  it('custom strategy code runs in the same pipeline', () => {
    const candles = generateDemoCandles({ bars: 300, timeframe: '1d', seed: 3 });
    const config = cfg({
      strategyId: 'custom',
      params: { n: 10 },
      customCode: `
        const hh = indicators.highest(candles.map(c => c.high), params.n || 10);
        const out = new Array(candles.length).fill(null);
        let pos = 0;
        for (let i = 1; i < candles.length; i++) {
          if (hh[i-1] == null) continue;
          if (pos === 0 && candles[i].close > hh[i-1]) pos = 1;
          else if (pos === 1 && candles[i].close < candles[i-1].low) pos = 0;
          out[i] = pos;
        }
        return out;
      `,
    });
    const result = runFullBacktest(candles, config);
    expect(result.trades.length).toBeGreaterThan(0);
  });
});

describe('demo data generator', () => {
  it('is deterministic for a fixed seed and keeps OHLC valid', () => {
    const a = generateDemoCandles({ bars: 100, timeframe: '1d', seed: 99 });
    const b = generateDemoCandles({ bars: 100, timeframe: '1d', seed: 99 });
    expect(a.map((c) => c.close)).toEqual(b.map((c) => c.close));
    for (const c of a) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
    for (let i = 1; i < a.length; i++) expect(a[i].time).toBeGreaterThan(a[i - 1].time);
  });
});

describe('backtest progress', () => {
  const candles = generateDemoCandles({ bars: 1000 });
  const config = cfg({ strategyId: 'sma_cross', params: { fast: 10, slow: 30 } });

  it('reports non-decreasing progress through the stages, ends at 1, and leaves the result unchanged', () => {
    const calls: [number, string][] = [];
    const withCb = runFullBacktest(candles, config, (p, s) => calls.push([p, s]));
    const without = runFullBacktest(candles, config);
    expect(withCb).toEqual(without);
    expect(calls.length).toBeLessThanOrEqual(110);
    expect(calls.length).toBeGreaterThan(50);
    for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
    expect(calls[0]).toEqual([0, 'signals']);
    expect(calls[calls.length - 1]).toEqual([1, 'metrics']);
    const order = ['signals', 'simulating', 'metrics'];
    const idx = calls.map(([, s]) => order.indexOf(s));
    expect(idx.every((v) => v >= 0)).toBe(true);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThanOrEqual(idx[i - 1]);
    expect(new Set(idx).size).toBe(3);
  });

  it('the engine alone reports in 0..1 and ends at 1', () => {
    const signals = buildSignals(candles, 'sma_cross', { fast: 10, slow: 30 });
    const seen: number[] = [];
    runBacktest(candles, signals, config, (p) => seen.push(p));
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.every((p) => p >= 0 && p <= 1)).toBe(true);
  });
});
