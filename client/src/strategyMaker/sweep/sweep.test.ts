import { describe, expect, it, vi } from 'vitest';
import { runBacktest } from '../../lib/backtest/engine';
import type { Candle } from '../../types';
import { mulberry32 } from '../../lib/random';
import { normal, synth } from '../engine/synthetic';
import { exitCount, exitOfCandidate, exitShort, exitWords, exitsOf, kindsOf, typicalRangePct } from './exits';
import { MAX_LOADS, MAX_SWEEP_COMBOS, rankCandidates, runSweep, sweepCombos, sweepConfig } from './sweep';
import type { SweepCandidate, SweepExit, SweepInput, SweepLoad, SweepMarket } from './types';

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
  it('finds a planted edge on one market, not on a random walk, and holds it on the hold-out', async () => {
    // Market A is a noisy 70-bar cycle, which the moving-average crossovers ride. Market B is a plain random walk.
    const rand = mulberry32(1);
    const cycle: Candle[] = Array.from({ length: 4000 }, (_, i) => {
      const c = 100 * Math.exp(0.15 * Math.sin((2 * Math.PI * i) / 70) + normal(rand) * 0.002);
      return { time: 1_600_000_000 + i * 3600, open: c, high: c * 1.001, low: c * 0.999, close: c, volume: 1000 };
    });
    const input: SweepInput = {
      ...base,
      targetSets: [{ minHitRatePct: 80 }],
      space: {
        sma_cross: [
          { key: 'fast', from: 4, to: 16, step: 4 },
          { key: 'slow', from: 20, to: 60, step: 10 },
        ],
      },
    };
    const out = await runSweep(input, fixed({ AAA: cycle, BBB: synth(4000, 11) }));
    expect(out.skipped).toEqual([]);
    expect(out.tried).toBe(2 * 20 * 4);
    expect(out.met).toBeGreaterThan(0);
    expect(out.met).toBeLessThan(out.tried);
    expect(out.held).toBeGreaterThan(0);
    expect(out.candidates.every((c) => c.market.symbol === 'AAA')).toBe(true);
    const c = out.candidates[0];
    expect(c.held).toBe(true);
    expect(c.selection.winRatePct).toBeGreaterThanOrEqual(80);
    expect(c.selection.trades).toBeGreaterThanOrEqual(30);
    expect(c.heldOut.trades).toBeGreaterThanOrEqual(10);
    for (const part of [c.selection, c.heldOut]) {
      expect(part.signalsFired!).toBeGreaterThanOrEqual(part.trades);
      expect(part.signalsPer100Bars!).toBeGreaterThan(0);
      expect(part.signalsPerDay!).toBeCloseTo(part.signalsPer100Bars! * 24 / 100, 6); // hourly bars
    }
    expect(out.closest.map((x) => x.market.symbol)).toEqual(['BBB']);
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

const rangeExit = (stopLossPct: number, takeProfitPct: number): SweepExit => ({ kind: 'range', stopMult: 1, tpMult: 1, config: { stopLossPct, takeProfitPct } });

describe('sizing', () => {
  it('two stopped-out trades from $1000 at 2% risk lose $20.00, then $19.60', () => {
    const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({ time: 1000 + i * 60, open: o, high: h, low: l, close: c, volume: 1 });
    // Signal 1 on bar 0 enters at bar 1's open (100); bar 1 trades down to 97 (stop 2% = 98, no gap: it opens at 100).
    const candles = [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 97, 98), bar(2, 100, 100, 100, 100), bar(3, 100, 100, 100, 100), bar(4, 100, 100, 97, 98), bar(5, 100, 100, 100, 100)];
    const signals = [1, 1, 0, 1, 1, 0];
    const cfg = sweepConfig({ initialCapital: 1000, riskPct: 2, feeBps: 0, slippageBps: 0 }, 'sma_cross', {}, rangeExit(2, 50));
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
    const grid = { stopMults: [1, 2], tpMults: [1, 3] };
    const want = [[2, 2], [2, 6], [4, 4], [4, 12]];
    for (const g of [grid, { ...grid, kinds: ['range' as const] }]) {
      expect(exitsOf(2, g).map((x) => [x.config.stopLossPct, x.config.takeProfitPct])).toEqual(want);
      expect(exitsOf(2, g).every((x) => x.kind === 'range')).toBe(true);
    }
  });
});

describe('rankCandidates', () => {
  const mk = (held: boolean, sel: number, out: number): SweepCandidate => {
    const f = (finalEquity: number) => ({ trades: 40, signalsFired: 50, signalsPer100Bars: 5, signalsPerDay: 1, totalReturnPct: 0, winRatePct: 60, rr: 1, maxDrawdownPct: 1, finalEquity });
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

describe('range exits give today\'s results', () => {
  // Pinned from a run of origin/main (622ded4) before exit kinds existed: two markets, one timeframe, sma 8/10 x 34, 2x2 exits.
  const input: SweepInput = { ...base, space: { sma_cross: [{ key: 'fast', from: 8, to: 10, step: 2 }, { key: 'slow', from: 34, to: 34, step: 1 }] } };
  const data = { AAA: synth(4000, 7), BBB: synth(4000, 11) };
  // market, fast, stop %, take profit %, selection final equity, hold-out final equity
  const rows: Array<[string, number, number, number, number, number]> = [
    ['BBB', 8, 1.6220154920224865, 3.244030984044973, 765.1661474737242, 1152.5392130173414],
    ['BBB', 8, 0.8110077460112433, 1.6220154920224865, 584.0884302379005, 1150.359789584522],
    ['BBB', 10, 1.6220154920224865, 3.244030984044973, 827.3040795014206, 1098.5661189344942],
    ['BBB', 8, 0.8110077460112433, 0.8110077460112433, 554.1485671003293, 1088.820650334424],
    ['BBB', 10, 0.8110077460112433, 1.6220154920224865, 679.3012784349255, 1083.693428672853],
    ['BBB', 10, 1.6220154920224865, 1.6220154920224865, 738.0463222346339, 1018.7468759790174],
    ['BBB', 8, 1.6220154920224865, 1.6220154920224865, 685.1798900682479, 1017.6383907000989],
    ['BBB', 10, 0.8110077460112433, 0.8110077460112433, 571.2721599361837, 1004.7199529215189],
    ['AAA', 10, 1.6087951787448405, 3.217590357489681, 581.3576492425757, 983.2118962958989],
    ['AAA', 8, 1.6087951787448405, 3.217590357489681, 740.9588948865501, 950.0089150834575],
    ['AAA', 10, 0.8043975893724202, 1.6087951787448405, 600.3505487651659, 917.394374563489],
    ['AAA', 8, 1.6087951787448405, 1.6087951787448405, 745.8769913102285, 904.8343257592647],
    ['AAA', 8, 0.8043975893724202, 1.6087951787448405, 554.1358014488915, 886.9268497943062],
    ['AAA', 10, 1.6087951787448405, 1.6087951787448405, 697.3643741655022, 884.220911551891],
    ['AAA', 8, 0.8043975893724202, 0.8043975893724202, 592.4066771322288, 833.1218917232311],
    ['AAA', 10, 0.8043975893724202, 0.8043975893724202, 668.1365002874129, 833.1218917232304],
  ];
  for (const [name, exits] of [['kinds absent', input.exits], ['kinds range', { ...input.exits, kinds: ['range' as const] }]] as Array<[string, SweepInput['exits']]>) {
    it(`${name}`, async () => {
      const r = await runSweep({ ...input, exits }, fixed(data));
      expect([r.tried, r.met, r.held]).toEqual([16, 16, 16]);
      expect(r.candidates).toHaveLength(rows.length);
      r.candidates.forEach((c, i) => {
        const [sym, fast, sl, tp, sel, out] = rows[i];
        expect([c.market.symbol, c.strategyId, c.params.fast, c.params.slow, c.held]).toEqual([sym, 'sma_cross', fast, 34, true]);
        expect(c.stopLossPct).toBeCloseTo(sl, 9);
        expect(c.takeProfitPct).toBeCloseTo(tp, 9);
        expect(c.selection.finalEquity).toBeCloseTo(sel, 6);
        expect(c.heldOut.finalEquity).toBeCloseTo(out, 6);
      });
    });
  }
});

describe('exit kinds', () => {
  const grid = { stopMults: [1, 2], tpMults: [1, 3] };
  const risk = { initialCapital: 1000, riskPct: 2, feeBps: 0, slippageBps: 0 };
  const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({ time: 1000 + i * 60, open: o, high: h, low: l, close: c, volume: 1 });

  it('orders kinds range, atr, atr_trail, then stop, then take profit', () => {
    const xs = exitsOf(2, { ...grid, kinds: ['atr_trail', 'range', 'atr'] });
    expect(xs.map((x) => [x.kind, x.stopMult, x.tpMult])).toEqual(
      ['range', 'atr', 'atr_trail'].flatMap((k) => [[k, 1, 1], [k, 1, 3], [k, 2, 1], [k, 2, 3]]),
    );
  });

  it('gives each kind its backtest settings', () => {
    const [r, a, t] = [exitsOf(2, { ...grid, kinds: ['range'] })[1], exitsOf(2, { ...grid, kinds: ['atr'] })[1], exitsOf(2, { ...grid, kinds: ['atr_trail'] })[1]];
    expect(r.config).toEqual({ stopLossPct: 2, takeProfitPct: 6 });
    expect(a.config).toEqual({ stopLossPct: null, takeProfitPct: null, stopMode: 'atr', stopAtrMult: 1, takeProfitMode: 'r', takeProfitR: 3, atrLength: 14 });
    expect(t.config).toEqual({ stopLossPct: null, takeProfitPct: null, trailMode: 'atr', trailAtrMult: 1, takeProfitMode: 'r', takeProfitR: 3, atrLength: 14 });
    expect(sweepConfig(risk, 'sma_cross', {}, a)).toMatchObject({ stopMode: 'atr', takeProfitMode: 'r', stopLossPct: null, takeProfitPct: null });
    const tc = sweepConfig(risk, 'sma_cross', {}, t);
    expect(tc).toMatchObject({ trailMode: 'atr', trailAtrMult: 1 });
    expect(tc.stopMode).toBeUndefined();
  });

  it('counts kinds x stops x take profits; drops unknown kinds; none left reads as range', () => {
    expect(exitCount({ ...grid, kinds: ['range', 'atr', 'atr_trail'] })).toBe(12);
    expect(exitCount(grid)).toBe(4);
    expect(kindsOf({ ...grid, kinds: ['bogus', 'atr'] as never })).toEqual(['atr']);
    expect(kindsOf({ ...grid, kinds: ['bogus'] as never })).toEqual(['range']);
    expect(kindsOf({ ...grid, kinds: [] })).toEqual(['range']);
    expect(sweepCombos({ ...base, exits: { ...grid, kinds: ['range', 'atr'] } })).toBe(2 * sweepCombos({ ...base, exits: grid }));
  });

  it('an ATR trailing exit ends a trade by trailing_stop, with the R target at tpMult x the trail start', () => {
    // 20 flat bars of range 2 (ATR 2); signal on bar 19; entry at bar 20 open 100; the trail starts 2 ATR = 4 below.
    const flat = Array.from({ length: 20 }, (_, i) => bar(i, 100, 101, 99, 100));
    const up = [bar(20, 100, 103, 100, 103), bar(21, 103, 110, 103, 110), bar(22, 110, 110, 100, 101), bar(23, 101, 101, 101, 101)];
    const candles = [...flat, ...up];
    const signals = candles.map((_, i) => (i >= 19 ? 1 : 0));
    const [x] = exitsOf(2, { stopMults: [2], tpMults: [10], kinds: ['atr_trail'] });
    const out = runBacktest(candles, signals, sweepConfig(risk, 'sma_cross', {}, x));
    expect(out.trades.map((t) => t.exitReason)).toEqual(['trailing_stop']);
    expect(out.trades[0].exitPrice).toBeLessThan(110);
    const y = exitsOf(2, { stopMults: [2], tpMults: [1], kinds: ['atr_trail'] })[0];
    const tp = runBacktest(candles, signals, sweepConfig(risk, 'sma_cross', {}, y));
    expect(tp.trades[0].exitReason).toBe('take_profit');
    expect(tp.trades[0].exitPrice).toBeCloseTo(tp.trades[0].entryPrice + 4, 6);
  });

  it('an ATR stop loses riskPct of equity when it is hit', () => {
    const flat = Array.from({ length: 20 }, (_, i) => bar(i, 100, 101, 99, 100));
    const candles = [...flat, bar(20, 100, 100, 90, 92), bar(21, 92, 92, 92, 92)];
    const signals = candles.map((_, i) => (i === 19 || i === 20 ? 1 : 0));
    const [x] = exitsOf(2, { stopMults: [2], tpMults: [3], kinds: ['atr'] });
    const out = runBacktest(candles, signals, sweepConfig(risk, 'sma_cross', {}, x));
    expect(out.trades.map((t) => t.exitReason)).toEqual(['stop_loss']);
    expect(out.trades[0].pnl).toBeCloseTo(-20, 1);
  });

  it('candidates of an ATR run carry the exit and null percents', async () => {
    const r = await runSweep({ ...base, exits: { stopMults: [2], tpMults: [2], kinds: ['atr'] } }, fixed({ AAA: long, BBB: long }));
    const all = [...r.candidates, ...r.closest];
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      expect(c.exit?.kind).toBe('atr');
      expect(c.stopLossPct).toBeNull();
      expect(c.takeProfitPct).toBeNull();
    }
  });
});

describe('exit words', () => {
  const [r, a, t] = (['range', 'atr', 'atr_trail'] as const).map((k) => exitsOf(2.1, { stopMults: [1], tpMults: [2], kinds: [k] })[0]);
  it('names each kind', () => {
    expect(exitWords(r)).toBe('stop 2.10%, take profit 4.20%');
    expect(exitShort(r)).toBe('2.10% / 4.20%');
    expect(exitWords({ ...a, stopMult: 2, tpMult: 3 })).toBe('stop 2 ATR, take profit 3R');
    expect(exitShort({ ...a, stopMult: 2, tpMult: 3 })).toBe('2 ATR / 3R');
    expect(exitWords({ ...t, stopMult: 2, tpMult: 3 })).toBe('trailing stop 2 ATR, take profit 3R');
    expect(exitShort({ ...t, stopMult: 2, tpMult: 3 })).toBe('2 ATR trailing / 3R');
  });
  it('reads a candidate without exit from its percents', () => {
    const x = exitOfCandidate({ stopLossPct: 2.1, takeProfitPct: 4.2 });
    expect(x.kind).toBe('range');
    expect(exitWords(x)).toBe('stop 2.10%, take profit 4.20%');
  });
});
