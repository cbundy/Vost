/**
 * Trade breakdown for the Results tab: long versus short figures, win and
 * loss streaks and a count by exit reason. Pure, read-only figures computed
 * from a run's trades; it is kept out of `Metrics` on purpose.
 */
import type { ExitReason, Trade } from './types';

/** A win is a trade with a profit; a zero or negative P/L is a loss (same rule as metrics.ts). */
export function isWin(t: Trade): boolean {
  return t.pnl > 0;
}

export interface SideStats {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  avgTradePct: number | null;
  bestTradePct: number | null;
  worstTradePct: number | null;
  avgBars: number | null;
}

export interface Streak {
  /** Consecutive trades, in exit order. */
  count: number;
  /** Summed P/L of those trades. */
  pnl: number;
}

export interface CurrentStreak {
  kind: 'win' | 'loss';
  count: number;
}

export interface Streaks {
  longestWin: Streak | null;
  longestLoss: Streak | null;
  current: CurrentStreak | null;
}

export interface ExitReasonRow {
  reason: ExitReason;
  count: number;
  sharePct: number;
  netPnl: number;
  winRatePct: number;
}

export interface Breakdown {
  all: SideStats;
  long: SideStats;
  short: SideStats;
  streaks: Streaks;
  exitReasons: ExitReasonRow[];
}

export const EXIT_REASON_ORDER: ExitReason[] = ['signal', 'stop_loss', 'take_profit', 'end_of_data'];

function mean(xs: number[]): number | null {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function sideStats(trades: Trade[]): SideStats {
  const wins = trades.filter(isWin);
  const losses = trades.filter((t) => !isWin(t));
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor =
    trades.length === 0 ? null : grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null;
  const pcts = trades.map((t) => t.pnlPct);
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length > 0 ? (wins.length / trades.length) * 100 : null,
    netPnl: trades.reduce((a, t) => a + t.pnl, 0),
    grossProfit,
    grossLoss,
    profitFactor,
    avgTradePct: mean(pcts),
    bestTradePct: pcts.length > 0 ? Math.max(...pcts) : null,
    worstTradePct: pcts.length > 0 ? Math.min(...pcts) : null,
    avgBars: mean(trades.map((t) => t.bars)),
  };
}

function computeStreaks(trades: Trade[]): Streaks {
  let longestWin: Streak | null = null;
  let longestLoss: Streak | null = null;
  let runKind: 'win' | 'loss' | null = null;
  let runCount = 0;
  let runPnl = 0;
  const close = () => {
    if (runKind === 'win' && (!longestWin || runCount > longestWin.count)) longestWin = { count: runCount, pnl: runPnl };
    if (runKind === 'loss' && (!longestLoss || runCount > longestLoss.count)) longestLoss = { count: runCount, pnl: runPnl };
  };
  for (const t of trades) {
    const kind = isWin(t) ? 'win' : 'loss';
    if (kind !== runKind) {
      close();
      runKind = kind;
      runCount = 0;
      runPnl = 0;
    }
    runCount++;
    runPnl += t.pnl;
  }
  close();
  return { longestWin, longestLoss, current: runKind ? { kind: runKind, count: runCount } : null };
}

export function computeBreakdown(trades: Trade[]): Breakdown {
  const ordered = [...trades].sort((a, b) => a.exitBar - b.exitBar || a.id - b.id);
  const exitReasons: ExitReasonRow[] = [];
  for (const reason of EXIT_REASON_ORDER) {
    const group = ordered.filter((t) => t.exitReason === reason);
    if (group.length === 0) continue;
    exitReasons.push({
      reason,
      count: group.length,
      sharePct: (group.length / ordered.length) * 100,
      netPnl: group.reduce((a, t) => a + t.pnl, 0),
      winRatePct: (group.filter(isWin).length / group.length) * 100,
    });
  }
  return {
    all: sideStats(ordered),
    long: sideStats(ordered.filter((t) => t.side === 'long')),
    short: sideStats(ordered.filter((t) => t.side === 'short')),
    streaks: computeStreaks(ordered),
    exitReasons,
  };
}
