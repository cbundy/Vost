import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../lib/backtest/engine';
import { buildSignals } from '../lib/backtest/strategies';
import type { BacktestConfig } from '../lib/backtest/types';
import { candlesFromCsvText } from '../lib/csv';
import { encodeHandoff, parseHandoff } from '../lib/backtestHandoff';
import { sweepConfig } from './sweep/sweep';
import type { PartFigures, SweepCandidate, SweepRisk } from './sweep/types';
import { sweepHandoff } from './sweepHandoff';

const candles = candlesFromCsvText(readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8')).candles;
const risk: SweepRisk = { initialCapital: 1000, riskPct: 2, feeBps: 10, slippageBps: 5 };
const figures: PartFigures = { trades: 40, signalsFired: 50, signalsPer100Bars: 5, signalsPerDay: 1, totalReturnPct: 10, winRatePct: 60, rr: 1.5, maxDrawdownPct: 8, finalEquity: 1100 };
const candidate = (params: Record<string, number>): SweepCandidate => ({
  market: { provider: 'yahoo', symbol: 'AAPL' },
  timeframe: '1w',
  strategyId: 'sma_cross',
  params,
  stopLossPct: 2.123456789,
  takeProfitPct: 4.246913578,
  setIndex: 0,
  held: true,
  selection: figures,
  heldOut: figures,
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
      expect(sweepHandoff(c, risk).allowShort).toBe(sweepConfig(risk, c.strategyId, c.params, 2, 4).allowShort);
    }
  });

  it('a Backtest tab filled from it (as applyBacktestHandoff fills it) takes the trades the search took', () => {
    for (const direction of [1, 3]) {
      const c = candidate({ fast: 8, slow: 34, direction });
      const h = parseHandoff(encodeHandoff(sweepHandoff(c, risk)))!;
      const filled = { ...sweepConfig(risk, 'x', {}, 1, 1), strategyId: h.strategyId, params: h.params, feeBps: h.feeBps, slippageBps: h.slippageBps, stopLossPct: h.stopLossPct, takeProfitPct: h.takeProfitPct, allowShort: h.allowShort, initialCapital: h.initialCapital, positionSizePct: h.positionSizePct, riskPct: h.riskPct };
      const run = (config: BacktestConfig) =>
        runBacktest(candles, buildSignals(candles, 'sma_cross', c.params), config).trades.map((t) => [t.side, t.entryBar, t.exitBar, t.entryPrice, t.exitPrice, t.pnl]);
      const searched = run(sweepConfig(risk, c.strategyId, c.params, c.stopLossPct, c.takeProfitPct));
      expect(searched.length).toBeGreaterThan(0);
      expect(run(filled)).toEqual(searched);
    }
  });
});
