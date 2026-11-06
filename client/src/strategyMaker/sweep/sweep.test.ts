import { describe, expect, it, vi } from 'vitest';
import { runBacktest } from '../../lib/backtest/engine';
import type { Candle } from '../../types';
import { synth } from '../engine/synthetic';
import { exitsOf, typicalRangePct } from './exits';
import { MAX_LOADS, MAX_SWEEP_COMBOS, rankCandidates, runSweep, sweepCombos, sweepConfig } from './sweep';
import type { SweepCandidate, SweepInput, SweepLoad, SweepMarket } from './types';

const A: SweepMarket = { provider: 'test', symbol: 'AAA' };
const B: SweepMarket = { provider: 'test', symbol: 'BBB' };

/** One strategy (sma 8/34), a small exit grid: a run takes well under a second. */
const base: SweepInput = {
  markets: [A, B],
  timeframes: ['1d'],
  families: ['sma_cross'],
  direction: 'long',
  targetSets: [{ minHitRatePct: 0 }],
  risk: { initialCapital: 1000, riskPct: 2, feeBps: 10, slippageBps: 5 },
  exits: { stopMults: [1, 2], tpMults: [1, 2] },
  space: {
    sma_cross: [
      { key: 'fast', from: 8, to: 8, step: 1 },
      { key: 'slow', from: 34, to: 34, step: 1 },
    ],
  },
};

const fixed = (m: Record<string, Candle[]>): SweepLoad => async (market) => {
  const c = m[market.symbol];
  if (!c) throw new Error('no such market');
  return c;
};

const long = synth(4000, 7);
// The last 30% is flat: no trades there, so nothing can be held.
const flatTail = (c: Candle[], keep: number, total: number): Candle[] => {
  const head = c.slice(0, keep);
  const last = head[keep - 1];
  const tail = Array.from({ length: total - keep }, (_, i) => ({ ...last, time: last.time + (i + 1) * 3600, open: last.close, high: last.close, low: last.close, volume: 0 }));
  return [...head, ...tail];
};

describe('runSweep', () => {
  it('finds a planted strategy on two markets and holds it on the hold-out', async () => {
    const out = await runSweep(base, fixed({ AAA: synth(4000, 7), BBB: synth(4000, 11) }));
    expect(out.skipped).toEqual([]);
    expect(out.tried).toBe(2 * 1 * 4);
    expect(out.met).toBeGreaterThan(0);
    expect(out.held).toBeGreaterThan(0);
    expect(new Set(out.candidates.map((c) => c.market.symbol))).toEqual(new Set(['AAA', 'BBB']));
    const c = out.candidates[0];
    expect(c.held).toBe(true);
    expect(c.params).toMatchObject({ fast: 8, slow: 34 });
    expect(c.selection.trades).toBeGreaterThanOrEqual(30);
    expect(c.heldOut.trades).toBeGreaterThanOrEqual(10);
    expect(out.closest).toEqual([]);
  });

  it('a candidate that meets only the second set passes and names it', async () => {
    const out = await runSweep({ ...base, targetSets: [{ minRR: 1000 }, { minHitRatePct: 0 }] }, fixed({ AAA: long, BBB: long }));
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.candidates.every((c) => c.setIndex === 1)).toBe(true);
  });

  it('a series where nothing meets a set shows its closest candidate with the gaps against the nearest set', async () => {
    const out = await runSweep({ ...base, targetSets: [{ minRR: 1000 }, { minRR: 50 }] }, fixed({ AAA: long, BBB: long }));
    expect(out.candidates).toEqual([]);
    expect(out.closest).toHaveLength(2);
    const c = out.closest[0];
    expect(c.setIndex).toBe(1);
    expect(c.gaps.length).toBeGreaterThan(0);
    expect(c.gaps[0].text).toMatch(/minRR/);
    expect(c.selection.trades).toBeGreaterThanOrEqual(30);
  });

  it('a strategy that meets a set on the searched part but not on the hold-out is met, not held', async () => {
    const out = await runSweep({ ...base, markets: [A] }, fixed({ AAA: flatTail(long, 2100, 3000) }));
    expect(out.met).toBeGreaterThan(0);
    expect(out.held).toBe(0);
    expect(out.candidates.every((c) => !c.held)).toBe(true);
  });

  it('lists a market that fails to load and goes on', async () => {
    const out = await runSweep({ ...base, markets: [A, { provider: 'test', symbol: 'GONE' }, B] }, fixed({ AAA: long, BBB: long }));
    expect(out.skipped).toEqual([{ market: { provider: 'test', symbol: 'GONE' }, timeframe: '1d', reason: 'no such market' }]);
    expect(new Set(out.candidates.map((c) => c.market.symbol))).toEqual(new Set(['AAA', 'BBB']));
  });

  it('calls a short series too short', async () => {
    const out = await runSweep({ ...base, markets: [A] }, fixed({ AAA: synth(300, 3) }));
    expect(out.candidates).toEqual([]);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].reason).toMatch(/Too short/);
  });

  it('refuses a run over budget with its count, before anything loads', async () => {
    const load = vi.fn<SweepLoad>();
    const input: SweepInput = { ...base, space: undefined, families: ['macd_cross', 'sma_cross', 'ema_cross'], markets: Array.from({ length: 500 }, (_, i) => ({ provider: 'p', symbol: `S${i}` })), timeframes: ['1d', '1w'] };
    const n = sweepCombos(input);
    expect(n).toBeGreaterThan(MAX_SWEEP_COMBOS);
    await expect(runSweep(input, load)).rejects.toThrow(`Search has ${n} combinations; the limit is ${MAX_SWEEP_COMBOS}`);
    expect(load).not.toHaveBeenCalled();
  });

  it('counts the default grid as 1,782 settings by 18 exits per series', () => {
    const input: SweepInput = { ...base, space: undefined, families: ['macd_cross', 'sma_cross', 'ema_cross'], exits: { stopMults: [1, 2, 4], tpMults: [1, 1.5, 2, 3, 4, 5] }, markets: [A], timeframes: ['1d'] };
    expect(sweepCombos(input) % 18).toBe(0);
    expect(sweepCombos(input)).toBeGreaterThan(10_000);
  });

  it('never has more than 3 loads in flight, and drops a market once it is done', async () => {
    let live = 0;
    let peak = 0;
    const load: SweepLoad = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return synth(300, 1);
    };
    const markets = Array.from({ length: 10 }, (_, i) => ({ provider: 'p', symbol: `S${i}` }));
    const out = await runSweep({ ...base, markets }, load);
    expect(out.skipped).toHaveLength(10);
    expect(peak).toBe(MAX_LOADS);
  });

  it('reports progress in order, ending at 1', async () => {
    const seen: number[] = [];
    await runSweep(base, fixed({ AAA: long, BBB: long }), (p) => seen.push(p.pct));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('rejects with an AbortError when the signal aborts, and hands the signal to load', async () => {
    const ctl = new AbortController();
    const load = vi.fn<SweepLoad>(async (_m, _t, signal) => {
      expect(signal).toBe(ctl.signal);
      return long;
    });
    const run = runSweep(base, load, (p) => {
      if (p.pct > 0) ctl.abort();
    }, ctl.signal);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(load).toHaveBeenCalled();
    const pre = new AbortController();
    pre.abort();
    await expect(runSweep(base, load, undefined, pre.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('sizing', () => {
  it('two stopped-out trades from $1000 at 2% risk lose $20.00, then $19.60', () => {
    const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({ time: 1000 + i * 60, open: o, high: h, low: l, close: c, volume: 1 });
    // Signal 1 on bar 0 enters at bar 1's open (100); bar 1 trades down to 97 (stop 2% = 98, no gap: it opens at 100).
    const candles = [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 97, 98), bar(2, 100, 100, 100, 100), bar(3, 100, 100, 100, 100), bar(4, 100, 100, 97, 98), bar(5, 100, 100, 100, 100)];
    const signals = [1, 1, 0, 1, 1, 0];
    const cfg = sweepConfig({ initialCapital: 1000, riskPct: 2, feeBps: 0, slippageBps: 0 }, 'sma_cross', {}, 2, 50);
    const out = runBacktest(candles, signals, cfg);
    expect(out.trades.map((t) => t.exitReason)).toEqual(['stop_loss', 'stop_loss']);
    const eq = out.trades.map((_, i) => 1000 + out.trades.slice(0, i + 1).reduce((a, t) => a + t.pnl, 0));
    expect(eq[0]).toBeCloseTo(980, 2);
    expect(eq[1]).toBeCloseTo(960.4, 2);
    expect(out.equity[out.equity.length - 1].equity).toBeCloseTo(960.4, 2);
  });

  it('sizes exits from the typical bar range', () => {
    const c = [100, 100, 100].map((p, i) => ({ time: i, open: p, high: p + 2, low: p, close: p, volume: 1 }));
    expect(typicalRangePct(c)).toBeCloseTo(2, 9);
    expect(exitsOf(2, { stopMults: [1, 2], tpMults: [1, 3] })).toEqual([
      { stopLossPct: 2, takeProfitPct: 2 },
      { stopLossPct: 2, takeProfitPct: 6 },
      { stopLossPct: 4, takeProfitPct: 4 },
      { stopLossPct: 4, takeProfitPct: 12 },
    ]);
  });
});

describe('rankCandidates', () => {
  const mk = (held: boolean, sel: number, out: number): SweepCandidate => {
    const f = (finalEquity: number) => ({ trades: 40, totalReturnPct: 0, winRatePct: 60, rr: 1, maxDrawdownPct: 1, finalEquity });
    return { market: A, timeframe: '1d', strategyId: 's', params: {}, stopLossPct: 1, takeProfitPct: 1, setIndex: 0, held, selection: f(sel), heldOut: f(out) };
  };
  it('puts held before met-only, then orders by final equity', () => {
    const list = [mk(false, 5000, 0), mk(true, 1, 1100), mk(true, 1, 1300), mk(false, 2000, 0)];
    expect(rankCandidates(list).map((c) => [c.held, c.held ? c.heldOut.finalEquity : c.selection.finalEquity])).toEqual([
      [true, 1300],
      [true, 1100],
      [false, 5000],
      [false, 2000],
    ]);
  });
});
