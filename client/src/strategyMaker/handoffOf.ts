import { defaultBacktestConfig } from '../lib/backtest/types';
import type { Handoff } from '../lib/backtestHandoff';
import type { Candidate } from './engine';
import type { FindInputs } from './run';

/** What the main app's Backtest tab needs to take the trades this result took. */
export function handoffOf(c: Pick<Candidate, 'strategyId' | 'params'>, run: Pick<FindInputs, 'direction' | 'risk'>, source: string): Handoff {
  const cfg = defaultBacktestConfig();
  return {
    v: 1,
    strategyId: c.strategyId,
    params: c.params,
    feeBps: run.risk.feeBps,
    slippageBps: run.risk.slippageBps,
    stopLossPct: run.risk.stopLossPct,
    takeProfitPct: run.risk.takeProfitPct,
    allowShort: run.direction !== 'long',
    initialCapital: cfg.initialCapital,
    positionSizePct: cfg.positionSizePct,
    source,
  };
}
