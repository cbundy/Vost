import { useMemo, useState } from 'react';
import { METRIC_LABELS, type MetricKey, type OptimizeRow } from '../lib/backtest/optimizer';
import { optimizeResultToCsv, optimizerCsvFileName } from '../lib/backtest/optimizerCsv';
import {
  firstDirection,
  formatMetric,
  METRIC_COLUMNS,
  pageOf,
  paramColumnId,
  sortOptimizeRows,
  type ColumnId,
  type SortDir,
} from '../lib/backtest/optimizerTable';
import { finiteBounds, type RobustnessScore } from '../lib/backtest/robustness';
import { downloadFile } from '../lib/export';
import { fmtNum, pnlClass } from '../lib/format';
import type { ChartState } from '../state/chart';
import { Heatmap } from './OptimizerHeatmap';
import { HeldOutCheck } from './OptimizerValidation';

type Result = NonNullable<ChartState['optResult']>;

/** The finished run: title, export, the full sortable paged table, and the heatmap below it. */
export function OptimizerResults({ result, onApply }: { result: Result; onApply: (row: OptimizeRow) => void }) {
  const rob = result.validation?.method === 'robustness' ? result.validation : null;
  const split = result.validation?.method === 'split' ? result.validation : null;
  const scores = rob?.scores;
  const [sort, setSort] = useState<{ column: ColumnId; dir: SortDir }>(
    rob?.rankByScore ? { column: 'robustness', dir: 'desc' } : { column: 'rank', dir: 'asc' },
  );
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => sortOptimizeRows(result.rows, sort.column, sort.dir, scores), [result.rows, sort, scores]);
  const bounds = useMemo(() => (rob ? finiteBounds(result.rows) : null), [rob, result.rows]);
  // The most robust result: first by robustness, higher first; ties keep the metric order.
  const robustBest = useMemo(() => {
    if (!scores) return null;
    const top = sortOptimizeRows(result.rows, 'robustness', 'desc', scores)[0];
    return top && scores[top.rank - 1].robustness != null ? top.row : null;
  }, [result.rows, scores]);
  const robustScore = robustBest && scores ? scores[result.rows.indexOf(robustBest)].robustness : null;
  const pg = pageOf(sorted, page);
  const metric = result.metric;

  const onSort = (column: ColumnId) => {
    setSort((s) => ({ column, dir: s.column === column ? (s.dir === 'asc' ? 'desc' : 'asc') : firstDirection(column) }));
    setPage(0);
  };
  const header = (column: ColumnId, label: string, extra?: React.CSSProperties) => (
    <th
      key={column}
      aria-sort={sort.column === column ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="sortable"
      style={extra}
    >
      <button type="button" className="sort-btn" onClick={() => onSort(column)}>
        {label}
        {sort.column === column && <span aria-hidden="true">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  );

  return (
    <div className="mt-3">
      <div className="row mb-2 wrap">
        <span className="section-title" style={{ margin: 0 }}>
          Results{split ? ' (in-sample)' : ''} · {METRIC_LABELS[metric]}
        </span>
        <span className="badge">{result.combos} combos</span>
        {rob && (
          <span className="hint">
            Neighbours: results within {rob.radius} step{rob.radius === 1 ? '' : 's'} in every parameter
          </span>
        )}
        {result.errored > 0 && <span className="badge red">{result.errored} failed</span>}
        <button
          className="ghost"
          style={{ marginLeft: 'auto' }}
          onClick={() => downloadFile(optimizerCsvFileName(result.context), optimizeResultToCsv(result, result.context))}
          title="Download every combination with its measures, and the settings the run used"
        >
          Export results CSV
        </button>
      </div>

      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="data-table">
          <thead>
            <tr>
              {header('rank', 'Rank')}
              {result.keys.map((k) => header(paramColumnId(k), k))}
              {header('value', METRIC_LABELS[metric], { color: 'var(--accent-2)' })}
              {rob && header('nbMean', 'Neighbour mean')}
              {rob && header('nbMin', 'Neighbour min')}
              {rob && header('nbCount', 'Neighbours')}
              {rob && header('robustness', 'Robustness')}
              {METRIC_COLUMNS.map((c) => header(c.id, c.label))}
              <th />
            </tr>
          </thead>
          <tbody>
            {pg.items.map(({ row, rank }) => (
              <tr key={rank}>
                <td>{rank}</td>
                {result.keys.map((k) => (
                  <td key={k}>{row.params[k] ?? '—'}</td>
                ))}
                <td style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{formatMetric(metric, row.value)}</td>
                {rob && scores && <RobustCells s={scores[rank - 1]} metric={metric} bounds={bounds} />}
                {METRIC_COLUMNS.map((c) => {
                  const v = row.metrics[c.id] as number | null;
                  return (
                    <td key={c.id} className={c.pnl ? pnlClass(v) : c.id === 'maxDrawdownPct' ? 'neg' : undefined}>
                      {c.format(v)}
                    </td>
                  );
                })}
                <td>
                  <button className="ghost" onClick={() => onApply(row)} title="Apply these parameters and run the backtest">
                    Apply
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row mt-2 mb-3 wrap">
        <span className="hint">
          Rows {fmtNum(pg.from, 0)}-{fmtNum(pg.to, 0)} of {fmtNum(pg.total, 0)}
        </span>
        <button className="ghost" aria-label="Previous page" disabled={pg.page === 0} onClick={() => setPage(pg.page - 1)}>
          Previous
        </button>
        <button className="ghost" aria-label="Next page" disabled={pg.page >= pg.pages - 1} onClick={() => setPage(pg.page + 1)}>
          Next
        </button>
      </div>

      {split && <HeldOutCheck validation={split} keys={result.keys} metric={metric} onApply={onApply} />}

      <Heatmap key={result.keys.join('|')} rows={result.rows} keys={result.keys} metric={metric} onApply={onApply} robustBest={robustBest && robustBest !== result.rows[0] ? { row: robustBest, score: robustScore } : null} />
    </div>
  );
}

function RobustCells({ s, metric, bounds }: { s: RobustnessScore; metric: MetricKey; bounds: { max: number; min: number } | null }) {
  const tip =
    s.capped && bounds
      ? `Infinite values were counted as the largest finite value (${formatMetric(metric, bounds.max)}), and negative infinite ones as the smallest (${formatMetric(metric, bounds.min)}).`
      : undefined;
  return (
    <>
      <td>{formatMetric(metric, s.neighbourMean)}</td>
      <td>{formatMetric(metric, s.neighbourMin)}</td>
      <td>{fmtNum(s.neighbourCount, 0)}</td>
      <td title={tip} style={{ color: 'var(--accent-2)', fontWeight: 600 }}>
        {formatMetric(metric, s.robustness)}
        {tip ? '*' : ''}
      </td>
    </>
  );
}
