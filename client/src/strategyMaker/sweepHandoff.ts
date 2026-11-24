import { withoutSources, type PineRole } from '../lib/backtest/pineRole';
import { defaultBacktestConfig } from '../lib/backtest/types';
import type { Handoff } from '../lib/backtestHandoff';
import { exitOfCandidate } from './sweep/exits';
import type { SweepCandidate, SweepExit, SweepRisk } from './sweep/types';

/** The label of a result's market, for the hand-off's source and the table. */
export const marketLabel = (c: Pick<SweepCandidate, 'market' | 'timeframe'>): string => `${c.market.symbol} ${c.timeframe}`;

/** The exit fields of the link: the exit's settings, with the percents null when it sets none. */
function handoffExit(x: SweepExit): Pick<Handoff, 'stopLossPct' | 'takeProfitPct'> & Partial<Handoff> {
  const { stopLossPct, takeProfitPct, ...modes } = x.config;
  return { ...modes, stopLossPct: stopLossPct ?? null, takeProfitPct: takeProfitPct ?? null } as Pick<Handoff, 'stopLossPct' | 'takeProfitPct'> & Partial<Handoff>;
}

/** What the main app needs to open a search result on its market and timeframe with the sizing it was tried with (matches `sweepConfig`). */
export function sweepHandoff(c: SweepCandidate, risk: SweepRisk): Handoff {
  const cfg = defaultBacktestConfig();
  const exit = exitOfCandidate(c);
  // A TradingView indicator stop is one more role of the run; its R target comes with the exit's settings.
  const roles = [...(c.pineRoles ?? []), ...(exit.pineStop ? [exit.pineStop as PineRole] : [])];
  return {
    v: 1,
    strategyId: c.strategyId,
    params: c.params,
    feeBps: risk.feeBps,
    slippageBps: risk.slippageBps,
    ...handoffExit(exit),
    allowShort: (c.params.direction ?? 1) !== 1,
    ...(roles.length && { pineRoles: withoutSources(roles) }),
    initialCapital: risk.initialCapital,
    positionSizePct: cfg.positionSizePct,
    riskPct: risk.riskPct,
    providerId: c.market.provider,
    symbol: c.market.symbol,
    timeframe: c.timeframe,
    source: `${marketLabel(c)} (market search)`,
  };
}
