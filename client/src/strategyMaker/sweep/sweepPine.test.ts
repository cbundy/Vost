import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../types';
import { synth } from '../engine/synthetic';
import { runAnyBacktest } from '../../lib/backtest/runner';
import { SELECTION_PCT } from '../engine/search';
import { parseHandoff, encodeHandoff } from '../../lib/backtestHandoff';
import { sweepHandoff } from '../sweepHandoff';
import { sweepCombos, sweepConfig } from './sweep';
import type { PineRole } from '../../lib/backtest/pineRole';
import { MAX_PINE_RUNS } from './pineSpace';
import { runSweep } from './sweep';
import type { SweepCandidate, SweepComposed, SweepInput, SweepLoad, SweepMarket, SweepPineRole } from './types';

const runs = vi.hoisted(() => ({ calls: [] as Array<{ symbol?: string; inputs: Record<string, unknown>; bars: number }> }));
vi.mock('../../lib/pine/runtime', async (orig) => {
  const m = await orig<typeof import('../../lib/pine/runtime')>();
  return {
    ...m,
    runPine: (...args: Parameters<typeof m.runPine>) => {
      runs.calls.push({ symbol: args[3]?.market?.symbol, inputs: args[2] as Record<string, unknown>, bars: args[1].length });
      return m.runPine(...args);
    },
  };
});

const A: SweepMarket = { provider: 'test', symbol: 'AAA' };
const B: SweepMarket = { provider: 'test', symbol: 'BBB' };
const SMA_CROSS = `//@version=6
indicator("Two SMAs", overlay=true)
fast = input.int(10, "Fast")
slow = input.int(50, "Slow", minval=2, maxval=400)
plot(ta.sma(close, fast), "fast")
plot(ta.sma(close, slow), "slow")
`;
// Fails to run on one market only: the market's ticker comes from the run.
const BAD_ON_BBB = `//@version=6
indicator("Picky", overlay=true)
len = input.int(10, "Length")
if syminfo.ticker == "BBB"
    runtime.error("this market is not allowed")
plot(ta.sma(close, len), "fast")
plot(ta.sma(close, 50), "slow")
`;

const data = synth(4000, 7);
const fixed = (m: Record<string, Candle[]>): SweepLoad => async (market) => m[market.symbol] ?? Promise.reject(new Error('no such market'));

const cross: SweepPineRole['role']['rule'] = { type: 'cross', a: { kind: 'plot', plot: 'fast' }, b: { kind: 'plot', plot: 'slow' } };
const pineEntry = (over: Partial<SweepPineRole['role']> = {}, ranges: SweepPineRole['ranges'] = [{ input: 'Slow', from: 50, to: 150, step: 50 }]): SweepPineRole => ({
  role: { indicatorId: 'sma2', name: 'Two SMAs', inputs: { Fast: 5 }, role: 'entry', rule: cross, ...over },
  ranges,
});
const input = (composed: SweepComposed, over: Partial<SweepInput> = {}): SweepInput => ({
  markets: [A, B],
  timeframes: ['1d'],
  families: [],
  direction: 'long',
  targetSets: [{ minHitRatePct: 0 }],
  risk: { initialCapital: 1000, riskPct: 2, feeBps: 10, slippageBps: 5 },
  exits: { stopMults: [1, 2], tpMults: [1, 2] },
  composed,
  ...over,
});
const withPine = (pine: SweepPineRole[], sources: Record<string, string> = { sma2: SMA_CROSS }): SweepComposed => ({
  entryRules: [],
  filters: [],
  trendTfs: [],
  pine,
  pineSources: sources,
});

const slowOf = (c: SweepCandidate) => (c.pineRoles?.[0].inputs.Slow ?? c.params.slow) as number;

describe('market search with TradingView indicators', () => {
  it('runs each input setting once per part of each market, and gives the same trades as the built-in rule', async () => {
    runs.calls.length = 0;
    const load = fixed({ AAA: data, BBB: synth(4000, 11) });
    const viaPine = await runSweep(input(withPine([pineEntry()])), load);
    // 3 slow values x 2 parts x 2 markets, however many exits and settings read them.
    expect(runs.calls).toHaveLength(3 * 2 * 2);
    expect(viaPine.skipped).toEqual([]);
    expect(viaPine.tried).toBe(3 * 4 * 2);

    // The built-in SMA crossover rule with the same lengths (fast 5, slow 50 / 100 / 150 are on its grid).
    const builtIn = await runSweep(input({ entryRules: [1], filters: [], trendTfs: [] }), load);
    const seen = new Set<string>();
    for (const p of viaPine.candidates) {
      const twin = builtIn.candidates.find((b) => b.market.symbol === p.market.symbol && b.params.fast === 5 && b.params.slow === slowOf(p) && JSON.stringify(b.exit) === JSON.stringify(p.exit));
      expect(twin).toBeDefined();
      expect(p.selection).toEqual(twin!.selection);
      expect(p.heldOut).toEqual(twin!.heldOut);
      seen.add(`${p.market.symbol}|${slowOf(p)}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  }, 120_000);

  it('a candidate names its roles with the input values and no source', async () => {
    const out = await runSweep(input(withPine([pineEntry()])), fixed({ AAA: data, BBB: data }));
    expect(out.candidates.length + out.closest.length).toBeGreaterThan(0);
    for (const c of [...out.candidates, ...out.closest]) {
      expect(c.params.entryRule).toBe(7);
      expect(c.pineRoles).toHaveLength(1);
      expect(c.pineRoles![0]).toMatchObject({ indicatorId: 'sma2', role: 'entry', inputs: { Fast: 5 } });
    }
    expect(JSON.stringify(out)).not.toContain('plot(ta.sma');
  }, 120_000);

  it('a Pine filter runs once per input setting too, shared with the entry that uses the same inputs', async () => {
    runs.calls.length = 0;
    const filter: SweepPineRole = {
      role: { indicatorId: 'sma2', name: 'Two SMAs', inputs: { Fast: 5 }, role: 'filter', label: 'trend', rule: { type: 'above', a: { kind: 'plot', plot: 'fast' }, b: { kind: 'plot', plot: 'slow' } } },
      ranges: [{ input: 'Slow', from: 50, to: 150, step: 50 }],
    };
    const out = await runSweep(input(withPine([pineEntry(), filter]), { markets: [A] } as never), fixed({ AAA: data }));
    expect(runs.calls).toHaveLength(3 * 2);
    expect(out.skipped).toEqual([]);
    // 3 entries x (off + 3) filter settings.
    expect(out.tried).toBe(12 * 4);
  }, 120_000);

  it('a script that fails on one market skips that market, naming the indicator, and the other market goes on', async () => {
    const out = await runSweep(
      input(withPine([pineEntry({ name: 'Picky', indicatorId: 'picky' }, [{ input: 'Length', from: 5, to: 15, step: 5 }])], { picky: BAD_ON_BBB })),
      fixed({ AAA: data, BBB: data }),
    );
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]).toMatchObject({ market: B, timeframe: '1d' });
    expect(out.skipped[0].reason).toContain('Picky');
    expect(out.skipped[0].reason).toContain('this market is not allowed');
    expect(out.candidates.length + out.closest.length).toBeGreaterThan(0);
    expect(out.candidates.every((c) => c.market.symbol === 'AAA')).toBe(true);
    // The skipped market's share still counts, so the progress reaches the total.
    expect(out.tried).toBe(3 * 4 * 2);
  }, 120_000);

  it('a source that is not stored skips the market, naming the indicator', async () => {
    const out = await runSweep(input(withPine([pineEntry()], {})), fixed({ AAA: data, BBB: data }));
    expect(out.skipped.map((s) => s.market.symbol)).toEqual(['AAA', 'BBB']);
    expect(out.skipped[0].reason).toContain('"Two SMAs"');
    expect(out.skipped[0].reason).toContain('no longer stored');
    expect(out.candidates).toEqual([]);
  });

  it('a strategy script and a missing plot skip the market with their reasons', async () => {
    const strategy = '//@version=6\nstrategy("S", overlay=true)\nif ta.crossover(close, ta.sma(close, 5))\n    strategy.entry("L", strategy.long)\n';
    const a = await runSweep(input(withPine([pineEntry({}, [])], { sma2: strategy }), { markets: [A] }), fixed({ AAA: data }));
    expect(a.skipped[0].reason).toContain('strategy script');
    const b = await runSweep(input(withPine([pineEntry({ rule: { type: 'cross', a: { kind: 'plot', plot: 'nope' }, b: { kind: 'close' } } }, [])]), { markets: [A] }), fixed({ AAA: data }));
    expect(b.skipped[0].reason).toContain('no plot titled "nope"');
  });

  it('with the baseline, the shuffled copies run the script too, and the counts add up', async () => {
    runs.calls.length = 0;
    const out = await runSweep(input(withPine([pineEntry()]), { markets: [A], baseline: true }), fixed({ AAA: data }));
    expect(runs.calls).toHaveLength(3 * 2 * 2);
    expect(out.baseline).toMatchObject({ series: 1, tried: 12 });
    expect(out.tried).toBe(24);
  }, 120_000);

  it('rejects over the limit of script runs before any candle is loaded', async () => {
    const load = vi.fn<SweepLoad>(async () => data);
    const many = pineEntry({}, [{ input: 'Slow', from: 2, to: 1000, step: 1 }]);
    await expect(runSweep(input(withPine([many])), load)).rejects.toThrow(new RegExp(`script runs; the limit is ${MAX_PINE_RUNS.toLocaleString('en-US')}`));
    expect(load).not.toHaveBeenCalled();
  });

  it('refuses a bad range with a plain message before any candle is loaded', async () => {
    const load = vi.fn<SweepLoad>(async () => data);
    await expect(runSweep(input(withPine([pineEntry({}, [{ input: 'Slow', from: 50, to: 150, step: 0 }])])), load)).rejects.toThrow(/step above 0/);
    expect(load).not.toHaveBeenCalled();
  });

  it('a search whose only entries are Pine entries passes the family check', async () => {
    const out = await runSweep(input(withPine([pineEntry({}, [])]), { markets: [A] }), fixed({ AAA: data }));
    expect(out.skipped).toEqual([]);
  });

  it('without Pine the result is the one it always was: same settings, counts and no new field', async () => {
    const plain: SweepComposed = { entryRules: [1], filters: [], trendTfs: [] };
    const a = await runSweep(input(plain, { markets: [A] }), fixed({ AAA: data }));
    const b = await runSweep(input({ ...plain, pine: [] }, { markets: [A] }), fixed({ AAA: data }));
    expect(b).toEqual(a);
    expect(JSON.stringify(a)).not.toContain('pineRoles');
    expect(runs.calls.length).toBeGreaterThan(0); // earlier tests ran the script; these two did not add a run
  }, 120_000);
});

const CHANNEL = `//@version=6
indicator("Channel", overlay=true)
len = input.int(10, "Length")
plot(ta.lowest(low, len), "Low line")
`;
const BAD_STOP = `//@version=6
indicator("Channel", overlay=true)
len = input.int(10, "Length")
if syminfo.ticker == "BBB"
    runtime.error("no channel here")
plot(ta.lowest(low, len), "Low line")
`;
const Y: SweepMarket = { provider: 'yahoo', symbol: 'AAA' };
const stop = (mode: 'at-entry' | 'trailing', over: Partial<Omit<PineRole, 'source'>> = {}): Omit<PineRole, 'source'> => ({
  indicatorId: 'chan', name: 'Channel', inputs: { Length: 10 }, role: 'stop', mode, rule: { type: 'level', plot: 'Low line' }, ...over,
});
const stopInput = (mode: 'at-entry' | 'trailing', over: Partial<SweepInput> = {}, sources: Record<string, string> = { chan: CHANNEL }): SweepInput =>
  input({ entryRules: [2], filters: [], trendTfs: [], pineSources: sources }, { markets: [Y], exits: { stopMults: [1], tpMults: [1, 2], kinds: ['range', 'pine'], pineStop: stop(mode) }, ...over });

describe('market search with a TradingView indicator stop', () => {
  for (const mode of ['at-entry', 'trailing'] as const) {
    it(`${mode}: tries the plot as the stop of Composed settings only, counts exactly, and a row's hand-off takes the same trades`, async () => {
      runs.calls.length = 0;
      const plain = { ...stopInput(mode), families: ['sma_cross'] };
      const out = await runSweep(plain, fixed({ AAA: data }));
      // Plain settings take the range exits only; Composed settings add the indicator exits.
      expect(out.tried).toBe(sweepCombos(plain));
      expect(out.skipped).toEqual([]);
      const rows = [...out.candidates, ...out.closest];
      expect(rows.some((c) => c.exit?.kind === 'pine')).toBe(true);
      expect(rows.filter((c) => c.exit?.kind === 'pine').every((c) => c.strategyId === 'composed')).toBe(true);
      expect(rows.some((c) => c.strategyId === 'sma_cross')).toBe(true);
      // One script run per part, however many settings and exits read it.
      expect(runs.calls).toHaveLength(2);

      const cut = Math.floor((data.length * SELECTION_PCT) / 100);
      const risk = plain.risk;
      const pineRows = out.candidates.filter((c) => c.exit?.kind === 'pine');
      expect(pineRows.length).toBeGreaterThan(0);
      for (const c of pineRows.slice(0, 3)) {
        expect(c.exit!.config).toMatchObject({ stopLossPct: null, takeProfitPct: null, takeProfitMode: 'r', takeProfitR: c.exit!.tpMult });
        const h = parseHandoff(encodeHandoff(sweepHandoff(c, risk)))!;
        expect(h.pineRoles!.filter((r) => r.role === 'stop')).toEqual([stop(mode)]);
        const filled = {
          ...sweepConfig(risk, 'x', {}, c.exit!), strategyId: h.strategyId, params: h.params, feeBps: h.feeBps, slippageBps: h.slippageBps, stopLossPct: h.stopLossPct,
          takeProfitPct: h.takeProfitPct, allowShort: h.allowShort, initialCapital: h.initialCapital, positionSizePct: h.positionSizePct, riskPct: h.riskPct,
          takeProfitMode: h.takeProfitMode, takeProfitR: h.takeProfitR,
          pineRoles: h.pineRoles!.map((r) => ({ ...r, source: CHANNEL })),
          market: { providerId: h.providerId!, symbol: h.symbol!, interval: h.timeframe },
        };
        const sel = await runAnyBacktest(data.slice(0, cut), filled as never);
        const hold = await runAnyBacktest(data.slice(cut), filled as never);
        expect(sel.trades.length).toBe(c.selection.trades);
        expect(sel.equity[sel.equity.length - 1].equity).toBe(c.selection.finalEquity);
        expect(hold.trades.length).toBe(c.heldOut.trades);
        expect(hold.equity[hold.equity.length - 1].equity).toBe(c.heldOut.finalEquity);
        expect(c.selection.trades).toBeGreaterThan(0);
      }
    }, 120_000);
  }

  it('the stop plot changes the trades: a trailing stop and a fixed one differ', async () => {
    const a = await runSweep(stopInput('at-entry'), fixed({ AAA: data }));
    const b = await runSweep(stopInput('trailing'), fixed({ AAA: data }));
    const key = (o: typeof a) => JSON.stringify(o.candidates.filter((c) => c.exit?.kind === 'pine').map((c) => c.selection.finalEquity));
    expect(key(a)).not.toBe(key(b));
  }, 120_000);

  it('works with built-in Composed rules only, and shares the run with a role of the same indicator and inputs', async () => {
    runs.calls.length = 0;
    const same: SweepComposed = { entryRules: [2], filters: [], trendTfs: [], pine: [{ role: { ...stop('at-entry'), role: 'filter', label: 'trend', rule: { type: 'above', a: { kind: 'close' }, b: { kind: 'plot', plot: 'Low line' } }, mode: undefined }, ranges: [] }], pineSources: { chan: CHANNEL } };
    const out = await runSweep({ ...stopInput('at-entry'), composed: same }, fixed({ AAA: data }));
    expect(out.skipped).toEqual([]);
    expect(runs.calls).toHaveLength(2);
  }, 120_000);

  it('a stop script that fails skips that market, naming the indicator, and the other market goes on', async () => {
    const i = stopInput('at-entry', { markets: [A, B] }, { chan: BAD_STOP });
    const out = await runSweep(i, fixed({ AAA: data, BBB: data }));
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].market).toEqual(B);
    expect(out.skipped[0].reason).toContain('Channel');
    expect(out.skipped[0].reason).toContain('no channel here');
    expect(out.tried).toBe(sweepCombos(i));
  }, 120_000);

  it('a missing source skips the market, and a plain-family search counts no indicator exits', async () => {
    const out = await runSweep(stopInput('at-entry'), fixed({ AAA: data }));
    expect(out.skipped).toEqual([]);
    const gone = await runSweep(stopInput('at-entry', {}, {}), fixed({ AAA: data }));
    expect(gone.skipped[0].reason).toContain('no longer stored');
    const plainOnly: SweepInput = { ...stopInput('at-entry'), composed: undefined, families: ['sma_cross'] };
    const p = await runSweep(plainOnly, fixed({ AAA: data }));
    expect(p.tried).toBe(sweepCombos(plainOnly));
    expect([...p.candidates, ...p.closest].some((c) => c.exit?.kind === 'pine')).toBe(false);
  }, 120_000);

  it('with the baseline the shuffled copy runs the stop too and the counts add up', async () => {
    const i = stopInput('at-entry', { baseline: true });
    const out = await runSweep(i, fixed({ AAA: data }));
    expect(out.tried).toBe(sweepCombos(i));
    expect(out.baseline?.series).toBe(1);
    expect(out.baseline!.tried).toBe(sweepCombos(i) / 2);
  }, 120_000);
});
