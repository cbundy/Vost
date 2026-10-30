import { useMemo } from 'react';
import { computeBreakdown, type SideStats } from '../lib/backtest/breakdown';
import type { Trade } from '../lib/backtest/types';
import { fmtMoney, fmtNum, fmtPct, pnlClass } from '../lib/format';
import { REASONS } from './TradesTable';

const pf = (v: number | null) => (v === Number.POSITIVE_INFINITY ? '∞' : fmtNum(v, 2));

interface Row {
  label: string;
  cell: (s: SideStats) => string;
  cls?: (s: SideStats) => string;
}

const ROWS: Row[] = [
  { label: 'Trades', cell: (s) => fmtNum(s.trades, 0) },
  { label: 'Wins', cell: (s) => fmtNum(s.wins, 0) },
  { label: 'Losses', cell: (s) => fmtNum(s.losses, 0) },
  { label: 'Win rate', cell: (s) => fmtPct(s.winRatePct, 1) },
  { label: 'Net P/L', cell: (s) => fmtMoney(s.trades > 0 ? s.netPnl : null), cls: (s) => pnlClass(s.netPnl) },
  { label: 'Gross profit', cell: (s) => fmtMoney(s.trades > 0 ? s.grossProfit : null) },
  { label: 'Gross loss', cell: (s) => fmtMoney(s.trades > 0 ? s.grossLoss : null) },
  { label: 'Profit factor', cell: (s) => pf(s.profitFactor) },
  { label: 'Avg trade', cell: (s) => fmtPct(s.avgTradePct), cls: (s) => pnlClass(s.avgTradePct) },
  { label: 'Best trade', cell: (s) => fmtPct(s.bestTradePct), cls: (s) => pnlClass(s.bestTradePct) },
  { label: 'Worst trade', cell: (s) => fmtPct(s.worstTradePct), cls: (s) => pnlClass(s.worstTradePct) },
  { label: 'Avg bars', cell: (s) => fmtNum(s.avgBars, 1) },
];

function StreakCard({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="metric-card">
      <div className="m-label">{label}</div>
      <div className={`m-value ${className ?? ''}`}>{value}</div>
      {sub && <div className="m-label" style={{ marginTop: 3, marginBottom: 0 }}>{sub}</div>}
    </div>
  );
}

export function BreakdownTables({ trades }: { trades: Trade[] }) {
  const b = useMemo(() => computeBreakdown(trades), [trades]);
  if (trades.length === 0) {
    return <div className="hint mb-3">No trades, so there is no long versus short, streak or exit reason breakdown.</div>;
  }
  const { longestWin, longestLoss, current } = b.streaks;
  return (
    <div className="mb-3">
      <div className="section-title">Long vs short</div>
      <div className="table-wrap mb-3">
        <table className="data-table">
          <thead>
            <tr>
              <th />
              <th>All</th>
              <th>Long</th>
              <th>Short</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                {[b.all, b.long, b.short].map((s, i) => (
                  <td key={i} className={r.cls?.(s) ?? ''}>
                    {r.cell(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Streaks</div>
      <div className="metrics-grid mb-3">
        <StreakCard
          label="Longest win streak"
          value={longestWin ? `${longestWin.count} trades` : '—'}
          sub={longestWin ? fmtMoney(longestWin.pnl) : undefined}
          className="pos"
        />
        <StreakCard
          label="Longest loss streak"
          value={longestLoss ? `${longestLoss.count} trades` : '—'}
          sub={longestLoss ? fmtMoney(longestLoss.pnl) : undefined}
          className="neg"
        />
        <StreakCard
          label="Current streak"
          value={current ? `${current.count} ${current.kind === 'win' ? 'wins' : 'losses'}` : '—'}
          className={current ? (current.kind === 'win' ? 'pos' : 'neg') : ''}
        />
      </div>

      <div className="section-title">Exit reasons</div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Reason</th>
              <th>Trades</th>
              <th>Share</th>
              <th>Net P/L</th>
              <th>Win rate</th>
            </tr>
          </thead>
          <tbody>
            {b.exitReasons.map((r) => (
              <tr key={r.reason}>
                <td>{REASONS[r.reason]}</td>
                <td>{fmtNum(r.count, 0)}</td>
                <td>{r.sharePct.toFixed(1)}%</td>
                <td className={pnlClass(r.netPnl)}>{fmtMoney(r.netPnl)}</td>
                <td>{fmtPct(r.winRatePct, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
