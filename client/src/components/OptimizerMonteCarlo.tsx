import { useMemo, useState } from 'react';
import { METRIC_LABELS, type MetricKey, type OptimizeRow } from '../lib/backtest/optimizer';
import { mcColumnValue, sortMcChecks, type McCheck, type McColumn, type MonteCarloValidationOutput } from '../lib/backtest/optimizerMonteCarlo';
import { formatMetric } from '../lib/backtest/optimizerTable';
import { MC_MIN_TRADES } from '../lib/backtest/monteCarlo';
import { fmtNum, fmtPct, pnlClass } from '../lib/format';

type Dir = 'asc' | 'desc';

const FIGURES: Array<{ id: McColumn; label: string; format: (v: number | null) => string; pnl?: boolean }> = [
  { id: 'returnP5', label: 'Final return 5th', format: (v) => fmtPct(v), pnl: true },
  { id: 'returnP50', label: 'Final return median', format: (v) => fmtPct(v), pnl: true },
  { id: 'returnP95', label: 'Final return 95th', format: (v) => fmtPct(v), pnl: true },
  { id: 'drawdownP5', label: 'Max drawdown 5th', format: (v) => fmtPct(v) },
  { id: 'drawdownP50', label: 'Max drawdown median', format: (v) => fmtPct(v) },
  { id: 'drawdownP95', label: 'Max drawdown 95th', format: (v) => fmtPct(v) },
  { id: 'probLoss', label: 'Chance of a loss', format: (v) => fmtPct(v, 1) },
];

/** The Monte Carlo check: one sortable row per checked result with the spread of its simulated outcomes. */
export function MonteCarloChecks({
  validation,
  rows,
  keys,
  metric,
  onApply,
}: {
  validation: MonteCarloValidationOutput;
  rows: OptimizeRow[];
  keys: string[];
  metric: MetricKey;
  onApply: (row: OptimizeRow) => void;
}) {
  const [sort, setSort] = useState<{ column: McColumn; dir: Dir }>({ column: 'rank', dir: 'asc' });
  const sorted = useMemo(() => sortMcChecks(validation.checks, sort.column, sort.dir), [validation.checks, sort]);
  const onSort = (column: McColumn) => setSort((s) => ({ column, dir: s.column === column ? (s.dir === 'asc' ? 'desc' : 'asc') : 'asc' }));
  const header = (column: McColumn, label: string, extra?: React.CSSProperties) => (
    <th key={column} aria-sort={sort.column === column ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="sortable" style={extra}>
      <button type="button" className="sort-btn" onClick={() => onSort(column)}>
        {label}
        {sort.column === column && <span aria-hidden="true">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  );
  return (
    <div className="mb-3">
      <div className="row mb-2 wrap">
        <span className="section-title" style={{ margin: 0 }}>
          Monte Carlo · {METRIC_LABELS[metric]}
        </span>
        {validation.failed > 0 && <span className="badge red">{validation.failed} failed</span>}
      </div>
      <div className="hint mb-2">
        {validation.iterations.toLocaleString('en-US')} runs · {validation.mcMethod === 'shuffle' ? 'shuffled trade order' : 'resampled trades'} · seed {validation.seed}
      </div>
      {validation.checks.length === 0 ? (
        <div className="hint">No result had a ranking value to check.</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table className="data-table">
            <thead>
              <tr>
                {header('rank', 'Rank')}
                {keys.map((k) => (
                  <th key={k}>{k}</th>
                ))}
                {header('value', METRIC_LABELS[metric], { color: 'var(--accent-2)' })}
                {header('trades', 'Trades')}
                {FIGURES.map((f) => header(f.id, f.label))}
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.rank}>
                  <td>{c.rank}</td>
                  {keys.map((k) => (
                    <td key={k}>{c.params[k] ?? '—'}</td>
                  ))}
                  <td style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{formatMetric(metric, c.value)}</td>
                  <td>{c.trades == null ? '—' : fmtNum(c.trades, 0)}</td>
                  {c.result ? (
                    FIGURES.map((f) => {
                      const v = mcColumnValue(c, f.id);
                      return (
                        <td key={f.id} className={f.pnl ? pnlClass(v) : f.id.startsWith('drawdown') ? 'neg' : undefined}>
                          {f.format(v)}
                        </td>
                      );
                    })
                  ) : (
                    <td colSpan={FIGURES.length} className="hint">
                      {c.status === 'failed' ? 'failed' : `needs at least ${MC_MIN_TRADES} trades`}
                    </td>
                  )}
                  <td>
                    <button className="ghost" onClick={() => onApply(rows[c.rank - 1])} title="Apply these parameters and run the backtest">
                      Apply
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
