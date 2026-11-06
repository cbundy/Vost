import { defaultBacktestConfig } from '../lib/backtest/types';
import { HANDOFF_EXIT_KEYS, type Handoff } from '../lib/backtestHandoff';
import { ATR_TIMEFRAME_MULTIPLES } from '../lib/backtest/higherTimeframe';
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
    ...(run.risk.riskPct != null && { riskPct: run.risk.riskPct }),
    ...exitFields(run.risk),
    source,
  };
}

/** The volatility exits that are set and that the link accepts; none when every option is off. */
function exitFields(risk: Pick<FindInputs, 'risk'>['risk']): Partial<Handoff> {
  const out: Record<string, unknown> = {};
  const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const allowed: Record<string, readonly unknown[]> = { stopMode: ['atr'], takeProfitMode: ['atr', 'r'], trailMode: ['pct', 'atr'] };
  for (const k of HANDOFF_EXIT_KEYS) {
    const v = risk[k];
    if (v == null) continue;
    if (k in allowed ? allowed[k].includes(v) : k === 'atrLength' ? Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 500 : k === 'atrTimeframe' ? (ATR_TIMEFRAME_MULTIPLES as readonly unknown[]).includes(v) && v !== 1 : pos(v)) out[k] = v;
  }
  const atrOn = out.stopMode === 'atr' || out.takeProfitMode === 'atr' || out.trailMode === 'atr';
  if (!atrOn) {
    delete out.atrLength;
    delete out.atrTimeframe;
  }
  return out as Partial<Handoff>;
}
