import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { generateDemoCandles } from '../providers/demo';
import { runBacktest } from './engine';
import { buyHoldCurve, computeMetrics } from './metrics';
import { runFullBacktest } from './runner';
import { buildSignals, strategies } from './strategies';
import { defaultBacktestConfig, type BacktestConfig, type Signal } from './types';

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

describe('signals fired', () => {
  const flat = (n: number) => makeCandles(new Array(n).fill(100));
  const series: Signal[] = [0, 1, 1, null, 1, 0, 1, -1, 1];

  it('counts turns to a new side; null keeps the side and -1 counts as 0 without shorts', () => {
    expect(runBacktest(flat(9), series, cfg()).signalsFired).toBe(2);
  });

  it('counts the turn to short when shorts are allowed', () => {
    expect(runBacktest(flat(9), series, cfg({ allowShort: true })).signalsFired).toBe(3);
  });

  it('an always-long series with a stop-out fires once and trades once', () => {
    const candles = makeCandles([100, 100, 100, 80, 100, 100, 100, 100], 1);
    candles[3] = { ...candles[3], low: 70 };
    const out = runBacktest(candles, new Array(8).fill(1), cfg({ stopLossPct: 5 }));
    expect(out.signalsFired).toBe(1);
    expect(out.trades).toHaveLength(1);
  });

  it('a flip after a stop-out fires again and trades again', () => {
    const candles = makeCandles(new Array(8).fill(100), 1);
    candles[2] = { ...candles[2], low: 70 };
    const out = runBacktest(candles, [1, 1, 0, 1, 1, 1, 1, 1], cfg({ stopLossPct: 5 }));
    expect(out.signalsFired).toBe(2);
    expect(out.trades).toHaveLength(2);
  });

  it('the last bar signal is never executed, so never counted', () => {
    expect(runBacktest(flat(4), [null, null, null, 1], cfg()).signalsFired).toBe(0);
  });

  it('is at least the trade count for every built-in strategy', () => {
    const candles = generateDemoCandles({ bars: 600, timeframe: '1d', seed: 7 });
    for (const s of strategies) {
      if (s.custom) continue;
      const params = Object.fromEntries(s.params.map((p) => [p.key, p.default]));
      const out = runBacktest(candles, buildSignals(candles, s.id, params), cfg({ strategyId: s.id, params, allowShort: true }));
      expect(out.signalsFired, s.id).toBeGreaterThanOrEqual(out.trades.length);
    }
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

describe('risk per trade sizing', () => {
  // Enter at bar 1 (open 100), stopped at bar 2; flat at bar 3; enter at bar 4, stopped at bar 5.
  function twoStops(stopPct: number, side: 1 | -1) {
    const candles = makeCandles(new Array(8).fill(100), 0);
    const crash = side === 1 ? { low: 100 * (1 - stopPct / 100) - 0.0001 } : { high: 100 * (1 + stopPct / 100) + 0.0001 };
    candles[2] = { ...candles[2], ...crash };
    candles[5] = { ...candles[5], ...crash };
    const signals: Signal[] = [side, side, 0, side, side, side, 0, 0];
    return { candles, signals };
  }

  it('loses exactly riskPct of the account at the stop: 20.00 then 19.60', () => {
    const { candles, signals } = twoStops(2, 1);
    const { trades } = runBacktest(candles, signals, cfg({ initialCapital: 1000, riskPct: 2, stopLossPct: 2 }));
    expect(trades).toHaveLength(2);
    expect(trades.map((t) => t.exitReason)).toEqual(['stop_loss', 'stop_loss']);
    expect(trades[0].pnl).toBeCloseTo(-20, 6);
    expect(trades[1].pnl).toBeCloseTo(-19.6, 6);
    expect(trades[0].leverage).toBeCloseTo(1, 9);
  });

  it('has no cap: a 0.04% stop is a 50x position and still loses 20.00', () => {
    const { candles, signals } = twoStops(0.04, 1);
    const { trades } = runBacktest(candles, signals, cfg({ initialCapital: 1000, riskPct: 2, stopLossPct: 0.04 }));
    expect(trades[0].qty * trades[0].entryPrice).toBeCloseTo(50 * 1000, 6);
    expect(trades[0].leverage).toBeCloseTo(50, 9);
    expect(trades[0].pnl).toBeCloseTo(-20, 6);
    expect(trades[1].pnl).toBeCloseTo(-19.6, 6);
  });

  it('sizes a short the same way', () => {
    const { candles, signals } = twoStops(0.04, -1);
    const { trades } = runBacktest(candles, signals, cfg({ initialCapital: 1000, riskPct: 2, stopLossPct: 0.04, allowShort: true }));
    expect(trades[0].side).toBe('short');
    expect(trades[0].leverage).toBeCloseTo(50, 9);
    expect(trades[0].pnl).toBeCloseTo(-20, 6);
  });

  it('without a stop it sizes exactly like positionSizePct', () => {
    const candles = makeCandles(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 10));
    const signals = buildSignals(candles, 'sma_cross', { fast: 3, slow: 8, direction: 1 });
    const base = cfg({ strategyId: 'sma_cross', positionSizePct: 60 });
    const plain = runBacktest(candles, signals, base);
    const withRisk = runBacktest(candles, signals, { ...base, riskPct: 2 });
    expect(withRisk.trades).toEqual(plain.trades);
    expect(withRisk.equity).toEqual(plain.equity);
    expect(withRisk.trades.every((t) => t.leverage === undefined)).toBe(true);
  });

  it('records no leverage and ignores nothing when riskPct is absent', () => {
    const { candles, signals } = twoStops(2, 1);
    const { trades } = runBacktest(candles, signals, cfg({ initialCapital: 1000, stopLossPct: 2 }));
    expect(trades.every((t) => !('leverage' in t))).toBe(true);
  });

  it('a gap through a leveraged stop that wipes the account stays finite and opens no more trades', () => {
    const candles = makeCandles(new Array(10).fill(100), 0);
    candles[2] = { ...candles[2], open: 90, high: 90, low: 90, close: 90 }; // gap down 10% through a 0.5% stop
    const signals: Signal[] = [1, 1, 0, 1, 1, 1, 1, 1, 1, 1];
    const r = runBacktest(candles, signals, cfg({ initialCapital: 1000, riskPct: 50, stopLossPct: 0.5 }));
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].leverage).toBeCloseTo(100, 9);
    expect(r.trades[0].pnl).toBeLessThan(-1000);
    for (const t of r.trades) for (const v of [t.pnl, t.pnlPct, t.qty, t.fees, t.leverage!]) expect(Number.isFinite(v)).toBe(true);
    for (const e of r.equity) {
      expect(Number.isFinite(e.equity)).toBe(true);
      expect(Number.isFinite(e.drawdownPct)).toBe(true);
    }
    const metrics = computeMetrics(candles, r.equity, r.trades, 1000, r.exposureBars);
    for (const [k, v] of Object.entries(metrics)) if (typeof v === 'number') expect(Number.isNaN(v), k).toBe(false);
  });
});

describe('TradingView indicator stop and target levels', () => {
  type Bar = [open: number, high: number, low: number, close: number];
  const ohlc = (rows: Bar[]): Candle[] => rows.map(([open, high, low, close], i) => ({ time: 1700000000 + i * 86400, open, high, low, close, volume: 1000 }));
  const flatBar: Bar = [100, 101, 99.5, 100];
  const longs = (n: number): Signal[] => new Array(n).fill(1);
  const tradeSummary = (r: { trades: Array<{ entryBar: number; exitBar: number; entryPrice: number; exitPrice: number; exitReason: string; qty: number }> }) =>
    r.trades.map((t) => ({ entryBar: t.entryBar, exitBar: t.exitBar, entryPrice: t.entryPrice, exitPrice: t.exitPrice, exitReason: t.exitReason, qty: t.qty }));

  it('an at-entry plot stop equals a fixed percent stop at the same level (same trades and equity)', () => {
    const candles = ohlc([flatBar, flatBar, [100, 101, 99.5, 100], [100, 100.5, 97, 97.5], flatBar, flatBar]);
    const level = 100 * (1 - 2 / 100);
    // The plot later moves far away: an at-entry stop ignores it.
    const values = [level, 50, 50, 50, 50, 50];
    const fixed = runBacktest(candles, longs(6), cfg({ stopLossPct: 2 }));
    const viaPlot = runBacktest(candles, longs(6), cfg(), undefined, { stop: { mode: 'at-entry', values } });
    expect(fixed.trades[0].exitReason).toBe('stop_loss');
    expect(viaPlot.trades).toEqual(fixed.trades);
    expect(viaPlot.equity).toEqual(fixed.equity);
  });

  it('a trailing plot stop exits on the first bar whose low reaches the previous bar plot value', () => {
    const candles = ohlc(Array.from({ length: 10 }, () => flatBar));
    const values = [90, 92, 94, 96, 98, 99, 99.6, 99.7, 99.8, 99.9];
    const out = runBacktest(candles, longs(10), cfg(), undefined, { stop: { mode: 'trailing', values } });
    // bar j is stopped when low 99.5 <= values[j - 1]: first at j - 1 = 6
    expect(out.trades[0]).toMatchObject({ entryBar: 1, exitBar: 7, exitPrice: 99.6, exitReason: 'stop_loss' });
  });

  it('a trailing plot stop may loosen: it is not ratcheted', () => {
    const candles = ohlc(Array.from({ length: 8 }, () => flatBar));
    // tight (99.6) on bar 3, loose (90) afterwards: the stop moves back down and the trade stays open
    const values = [90, 90, 99.6, 90, 90, 90, 90, 90];
    const out = runBacktest(candles, longs(8), cfg(), undefined, { stop: { mode: 'trailing', values } });
    expect(out.trades[0]).toMatchObject({ exitBar: 3, exitPrice: 99.6 });
    const loose = runBacktest(candles, longs(8), cfg(), undefined, { stop: { mode: 'trailing', values: [90, 90, 90, 90, 90, 90, 90, 90] } });
    expect(loose.trades[0].exitReason).toBe('end_of_data');
  });

  it('a plot target exits like a fixed target at the same price', () => {
    const candles = ohlc([flatBar, flatBar, flatBar, [101, 106, 100, 105], flatBar, flatBar]);
    const level = 100 * (1 + 5 / 100);
    const fixed = runBacktest(candles, longs(6), cfg({ takeProfitPct: 5 }));
    const viaPlot = runBacktest(candles, longs(6), cfg(), undefined, { target: { values: new Array(6).fill(level) } });
    expect(fixed.trades[0].exitReason).toBe('take_profit');
    expect(viaPlot.trades).toEqual(fixed.trades);
    expect(viaPlot.equity).toEqual(fixed.equity);
  });

  it('the nearer of a fixed target and a plot target wins, the tighter of a fixed and a plot stop wins', () => {
    const candles = ohlc([flatBar, flatBar, flatBar, [101, 104, 100, 103], flatBar]);
    const nearer = runBacktest(candles, longs(5), cfg({ takeProfitPct: 10 }), undefined, { target: { values: new Array(5).fill(103.5) } });
    expect(nearer.trades[0]).toMatchObject({ exitBar: 3, exitPrice: 103.5, exitReason: 'take_profit' });
    const dip = ohlc([flatBar, flatBar, flatBar, [100, 100, 96, 97], flatBar]);
    const tighter = runBacktest(dip, longs(5), cfg({ stopLossPct: 10 }), undefined, { stop: { mode: 'at-entry', values: new Array(5).fill(97) } });
    expect(tighter.trades[0]).toMatchObject({ exitPrice: 97, exitReason: 'stop_loss' });
    const looser = runBacktest(dip, longs(5), cfg({ stopLossPct: 2 }), undefined, { stop: { mode: 'at-entry', values: new Array(5).fill(90) } });
    expect(looser.trades[0]).toMatchObject({ exitPrice: 98, exitReason: 'stop_loss' });
  });

  it('a short uses the mirrored sides', () => {
    const candles = ohlc([flatBar, flatBar, [100, 103.5, 99.5, 103], flatBar]);
    const out = runBacktest(candles, new Array(4).fill(-1), cfg({ allowShort: true }), undefined, { stop: { mode: 'trailing', values: [102, 102, 102, 102] } });
    expect(out.trades[0]).toMatchObject({ side: 'short', exitBar: 2, exitPrice: 102, exitReason: 'stop_loss' });
    const tp = ohlc([flatBar, flatBar, [100, 100.5, 96, 97], flatBar]);
    const hit = runBacktest(tp, new Array(4).fill(-1), cfg({ allowShort: true }), undefined, { target: { values: [97, 97, 97, 97] } });
    expect(hit.trades[0]).toMatchObject({ side: 'short', exitPrice: 97, exitReason: 'take_profit' });
  });

  it('a gap through the plot stop fills at the open', () => {
    const candles = ohlc([flatBar, flatBar, flatBar, [94, 95, 93, 94], flatBar]);
    const out = runBacktest(candles, longs(5), cfg(), undefined, { stop: { mode: 'at-entry', values: new Array(5).fill(97) } });
    expect(out.trades[0]).toMatchObject({ exitBar: 3, exitPrice: 94, exitReason: 'stop_loss' });
  });

  it('stop before target on the same bar', () => {
    const candles = ohlc([flatBar, flatBar, flatBar, [100, 110, 90, 100], flatBar]);
    const out = runBacktest(candles, longs(5), cfg(), undefined, {
      stop: { mode: 'at-entry', values: new Array(5).fill(95) },
      target: { values: new Array(5).fill(105) },
    });
    expect(out.trades[0]).toMatchObject({ exitPrice: 95, exitReason: 'stop_loss' });
  });

  it('after a plot stop the signal must leave that side before a new entry', () => {
    const candles = ohlc([flatBar, flatBar, [100, 100, 94, 95], flatBar, flatBar, flatBar]);
    const out = runBacktest(candles, longs(6), cfg(), undefined, { stop: { mode: 'at-entry', values: new Array(6).fill(97) } });
    expect(out.trades).toHaveLength(1);
  });

  it('na or wrong-side levels place nothing', () => {
    const candles = ohlc(Array.from({ length: 6 }, () => flatBar));
    // A stop with no level opens no trade.
    expect(runBacktest(candles, longs(6), cfg(), undefined, { stop: { mode: 'at-entry', values: new Array(6).fill(null) } }).trades).toEqual([]);
    // A long stop above the price is no stop, and a long target below the price is no target.
    expect(runBacktest(candles, longs(6), cfg(), undefined, { stop: { mode: 'trailing', values: new Array(6).fill(105) } }).trades).toEqual([]);
    const noTarget = runBacktest(candles, longs(6), cfg(), undefined, { target: { values: new Array(6).fill(95) } });
    expect(noTarget.trades[0].exitReason).toBe('end_of_data');
    const naTarget = runBacktest(candles, longs(6), cfg(), undefined, { target: { values: new Array(6).fill(null) } });
    expect(naTarget.trades[0].exitReason).toBe('end_of_data');
  });

  it('an unusable at-entry stop opens no trade; the next bar that still asks for the side may open', () => {
    const candles = ohlc(Array.from({ length: 6 }, () => flatBar));
    const out = runBacktest(candles, longs(6), cfg(), undefined, { stop: { mode: 'at-entry', values: [null, 90, 90, 90, 90, 90] } });
    expect(out.trades).toHaveLength(1);
    expect(out.trades[0]).toMatchObject({ entryBar: 2 });
  });

  it('a trailing stop with no usable level on a later bar leaves the other exits in force', () => {
    const candles = ohlc([flatBar, flatBar, flatBar, [100, 100, 96, 97], flatBar]);
    const out = runBacktest(candles, longs(5), cfg({ stopLossPct: 3 }), undefined, { stop: { mode: 'trailing', values: [90, 90, null, 90, 90] } });
    expect(out.trades[0]).toMatchObject({ exitBar: 3, exitPrice: 97, exitReason: 'stop_loss' });
  });

  it('does not look ahead: changing a plot value on bar k leaves everything up to bar k unchanged', () => {
    const candles = generateDemoCandles({ bars: 400, timeframe: '1h', seed: 11 });
    const base = cfg({ strategyId: 'sma_cross', params: { fast: 8, slow: 21 } });
    const signals = buildSignals(candles, 'sma_cross', base.params);
    const values = candles.map((c) => c.close * 0.985);
    const a = runBacktest(candles, signals, base, undefined, { stop: { mode: 'trailing', values } });
    expect(a.trades.length).toBeGreaterThan(3);
    // Find a bar k inside an open trade where the next bar can reach a level that is still below the close.
    const k = a.trades
      .map((t) => t.entryBar + 1)
      .find((b, idx) => b + 1 < a.trades[idx].exitBar && candles[b + 1].low + 1e-6 < candles[b].close);
    expect(k).toBeDefined();
    const changed = values.slice();
    changed[k!] = candles[k! + 1].low + 1e-6;
    const b = runBacktest(candles, signals, base, undefined, { stop: { mode: 'trailing', values: changed } });
    expect(b.equity.slice(0, k! + 1)).toEqual(a.equity.slice(0, k! + 1));
    expect(b.trades.filter((t) => t.exitBar <= k!)).toEqual(a.trades.filter((t) => t.exitBar <= k!));
    // ... and the change does act on bar k + 1.
    expect(b.trades.find((t) => t.exitBar === k! + 1)).toMatchObject({ exitReason: 'stop_loss' });
    expect(a.trades.find((t) => t.exitBar === k! + 1 && t.exitReason === 'stop_loss')).toBeUndefined();
  });

  it('risk sizing and a 2R target use the plot stop distance', () => {
    const candles = ohlc([flatBar, flatBar, flatBar, [101, 111, 100, 110], flatBar]);
    const out = runBacktest(
      candles,
      longs(5),
      cfg({ riskPct: 1, takeProfitMode: 'r', takeProfitR: 2, takeProfitPct: null }),
      undefined,
      { stop: { mode: 'at-entry', values: new Array(5).fill(95) } },
    );
    // 1% of 10000 at a 5% stop = 2000 notional = 20 units; target at 2 x 5 above the entry
    expect(out.trades[0]).toMatchObject({ qty: 20, exitPrice: 110, exitReason: 'take_profit' });
  });

  it('with no plot levels the output equals the output without the argument', () => {
    const candles = generateDemoCandles({ bars: 600, timeframe: '1h', seed: 3 });
    const base = cfg({ strategyId: 'sma_cross', params: { fast: 8, slow: 21 }, stopLossPct: 2, takeProfitPct: 3 });
    const signals = buildSignals(candles, 'sma_cross', base.params);
    const plain = runBacktest(candles, signals, base);
    expect(runBacktest(candles, signals, base, undefined, {})).toEqual(plain);
    expect(tradeSummary(plain).length).toBeGreaterThan(3);
  });
});
