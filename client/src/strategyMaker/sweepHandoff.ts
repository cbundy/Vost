import { defaultBacktestConfig } from '../lib/backtest/types';
import type { Handoff } from '../lib/backtestHandoff';
import type { SweepCandidate, SweepRisk } from './sweep/types';

/** The label of a result's market, for the hand-off's source and the table. */
export const marketLabel = (c: Pick<SweepCandidate, 'market' | 'timeframe'>): string => `${c.market.symbol} ${c.timeframe}`;

/** What the main app needs to open a search result on its market and timeframe with the sizing it was tried with (matches `sweepConfig`). */
export function sweepHandoff(c: SweepCandidate, risk: SweepRisk): Handoff {
  const cfg = defaultBacktestConfig();
  return {
    v: 1,
    strategyId: c.strategyId,
    params: c.params,
    feeBps: risk.feeBps,
    slippageBps: risk.slippageBps,
    stopLossPct: c.stopLossPct,
    takeProfitPct: c.takeProfitPct,
    allowShort: (c.params.direction ?? 1) !== 1,
    initialCapital: risk.initialCapital,
    positionSizePct: cfg.positionSizePct,
    riskPct: risk.riskPct,
    providerId: c.market.provider,
    symbol: c.market.symbol,
    timeframe: c.timeframe,
    source: `${marketLabel(c)} (market search)`,
  };
}
