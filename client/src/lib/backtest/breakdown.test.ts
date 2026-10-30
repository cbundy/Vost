import { describe, expect, it } from 'vitest';
import { generateDemoCandles } from '../providers/demo';
import { computeBreakdown, isWin } from './breakdown';
import { computeMetrics } from './metrics';
import { runFullBacktest } from './runner';
import { defaultBacktestConfig, type ExitReason, type Trade } from './types';

let nextId = 1;
function trade(side: 'long' | 'short', pnl: number, pnlPct: number, bars: number, exitReason: ExitReason = 'signal'): Trade {
  const id = nextId++;
  return {
    id,
    side,
    qty: 1,
    entryTime: id * 100,
    entryPrice: 100,
    entryBar: id * 10,
    exitTime: id * 100 + 50,
    exitPrice: 100 + pnl,
    exitBar: id * 10 + bars,
    pnl,
    pnlPct,
    fees: 0,
    bars,
    exitReason,
  };
}

function fixture(): Trade[] {
  nextId = 1;
  return [
    trade('long', 10, 10, 2), // W
    trade('long', 5, 5, 4), // W
    trade('short', -4, -4, 6, 'stop_loss'), // L
    trade('short', 0, 0, 2), // L (zero counts as a loss)
    trade('long', -2, -2, 4, 'stop_loss'), // L
    trade('short', 8, 8, 8, 'take_profit'), // W
    trade('long', -6, -6, 2), // L
    trade('long', 3, 3, 6, 'end_of_data'), // W
  ];
}

describe('computeBreakdown', () => {
  it('computes hand-checked per-side figures', () => {
    const b = computeBreakdown(fixture());
    expect(b.all).toMatchObject({ trades: 8, wins: 4, losses: 4, winRatePct: 50, netPnl: 14, grossProfit: 26, grossLoss: 12 });
    expect(b.all.profitFactor).toBeCloseTo(26 / 12, 10);
    expect(b.all.avgTradePct).toBeCloseTo(14 / 8, 10);
    expect(b.all.bestTradePct).toBe(10);
    expect(b.all.worstTradePct).toBe(-6);
    expect(b.all.avgBars).toBe(4.25);

    expect(b.long).toMatchObject({ trades: 5, wins: 3, losses: 2, winRatePct: 60, netPnl: 10, grossProfit: 18, grossLoss: 8 });
    expect(b.long.profitFactor).toBeCloseTo(18 / 8, 10);
    expect(b.long.avgTradePct).toBeCloseTo(2, 10);
    expect(b.long.bestTradePct).toBe(10);
    expect(b.long.worstTradePct).toBe(-6);
    expect(b.long.avgBars).toBeCloseTo(18 / 5, 10);

    expect(b.short).toMatchObject({ trades: 3, wins: 1, losses: 2, netPnl: 4, grossProfit: 8, grossLoss: 4 });
    expect(b.short.winRatePct).toBeCloseTo(100 / 3, 10);
    expect(b.short.profitFactor).toBe(2);
    expect(b.short.avgTradePct).toBeCloseTo(4 / 3, 10);
    expect(b.short.bestTradePct).toBe(8);
    expect(b.short.worstTradePct).toBe(-4);
    expect(b.short.avgBars).toBeCloseTo(16 / 3, 10);
  });

  it('finds the longest streaks, the first one on a tie, and the current streak', () => {
    const b = computeBreakdown(fixture());
    // W W L L L W L W: longest win is the first pair (tie with none longer), longest loss is the three.
    expect(b.streaks.longestWin).toEqual({ count: 2, pnl: 15 });
    expect(b.streaks.longestLoss).toEqual({ count: 3, pnl: -6 });
    expect(b.streaks.current).toEqual({ kind: 'win', count: 1 });
  });

  it('ties take the first streak', () => {
    nextId = 1;
    const b = computeBreakdown([trade('long', 1, 1, 1), trade('long', 2, 2, 1), trade('long', -1, -1, 1), trade('long', 5, 5, 1), trade('long', 7, 7, 1)]);
    expect(b.streaks.longestWin).toEqual({ count: 2, pnl: 3 });
    expect(b.streaks.current).toEqual({ kind: 'win', count: 2 });
  });

  it('counts exit reasons in a fixed order', () => {
    const b = computeBreakdown(fixture());
    expect(b.exitReasons.map((r) => r.reason)).toEqual(['signal', 'stop_loss', 'take_profit', 'end_of_data']);
    const [signal, stop, tp, eod] = b.exitReasons;
    expect(signal).toMatchObject({ count: 4, sharePct: 50, netPnl: 9, winRatePct: 50 });
    expect(stop).toMatchObject({ count: 2, sharePct: 25, netPnl: -6, winRatePct: 0 });
    expect(tp).toMatchObject({ count: 1, sharePct: 12.5, netPnl: 8, winRatePct: 100 });
    expect(eod).toMatchObject({ count: 1, sharePct: 12.5, netPnl: 3, winRatePct: 100 });
  });

  it('omits exit reasons with no trades', () => {
    nextId = 1;
    expect(computeBreakdown([trade('long', 1, 1, 1, 'take_profit')]).exitReasons.map((r) => r.reason)).toEqual(['take_profit']);
  });

  it('handles no trades', () => {
    const b = computeBreakdown([]);
    for (const s of [b.all, b.long, b.short]) {
      expect(s).toMatchObject({ trades: 0, wins: 0, losses: 0, winRatePct: null, netPnl: 0, profitFactor: null, avgTradePct: null, bestTradePct: null, worstTradePct: null, avgBars: null });
    }
    expect(b.streaks).toEqual({ longestWin: null, longestLoss: null, current: null });
    expect(b.exitReasons).toEqual([]);
  });

  it('leaves the short column empty for long-only trades', () => {
    nextId = 1;
    const b = computeBreakdown([trade('long', 1, 1, 1), trade('long', -1, -1, 1)]);
    expect(b.short.trades).toBe(0);
    expect(b.short.winRatePct).toBeNull();
    expect(b.short.profitFactor).toBeNull();
    expect(b.short.avgTradePct).toBeNull();
    expect(b.short.bestTradePct).toBeNull();
    expect(b.short.avgBars).toBeNull();
    expect(b.long.trades).toBe(2);
  });

  it('reports an infinite profit factor with no losses', () => {
    nextId = 1;
    const b = computeBreakdown([trade('long', 1, 1, 1), trade('long', 2, 2, 1)]);
    expect(b.all.profitFactor).toBe(Number.POSITIVE_INFINITY);
    expect(b.streaks.longestLoss).toBeNull();
  });

  it('agrees with the metrics win rule: zero P/L is a loss', () => {
    nextId = 1;
    const zero = trade('long', 0, 0, 1);
    expect(isWin(zero)).toBe(false);
    const candles = generateDemoCandles({ bars: 50, timeframe: '1d', seed: 1 });
    const m = computeMetrics(candles, [], [zero, trade('long', 1, 1, 1)], 10000, 0);
    const b = computeBreakdown([zero, trade('long', 1, 1, 1)]);
    expect(b.all.winRatePct).toBe(m.winRatePct);
    expect(b.all.profitFactor).toBe(m.profitFactor);
  });

  it('matches the run metrics on a real run and splits sides', () => {
    const candles = generateDemoCandles({ bars: 900, timeframe: '1d', seed: 42 });
    const config = {
      ...defaultBacktestConfig(),
      strategyId: 'sma_cross',
      params: { fast: 8, slow: 25, direction: 3 },
      allowShort: true,
      stopLossPct: 3,
    };
    const { trades, metrics } = runFullBacktest(candles, config);
    expect(trades.length).toBeGreaterThan(5);
    const b = computeBreakdown(trades);
    expect(b.all.trades).toBe(metrics.trades);
    expect(b.all.winRatePct).toBe(metrics.winRatePct);
    expect(b.all.profitFactor).toBe(metrics.profitFactor);
    expect(b.all.avgTradePct).toBe(metrics.avgTradePct);
    expect(b.all.bestTradePct).toBe(metrics.bestTradePct);
    expect(b.all.worstTradePct).toBe(metrics.worstTradePct);
    expect(b.long.trades + b.short.trades).toBe(b.all.trades);
    expect(b.exitReasons.reduce((a, r) => a + r.count, 0)).toBe(b.all.trades);
  });
});
