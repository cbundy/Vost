import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../lib/backtest/engine';
import { runAnyBacktest } from '../lib/backtest/runner';
import { handoffSettingsText } from '../lib/backtestHandoff';
import { SELECTION_PCT } from './engine/search';
import { synth } from './engine/synthetic';
import { runSweep } from './sweep/sweep';
import { buildSignals } from '../lib/backtest/strategies';
import type { BacktestConfig } from '../lib/backtest/types';
import { candlesFromCsvText } from '../lib/csv';
import { encodeHandoff, parseHandoff } from '../lib/backtestHandoff';
import { exitsOf } from './sweep/exits';
import { sweepConfig } from './sweep/sweep';
import type { ExitKind, PartFigures, SweepCandidate, SweepRisk } from './sweep/types';
import { sweepHandoff } from './sweepHandoff';

const candles = candlesFromCsvText(readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8')).candles;
const risk: SweepRisk = { initialCapital: 1000, riskPct: 2, feeBps: 10, slippageBps: 5 };
const figures: PartFigures = { trades: 40, signalsFired: 50, signalsPer100Bars: 5, signalsPerDay: 1, totalReturnPct: 10, winRatePct: 60, rr: 1.5, maxDrawdownPct: 8, finalEquity: 1100 };
const candidate = (params: Record<string, number>, kind: ExitKind = 'range'): SweepCandidate => ({
  market: { provider: 'yahoo', symbol: 'AAPL' },
  timeframe: '1w',
  strategyId: 'sma_cross',
  params,
  exit: exitsOf(2.123456789, { stopMults: [1], tpMults: [2], kinds: [kind] })[0],
  stopLossPct: kind === 'range' ? 2.123456789 : null,
  takeProfitPct: kind === 'range' ? 4.246913578 : null,
  setIndex: 0,
  held: true,
  selection: figures,
  heldOut: figures,
});

/** What applyBacktestHandoff sets for the exits: every field the link has, and none of the others. */
const exitsOfLink = (h: NonNullable<ReturnType<typeof parseHandoff>>): Partial<BacktestConfig> => ({
  stopMode: h.stopMode, stopAtrMult: h.stopAtrMult, takeProfitMode: h.takeProfitMode, takeProfitAtrMult: h.takeProfitAtrMult, takeProfitR: h.takeProfitR,
  trailMode: h.trailMode, trailPct: h.trailPct, trailAtrMult: h.trailAtrMult, atrLength: h.atrLength,
});

describe('sweepHandoff', () => {
  it('carries the market, timeframe, settings, exits, fees, account size and risk, and survives the address', () => {
    const c = candidate({ fast: 8, slow: 34, direction: 1 });
    const h = sweepHandoff(c, risk);
    expect(h).toMatchObject({
      providerId: 'yahoo',
      symbol: 'AAPL',
      timeframe: '1w',
      strategyId: 'sma_cross',
      params: { fast: 8, slow: 34, direction: 1 },
      stopLossPct: 2.123456789,
      takeProfitPct: 4.246913578,
      feeBps: 10,
      slippageBps: 5,
      initialCapital: 1000,
      riskPct: 2,
      allowShort: false,
    });
    expect(parseHandoff(encodeHandoff(h))).toEqual(h);
  });

  it('is short-capable exactly when sweepConfig is', () => {
    for (const direction of [1, 2, 3]) {
      const c = candidate({ fast: 8, slow: 34, direction });
      expect(sweepHandoff(c, risk).allowShort).toBe(sweepConfig(risk, c.strategyId, c.params, c.exit!).allowShort);
    }
  });

  it('a Backtest tab filled from it (as applyBacktestHandoff fills it) takes the trades the search took', () => {
    for (const [direction, kind] of [[1, 'range'], [3, 'range'], [1, 'atr'], [3, 'atr'], [1, 'atr_trail'], [3, 'atr_trail']] as const) {
      const c = candidate({ fast: 8, slow: 34, direction }, kind);
      const h = parseHandoff(encodeHandoff(sweepHandoff(c, risk)))!;
      const filled = { ...sweepConfig(risk, 'x', {}, c.exit!), strategyId: h.strategyId, params: h.params, feeBps: h.feeBps, slippageBps: h.slippageBps, stopLossPct: h.stopLossPct, takeProfitPct: h.takeProfitPct, allowShort: h.allowShort, initialCapital: h.initialCapital, positionSizePct: h.positionSizePct, riskPct: h.riskPct, ...exitsOfLink(h) };
      const run = (config: BacktestConfig) =>
        runBacktest(candles, buildSignals(candles, 'sma_cross', c.params), config).trades.map((t) => [t.side, t.entryBar, t.exitBar, t.entryPrice, t.exitPrice, t.pnl]);
      const searched = run(sweepConfig(risk, c.strategyId, c.params, c.exit!));
      expect(searched.length).toBeGreaterThan(0);
      expect(run(filled)).toEqual(searched);
    }
  });

  it('writes the ATR settings for the ATR kinds and none for the range kind', () => {
    const a = sweepHandoff(candidate({ fast: 8, slow: 34, direction: 1 }, 'atr'), risk);
    expect(a).toMatchObject({ stopLossPct: null, takeProfitPct: null, stopMode: 'atr', stopAtrMult: 1, takeProfitMode: 'r', takeProfitR: 2, atrLength: 14 });
    const t = sweepHandoff(candidate({ fast: 8, slow: 34, direction: 1 }, 'atr_trail'), risk);
    expect(t).toMatchObject({ trailMode: 'atr', trailAtrMult: 1, takeProfitMode: 'r', takeProfitR: 2 });
    expect(t.stopMode).toBeUndefined();
    const r = sweepHandoff(candidate({ fast: 8, slow: 34, direction: 1 }), risk);
    expect(r.stopMode).toBeUndefined();
    expect(r.trailMode).toBeUndefined();
  });

  it('a candidate without exit still hands over its percents', () => {
    const { exit: _exit, ...old } = candidate({ fast: 8, slow: 34, direction: 1 });
    expect(sweepHandoff(old, risk)).toMatchObject({ stopLossPct: 2.123456789, takeProfitPct: 4.246913578 });
  });

  it('adds the TradingView indicator stop to the roles with the R target, and survives the address', () => {
    const stop = { indicatorId: 'st', name: 'Supertrend', inputs: { Factor: 3 }, role: 'stop' as const, mode: 'trailing' as const, rule: { type: 'level' as const, plot: 'Supertrend' } };
    const [exit] = exitsOf(2, { stopMults: [1], tpMults: [2], kinds: ['pine'], pineStop: stop });
    const filter = { indicatorId: 'f', name: 'F', inputs: {}, role: 'filter' as const, label: 'trend' as const, rule: { type: 'above' as const, a: { kind: 'close' as const }, b: { kind: 'close' as const } } };
    for (const roles of [undefined, [filter]]) {
      const c: SweepCandidate = { ...candidate({ entryRule: 2, direction: 1 }), strategyId: 'composed', exit, stopLossPct: null, takeProfitPct: null, ...(roles && { pineRoles: roles }) };
      const h = sweepHandoff(c, risk);
      expect(h.pineRoles).toEqual([...(roles ?? []), stop]);
      expect(h).toMatchObject({ stopLossPct: null, takeProfitPct: null, takeProfitMode: 'r', takeProfitR: 2 });
      expect(parseHandoff(encodeHandoff(h))).toEqual(h);
    }
  });

  describe('with TradingView indicators', () => {
    const SMA_CROSS = '//@version=6\nindicator("Two SMAs", overlay=true)\nfast = input.int(10, "Fast")\nslow = input.int(50, "Slow")\nplot(ta.sma(close, fast), "fast")\nplot(ta.sma(close, slow), "slow")\n';
    const roleOf = (): SweepCandidate['pineRoles'] => [
      { indicatorId: 'sma2', name: 'Two SMAs', inputs: { Fast: 5, Slow: 50 }, role: 'entry', rule: { type: 'cross', a: { kind: 'plot', plot: 'fast' }, b: { kind: 'plot', plot: 'slow' } } },
      { indicatorId: 'sma2', name: 'Two SMAs', inputs: { Fast: 5, Slow: 100 }, role: 'filter', label: 'trend', rule: { type: 'above', a: { kind: 'close' }, b: { kind: 'plot', plot: 'slow' } } },
    ];
    const withRoles = (): SweepCandidate => ({ ...candidate({ entryRule: 7, direction: 1 }), strategyId: 'composed', pineRoles: roleOf() });

    it('carries the roles, and no source, and survives the address', () => {
      const h = sweepHandoff({ ...withRoles(), pineRoles: roleOf()!.map((r) => ({ ...r, source: 'secret' })) }, risk);
      expect(h.pineRoles).toEqual(roleOf());
      const link = encodeHandoff(h);
      expect(atob(link.slice('#backtest='.length).replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('secret');
      expect(parseHandoff(link)).toEqual(h);
      expect(sweepHandoff(candidate({ fast: 8, slow: 34, direction: 1 }), risk)).not.toHaveProperty('pineRoles');
    });

    it('names the indicator in the toast text', () => {
      expect(handoffSettingsText(sweepHandoff(withRoles(), risk))).toContain('TradingView "Two SMAs" fast crosses slow, fast 5, slow 50');
    });

    it('a link with malformed roles drops them, and a plain link has none', () => {
      const h = sweepHandoff(withRoles(), risk);
      const link = (patch: object) => encodeHandoff({ ...h, ...patch } as never);
      expect(parseHandoff(link({ pineRoles: [{ indicatorId: '', name: 'x' }] }))).not.toHaveProperty('pineRoles');
      expect(parseHandoff(link({ pineRoles: 'nope' }))).not.toHaveProperty('pineRoles');
      expect(parseHandoff(link({ pineRoles: [...roleOf()!, ...roleOf()!] }))).not.toHaveProperty('pineRoles'); // two entries
      expect(parseHandoff(link({ pineRoles: [{ ...roleOf()![0], rule: { type: 'above' } }] }))).not.toHaveProperty('pineRoles');
      expect(parseHandoff(link({ pineRoles: undefined }))).toMatchObject({ strategyId: 'composed' });
    });

    it('a Backtest tab filled from a search row, with the sources put back, takes the row\'s trades', async () => {
      const data = synth(4000, 7);
      const result = await runSweep(
        {
          markets: [{ provider: 'yahoo', symbol: 'AAA' }],
          timeframes: ['1d'],
          families: [],
          direction: 'long',
          targetSets: [{ minHitRatePct: 0 }],
          risk,
          exits: { stopMults: [1, 2], tpMults: [1, 2] },
          composed: {
            entryRules: [],
            filters: [],
            trendTfs: [],
            pine: [
              { role: roleOf()![0], ranges: [{ input: 'Slow', from: 50, to: 100, step: 50 }] },
              { role: { ...roleOf()![1], inputs: { Fast: 5 } }, ranges: [{ input: 'Slow', from: 50, to: 100, step: 50 }] },
            ],
            pineSources: { sma2: SMA_CROSS },
          },
        },
        async () => data,
      );
      const rows = result.candidates.filter((c) => c.pineRoles!.length === 2);
      expect(rows.length).toBeGreaterThan(0);
      const cut = Math.floor((data.length * SELECTION_PCT) / 100);
      for (const c of rows.slice(0, 3)) {
        const h = parseHandoff(encodeHandoff(sweepHandoff(c, risk)))!;
        const filled: BacktestConfig = {
          ...sweepConfig(risk, 'x', {}, c.exit!),
          strategyId: h.strategyId, params: h.params, feeBps: h.feeBps, slippageBps: h.slippageBps, stopLossPct: h.stopLossPct, takeProfitPct: h.takeProfitPct,
          allowShort: h.allowShort, initialCapital: h.initialCapital, positionSizePct: h.positionSizePct, riskPct: h.riskPct, ...exitsOfLink(h),
          pineRoles: h.pineRoles!.map((r) => ({ ...r, source: SMA_CROSS })),
          market: { providerId: h.providerId!, symbol: h.symbol!, interval: h.timeframe },
        };
        const run = await runAnyBacktest(data.slice(0, cut), filled);
        expect(run.trades.length).toBe(c.selection.trades);
        expect(run.equity[run.equity.length - 1].equity).toBe(c.selection.finalEquity);
        // And without the indicator roles it would be another strategy.
        expect(c.selection.trades).toBeGreaterThan(0);
      }
    }, 120_000);
  });
});
