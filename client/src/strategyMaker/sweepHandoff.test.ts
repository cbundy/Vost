import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../lib/backtest/engine';
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
});
