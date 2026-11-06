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

describe('handoffOf with risk sizing', () => {
  it('passes riskPct through, and writes nothing without it', () => {
    const withRisk = handoffOf(candidate, { ...run, risk: { ...run.risk, riskPct: 2 } }, 'sample');
    expect(withRisk.riskPct).toBe(2);
    expect(parseHandoff(encodeHandoff(withRisk))).toEqual(withRisk);
    expect('riskPct' in handoffOf(candidate, run, 'sample')).toBe(false);
  });
  it('configFor carries riskPct to the engine config', () => {
    expect(configFor({ ...run, risk: { ...run.risk, riskPct: 2 } }).riskPct).toBe(2);
    expect(configFor(run).riskPct).toBeUndefined();
  });
});

describe('handoffOf with exits', () => {
  const exits: Pick<FindInputs, 'direction' | 'risk'> = {
    direction: 'both',
    risk: { feeBps: 10, slippageBps: 5, stopLossPct: null, takeProfitPct: null, stopMode: 'atr', stopAtrMult: 2, takeProfitMode: 'r', takeProfitR: 2, trailMode: 'atr', trailAtrMult: 3, atrLength: 10 },
  };
  it('carries the exits through the address', () => {
    const h = handoffOf(candidate, exits, 'sample');
    expect(h).toMatchObject({ stopMode: 'atr', stopAtrMult: 2, takeProfitMode: 'r', takeProfitR: 2, trailMode: 'atr', trailAtrMult: 3, atrLength: 10 });
    expect(parseHandoff(encodeHandoff(h))).toEqual(h);
  });
  it('writes no exit key with the options off, and no atrLength without an ATR mode', () => {
    const off = handoffOf(candidate, run, 'sample');
    for (const k of ['stopMode', 'stopAtrMult', 'takeProfitMode', 'takeProfitAtrMult', 'takeProfitR', 'trailMode', 'trailPct', 'trailAtrMult', 'atrLength']) expect(k in off).toBe(false);
    const pctTrail = handoffOf(candidate, { ...run, risk: { ...run.risk, trailMode: 'pct', trailPct: 2, atrLength: 20 } }, 'sample');
    expect(pctTrail).toMatchObject({ trailMode: 'pct', trailPct: 2 });
    expect('atrLength' in pctTrail).toBe(false);
  });
  it('a Backtest tab filled from the link takes the trades the strategy maker draws', () => {
    const h = parseHandoff(encodeHandoff(handoffOf(candidate, exits, 'sample')))!;
    const { v, source, providerId, symbol, timeframe, ...rest } = h as typeof h & Record<string, unknown>;
    void v; void source; void providerId; void symbol; void timeframe;
    const filled = { ...configFor({ direction: 'both', risk: { feeBps: 0, slippageBps: 0, stopLossPct: null, takeProfitPct: null } }), ...rest };
    const mine = runBacktest(candles, buildSignals(candles, h.strategyId, h.params), filled).trades.map((t) => ({ side: t.side, entryTime: t.entryTime, exitTime: t.exitTime, entryPrice: t.entryPrice, exitPrice: t.exitPrice }));
    const shown = tradesOf(candles, candidate.strategyId, candidate.params, exits);
    expect(shown.length).toBeGreaterThan(0);
    expect(mine).toEqual(shown);
    const plain = tradesOf(candles, candidate.strategyId, candidate.params, { ...exits, risk: { feeBps: 10, slippageBps: 5, stopLossPct: null, takeProfitPct: null } });
    expect(shown).not.toEqual(plain);
  });
  it('configFor carries the exits to the engine config', () => {
    expect(configFor(exits)).toMatchObject({ stopMode: 'atr', stopAtrMult: 2, trailMode: 'atr', trailAtrMult: 3, atrLength: 10 });
  });
});
