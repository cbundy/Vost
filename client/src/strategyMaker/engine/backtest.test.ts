import { describe, expect, it } from 'vitest';
import { runBacktest } from '../../lib/backtest/engine';
import { signalRates } from '../../lib/backtest/metrics';
import { buildSignals } from '../../lib/backtest/strategies';
import { defaultBacktestConfig } from '../../lib/backtest/types';
import { runParts } from './backtest';
import { synth } from './synthetic';

const base = { ...defaultBacktestConfig(), feeBps: 0, slippageBps: 0 };
const params = { fast: 8, slow: 34 };

describe('runParts signals', () => {
  it('pools fired and bars as sums over the parts', () => {
    const a = synth(600, 1);
    const b = synth(900, 2);
    const fired = (c: typeof a) => runBacktest(c, buildSignals(c, 'sma_cross', params), { ...base, strategyId: 'sma_cross', params }).signalsFired;
    const stats = runParts([a, b], base, 'sma_cross', params).stats;
    const total = fired(a) + fired(b);
    expect(stats.signalsFired).toBe(total);
    expect(stats.signalsPer100Bars).toBeCloseTo((total / 1500) * 100, 9);
    const step = a[1].time - a[0].time;
    expect(stats.signalsPerDay).toBeCloseTo(signalRates(total, 1500, 1500 * step).signalsPerDay!, 6);
    expect(stats.signalsFired!).toBeGreaterThanOrEqual(stats.trades);
  });

  it('is null when no part ran', () => {
    const s = runParts([[]], base, 'sma_cross', params).stats;
    expect([s.signalsFired, s.signalsPer100Bars, s.signalsPerDay]).toEqual([null, null, null]);
  });
});
