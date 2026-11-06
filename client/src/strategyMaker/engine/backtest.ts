/** Backtests one candidate over parts of the series and pools the figures. */
import { runBacktest } from '../../lib/backtest/engine';
import { computeMetrics, medianBarSeconds, signalRates } from '../../lib/backtest/metrics';
import { buildSignals } from '../../lib/backtest/strategies';
import type { BacktestConfig, Metrics, Trade } from '../../lib/backtest/types';
import type { Candle } from '../../types';
import type { CandidateStats, Gap, Targets } from './types';

export interface PartRun {
  stats: CandidateStats;
  trades: Trade[];
  /** Metrics of the first part that could run; only a carrier for the optimizer row type. */
  lead: Metrics | null;
}

/**
 * Backtests the candidate on each part (a part under 2 bars is skipped) and pools: return is the mean of the parts,
 * drawdown the worst, win rate and R:R come from all trades together.
 */
export function runParts(parts: Candle[][], base: BacktestConfig, strategyId: string, params: Record<string, number>): PartRun {
  const config: BacktestConfig = { ...base, strategyId, params };
  const trades: Trade[] = [];
  let ret = 0;
  let dd = 0;
  let ran = 0;
  let fired = 0;
  let bars = 0;
  let seconds = 0;
  let lead: Metrics | null = null;
  for (const candles of parts) {
    if (candles.length < 2) continue;
    const out = runBacktest(candles, buildSignals(candles, strategyId, params), config);
    const m = computeMetrics(candles, out.equity, out.trades, config.initialCapital, out.exposureBars, out.signalsFired);
    lead ??= m;
    ret += m.totalReturnPct;
    dd = Math.max(dd, Math.abs(m.maxDrawdownPct));
    ran++;
    fired += out.signalsFired;
    bars += out.equity.length;
    seconds += out.equity.length * medianBarSeconds(out.equity);
    trades.push(...out.trades);
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0) / losses.length) : 0;
  const rates = ran ? signalRates(fired, bars, seconds) : { signalsPer100Bars: null, signalsPerDay: null };
  return {
    trades,
    lead,
    stats: {
      trades: trades.length,
      signalsFired: ran ? fired : null,
      ...rates,
      totalReturnPct: ran ? ret / ran : 0,
      winRatePct: trades.length ? (wins.length / trades.length) * 100 : null,
      rr: avgLoss > 0 ? avgWin / avgLoss : null,
      maxDrawdownPct: dd,
    },
  };
}

const fmt = (v: number | null, d = 1): string => (v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(d));

/** What the stats miss the targets by; empty when every set target is met. No trades misses every set target. */
export function gapsOf(stats: CandidateStats, targets: Targets): Gap[] {
  const gaps: Gap[] = [];
  if (targets.minRR != null && !(stats.rr != null && stats.rr >= targets.minRR)) {
    gaps.push({ metric: 'minRR', actual: stats.rr, target: targets.minRR, text: `minRR ${fmt(stats.rr, 2)} < ${targets.minRR}` });
  }
  if (targets.minHitRatePct != null && !(stats.winRatePct != null && stats.winRatePct >= targets.minHitRatePct)) {
    gaps.push({
      metric: 'minHitRatePct',
      actual: stats.winRatePct,
      target: targets.minHitRatePct,
      text: `minHitRatePct ${fmt(stats.winRatePct)} < ${targets.minHitRatePct}`,
    });
  }
  if (targets.maxDrawdownPct != null && stats.maxDrawdownPct > targets.maxDrawdownPct) {
    gaps.push({
      metric: 'maxDrawdownPct',
      actual: stats.maxDrawdownPct,
      target: targets.maxDrawdownPct,
      text: `maxDrawdownPct ${fmt(stats.maxDrawdownPct)} > ${targets.maxDrawdownPct}`,
    });
  }
  return gaps;
}

/** How far a candidate is from its targets: the sum of each gap relative to its target (a missing figure counts 1). */
export function gapSize(gaps: Gap[]): number {
  let s = 0;
  for (const g of gaps) s += g.actual == null ? 1 : Math.abs(g.actual - g.target) / Math.max(Math.abs(g.target), 1e-9);
  return s;
}
