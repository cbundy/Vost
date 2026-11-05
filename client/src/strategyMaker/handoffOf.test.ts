import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../lib/backtest/engine';
import { buildSignals } from '../lib/backtest/strategies';
import { candlesFromCsvText } from '../lib/csv';
import { encodeHandoff, parseHandoff } from '../lib/backtestHandoff';
import { handoffOf } from './handoffOf';
import { configFor, tradesOf, type FindInputs } from './run';

const candles = candlesFromCsvText(readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8')).candles;
const run: Pick<FindInputs, 'direction' | 'risk'> = { direction: 'both', risk: { feeBps: 10, slippageBps: 5, stopLossPct: 2, takeProfitPct: 4 } };
const candidate = { strategyId: 'sma_cross', params: { fast: 8, slow: 34, direction: 3 } };

describe('handoffOf', () => {
  it('survives the address and carries the run config', () => {
    const h = handoffOf(candidate, run, 'sample');
    expect(parseHandoff(encodeHandoff(h))).toEqual(h);
    expect(h).toMatchObject({ feeBps: 10, slippageBps: 5, stopLossPct: 2, takeProfitPct: 4, allowShort: true, initialCapital: 10000, positionSizePct: 100, source: 'sample' });
    expect(handoffOf(candidate, { ...run, direction: 'long' }, '').allowShort).toBe(false);
  });
  it('a Backtest tab filled from it takes the trades the strategy maker draws', () => {
    const h = parseHandoff(encodeHandoff(handoffOf(candidate, run, 'sample')))!;
    const filled = { ...configFor(run), strategyId: h.strategyId, params: h.params, feeBps: h.feeBps, slippageBps: h.slippageBps, stopLossPct: h.stopLossPct, takeProfitPct: h.takeProfitPct, allowShort: h.allowShort, initialCapital: h.initialCapital, positionSizePct: h.positionSizePct };
    const mine = runBacktest(candles, buildSignals(candles, h.strategyId, h.params), filled).trades.map((t) => ({ side: t.side, entryTime: t.entryTime, exitTime: t.exitTime, entryPrice: t.entryPrice, exitPrice: t.exitPrice }));
    const shown = tradesOf(candles, candidate.strategyId, candidate.params, run);
    expect(shown.length).toBeGreaterThan(0);
    expect(mine).toEqual(shown);
  });
});
