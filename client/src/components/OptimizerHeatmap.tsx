import { useState } from 'react';
import { METRIC_LABELS, type MetricKey, type OptimizeRow } from '../lib/backtest/optimizer';
import { formatMetric } from '../lib/backtest/optimizerTable';
import { fmtNum, fmtPct } from '../lib/format';

export function Heatmap({
  rows,
  keys,
  metric,
  onApply,
  robustBest,
}: {
  rows: OptimizeRow[];
  keys: string[];
  metric: MetricKey;
  onApply: (row: OptimizeRow) => void;
  /** The most robust result when it is not the best one, with its robustness. */
  robustBest?: { row: OptimizeRow; score: number | null } | null;
}) {
  const [rowKey, setRowKey] = useState(keys[0]);
  const [colKey, setColKey] = useState(keys[1] ?? '');
  if (!rowKey) return null;

  const best = rows[0];
  const axes = [rowKey, colKey].filter(Boolean);
  const pinnedKeys = keys.filter((k) => !axes.includes(k));
  const shown = best ? rows.filter((r) => pinnedKeys.every((k) => r.params[k] === best.params[k])) : rows;

  const values = shown.map((r) => r.value).filter((v): v is number => v != null && Number.isFinite(v));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const aVals = Array.from(new Set(shown.map((r) => r.params[rowKey]))).sort((x, y) => x - y);
  const bVals: Array<number | null> = colKey ? Array.from(new Set(shown.map((r) => r.params[colKey]))).sort((x, y) => x - y) : [null];

  const pickers = (
    <div className="row mb-2 wrap">
      <label className="row" style={{ gap: 4 }}>
        <span className="hint">Rows</span>
        <select
          aria-label="Rows"
          value={rowKey}
          onChange={(e) => {
            setRowKey(e.target.value);
            if (e.target.value === colKey) setColKey('');
          }}
        >
          {keys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {keys.length > 1 && (
        <label className="row" style={{ gap: 4 }}>
          <span className="hint">Columns</span>
          <select aria-label="Columns" value={colKey} onChange={(e) => setColKey(e.target.value)}>
            <option value="">none</option>
            {keys
              .filter((k) => k !== rowKey)
              .map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
          </select>
        </label>
      )}
    </div>
  );

  if (aVals.length * bVals.length > 900) {
    return (
      <div>
        {pickers}
        <div className="hint">Heatmap hidden (grid too large). See the table instead.</div>
      </div>
    );
  }

  const color = (v: number | null): string => {
    if (v == null || !Number.isFinite(v)) return 'rgba(139,148,167,0.1)';
    const t = max === min ? 0.5 : (v - min) / (max - min);
    const r = Math.round(239 - t * (239 - 34));
    const g = Math.round(68 + t * (197 - 68));
    const b = Math.round(68 + t * (94 - 68));
    return `rgba(${r},${g},${b},${0.18 + 0.45 * t})`;
  };

  const lookup = new Map<string, OptimizeRow>();
  for (const r of shown) lookup.set(`${r.params[rowKey]}|${colKey ? r.params[colKey] : ''}`, r);

  return (
    <div>
      {pickers}
      <div className="hint mb-2">
        Rows: <b>{rowKey}</b>
        {colKey ? (
          <>
            {' '}
            · Columns: <b>{colKey}</b>
          </>
        ) : null}{' '}
        · colour = {METRIC_LABELS[metric]}
        {colKey ? '' : ' (1D)'}
      </div>
      {pinnedKeys.length > 0 && best && (
        <div className="hint mb-2">Other parameters fixed at the best result: {pinnedKeys.map((k) => `${k}=${best.params[k]}`).join(', ')}</div>
      )}
      {robustBest && (
        <div className="hint mb-2">
          Most robust: {keys.map((k) => `${k}=${robustBest.row.params[k]}`).join(', ')} (Robustness {formatMetric(metric, robustBest.score)}) - dashed outline
        </div>
      )}
      <div className="heatmap" style={{ gridTemplateColumns: `52px repeat(${bVals.length}, minmax(52px, 1fr))` }}>
        <div className="hm-head" />
        {bVals.map((bv) => (
          <div className="hm-head" key={String(bv)}>
            {bv ?? '—'}
          </div>
        ))}
        {aVals.map((av) => (
          <RowCells
            key={av}
            av={av}
            aKey={rowKey}
            bVals={bVals}
            bKey={colKey || undefined}
            lookup={lookup}
            color={color}
            metric={metric}
            robustKey={robustBest && pinnedKeys.every((k) => robustBest.row.params[k] === best?.params[k]) ? `${robustBest.row.params[rowKey]}|${colKey ? robustBest.row.params[colKey] : ''}` : ''}
            bestKey={best ? `${best.params[rowKey]}|${colKey ? best.params[colKey] : ''}` : ''}
            onApply={onApply}
          />
        ))}
      </div>
    </div>
  );
}
function RowCells({
  av,
  aKey,
  bVals,
  bKey,
  lookup,
  color,
  metric,
  bestKey,
  robustKey,
  onApply,
}: {
  av: number;
  aKey: string;
  bVals: Array<number | null>;
  bKey: string | undefined;
  lookup: Map<string, OptimizeRow>;
  color: (v: number | null) => string;
  metric: MetricKey;
  bestKey: string;
  robustKey: string;
  onApply: (row: OptimizeRow) => void;
}) {
  return (
    <>
      <div className="hm-head">{av}</div>
      {bVals.map((bv) => {
        const row = lookup.get(`${av}|${bv ?? ''}`);
        const key = `${av}|${bv ?? ''}`;
        return (
          <div
            key={String(bv)}
            className="hm-cell"
            title={
              row
                ? `${key === robustKey ? 'Most robust: ' : ''}${aKey}=${av}${bKey ? `, ${bKey}=${bv}` : ''} → ${formatMetric(metric, row.value)}`
                : 'no result'
            }
            style={{
              background: color(row?.value ?? null),
              outline:
                key === bestKey ? '1px solid var(--accent-2)' : key === robustKey ? '2px dashed var(--text)' : undefined,
              outlineOffset: key === robustKey && key !== bestKey ? -2 : undefined,
            }}
            onClick={() => row && onApply(row)}
          >
            {row ? formatMetric(metric, row.value) : '—'}
          </div>
        );
      })}
    </>
  );
}
