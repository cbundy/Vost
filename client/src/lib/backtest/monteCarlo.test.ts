import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../random';
import { histogram, nearestRank, orderedTrades, pathStats, runMonteCarlo, tradeReturns } from './monteCarlo';
import { monteCarloCsv, monteCarloCsvFileName } from './monteCarloCsv';
import type { Trade } from './types';

function trade(id: number, pnl: number, exitTime = id * 100): Trade {
  return {
    id, side: 'long', qty: 1, entryTime: exitTime - 50, entryPrice: 100, entryBar: id, exitTime, exitPrice: 100,
    exitBar: id + 1, pnl, pnlPct: pnl, fees: 0, bars: 1, exitReason: 'signal',
  };
}

// 1000 -> 1100 -> 990 -> 1040 -> 1100
const FOUR = [trade(1, 100), trade(2, -110), trade(3, 50), trade(4, 60)];

describe('trade returns', () => {
  it('divides each pnl by the equity before it', () => {
    const r = tradeReturns(FOUR, 1000);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(-0.1, 12);
    expect(r[2]).toBeCloseTo(50 / 990, 12);
    expect(r[3]).toBeCloseTo(60 / 1040, 12);
  });
  it('orders by exit time, then id', () => {
    const t = [trade(3, 1, 500), trade(2, 1, 500), trade(1, 1, 900)];
    expect(orderedTrades(t).map((x) => x.id)).toEqual([2, 3, 1]);
  });
  it('path stats: final return and trade-to-trade drawdown with the start in the peak', () => {
    const s = pathStats(tradeReturns(FOUR, 1000), 1000);
    expect(s.finalReturnPct).toBeCloseTo(10, 9);
    expect(s.maxDrawdownPct).toBeCloseTo(10, 9); // 1100 -> 990
    expect(pathStats([-0.2], 1000).maxDrawdownPct).toBeCloseTo(20, 9); // from the starting capital
  });
});

describe('percentiles and histogram', () => {
  const v = Array.from({ length: 20 }, (_, i) => i + 1);
  it('nearest rank on 20 values', () => {
    expect(nearestRank(v, 5)).toBe(1);
    expect(nearestRank(v, 25)).toBe(5);
    expect(nearestRank(v, 50)).toBe(10);
    expect(nearestRank(v, 75)).toBe(15);
    expect(nearestRank(v, 95)).toBe(19);
    expect(nearestRank(v, 100)).toBe(20);
  });
  it('histogram counts sum to N and equal values give one bin', () => {
    const h = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]);
    expect(h).toHaveLength(20);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(11);
    expect(h[19].count).toBe(2);
    expect(histogram([3, 3, 3])).toEqual([{ from: 3, to: 3, count: 3 }]);
  });
});

describe('runMonteCarlo', () => {
  it('shuffle keeps every final return equal to the original while drawdowns vary', () => {
    const r = runMonteCarlo({ trades: FOUR, initialCapital: 1000 }, { iterations: 200, method: 'shuffle', seed: 3 });
    const fr = r.finalReturn;
    for (const p of [fr.p5, fr.p25, fr.p50, fr.p75, fr.p95]) expect(Math.abs(p - r.original.finalReturnPct)).toBeLessThan(1e-9);
    expect(r.maxDrawdown.p95).toBeGreaterThan(r.maxDrawdown.p5);
    expect(r.histogram).toHaveLength(1);
  });

  it('bootstrap matches a hand-traced 3-trade, 3-iteration case', () => {
    // floor(mulberry32(7)() * 3) for the first 9 draws, written out: iteration 1 takes 0,0,2; iteration 2 takes 2,1,1; iteration 3 takes 1,0,1
    const rand = mulberry32(7);
    const draws = Array.from({ length: 9 }, () => Math.floor(rand() * 3));
    expect(draws).toEqual([0, 0, 2, 2, 1, 1, 1, 0, 1]);
    const trades = [trade(1, 100), trade(2, -50), trade(3, 200)];
    const base = tradeReturns(trades, 1000);
    const finals: number[] = [];
    const dds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = pathStats(draws.slice(i * 3, i * 3 + 3).map((d) => base[d]), 1000);
      finals.push(s.finalReturnPct);
      dds.push(s.maxDrawdownPct);
    }
    const r = runMonteCarlo({ trades, initialCapital: 1000 }, { iterations: 3, method: 'bootstrap', seed: 7 });
    expect(r.finalReturn.p5).toBeCloseTo(Math.min(...finals), 9);
    expect(r.finalReturn.p95).toBeCloseTo(Math.max(...finals), 9);
    expect(r.finalReturn.p50).toBeCloseTo([...finals].sort((a, b) => a - b)[1], 9);
    expect(r.maxDrawdown.p95).toBeCloseTo(Math.max(...dds), 9);
  });

  it('probability of loss counts losing paths', () => {
    // -10% then +2% in either order always ends below the start
    const losing = runMonteCarlo({ trades: [trade(1, -100), trade(2, 20)], initialCapital: 1000 }, { iterations: 100, method: 'shuffle', seed: 1 });
    expect(losing.probLossPct).toBe(100);
    // two wins can only end above the start
    const winning = runMonteCarlo({ trades: [trade(1, 10), trade(2, 10)], initialCapital: 1000 }, { iterations: 100, method: 'bootstrap', seed: 1 });
    expect(winning.probLossPct).toBe(0);
    const mixed = runMonteCarlo({ trades: [trade(1, 100), trade(2, -90)], initialCapital: 1000 }, { iterations: 1000, method: 'bootstrap', seed: 5 });
    expect(mixed.probLossPct).toBeGreaterThan(5);
    expect(mixed.probLossPct).toBeLessThan(95);
  });

  it('original percentile rank is the share of simulations at or below it', () => {
    const r = runMonteCarlo({ trades: FOUR, initialCapital: 1000 }, { iterations: 100, method: 'shuffle', seed: 2 });
    expect(r.original.finalReturnRankPct).toBe(100); // every shuffled path ends equal to it
    expect(r.original.maxDrawdownRankPct).toBeGreaterThan(0);
    expect(r.original.maxDrawdownRankPct).toBeLessThanOrEqual(100);
    const b = runMonteCarlo({ trades: FOUR, initialCapital: 1000 }, { iterations: 500, method: 'bootstrap', seed: 2 });
    expect(b.histogram).toHaveLength(20);
    expect(b.histogram.reduce((a, h) => a + h.count, 0)).toBe(500);
  });

  it('is deterministic per seed, and bootstrap differs between seeds', () => {
    const run = (seed: number, method: 'shuffle' | 'bootstrap') => runMonteCarlo({ trades: FOUR, initialCapital: 1000 }, { iterations: 300, method, seed });
    expect(run(4, 'bootstrap')).toEqual(run(4, 'bootstrap'));
    expect(run(4, 'shuffle')).toEqual(run(4, 'shuffle'));
    expect(run(4, 'bootstrap')).not.toEqual(run(5, 'bootstrap'));
  });

  it('defaults to 1000 shuffle runs with seed 1', () => {
    const r = runMonteCarlo({ trades: FOUR, initialCapital: 1000 });
    expect([r.iterations, r.method, r.seed]).toEqual([1000, 'shuffle', 1]);
  });

  it('throws on fewer than 2 trades', () => {
    expect(() => runMonteCarlo({ trades: [trade(1, 5)], initialCapital: 1000 })).toThrow(/at least 2 trades/);
    expect(() => runMonteCarlo({ trades: [], initialCapital: 1000 })).toThrow();
  });

  it('never mutates its input', () => {
    const trades = [trade(3, 50), trade(1, 100), trade(2, -110)];
    const copy = JSON.parse(JSON.stringify(trades));
    runMonteCarlo({ trades, initialCapital: 1000 }, { iterations: 100, method: 'bootstrap', seed: 9 });
    runMonteCarlo({ trades, initialCapital: 1000 }, { iterations: 100, method: 'shuffle', seed: 9 });
    expect(trades).toEqual(copy);
  });
});

describe('monteCarloCsv', () => {
  it('writes # context lines, then the statistic table', () => {
    const r = runMonteCarlo({ trades: FOUR, initialCapital: 1000 }, { iterations: 100, method: 'bootstrap', seed: 8 });
    const csv = monteCarloCsv(r, { strategyId: 'sma_cross', strategyName: 'SMA cross', params: { fast: 9, slow: 21, __x: 1 } });
    const lines = csv.split('\n');
    expect(lines.slice(0, 8)).toEqual([
      '# strategy: SMA cross (sma_cross)',
      '# params: fast=9; slow=21',
      '# method: bootstrap (resample trades)',
      '# runs: 100',
      '# seed: 8',
      '# trades: 4',
      '# initial capital: 1000',
      '# max drawdown is measured trade to trade',
    ]);
    expect(lines[8]).toBe('statistic,value');
    expect(lines[9]).toMatch(/^final_return_pct_p5,/);
    expect(lines.some((l) => l.startsWith('probability_of_loss_pct,'))).toBe(true);
    expect(lines.some((l) => l.startsWith('original_max_drawdown_percentile,'))).toBe(true);
    expect(lines).toHaveLength(9 + 15);
  });
  it('names the file by data label', () => {
    expect(monteCarloCsvFileName('BTC/USDT 1h')).toBe('vost_montecarlo_BTC_USDT_1h.csv');
  });
});
