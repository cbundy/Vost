import { useEffect, useState } from 'react';
import { METRIC_LABELS, paramValues, type MetricKey, type OptimizeRow } from '../lib/backtest/optimizer';
import { getStrategy } from '../lib/backtest/strategies';
import { fmtNum, fmtPct } from '../lib/format';
import { useStore } from '../state/store';

const METRICS: MetricKey[] = ['sharpe', 'totalReturnPct', 'cagrPct', 'sortino', 'profitFactor', 'winRatePct', 'calmar', 'maxDrawdownPct'];

export function OptimizerTab() {
  const btConfig = useStore((s) => s.btConfig);
  const optConfig = useStore((s) => s.optConfig);
  const optRunning = useStore((s) => s.optRunning);
  const optProgress = useStore((s) => s.optProgress);
  const optResult = useStore((s) => s.optResult);
  const candles = useStore((s) => s.candles);
  const setOptConfig = useStore((s) => s.setOptConfig);
  const runOptimizer = useStore((s) => s.runOptimizer);
  const applyOptimizeRow = useStore((s) => s.applyOptimizeRow);

  const strategy = getStrategy(btConfig.strategyId);
  const pineInputs = useStore((s) => s.pineInputs);
  const numericParams = strategy.pine
    ? pineInputs
        .filter((i) => i.type === 'int' || i.type === 'float')
        .map((i) => ({ key: i.name, label: i.name }))
    : strategy.params.filter((p) => p.type !== 'select');
  const refreshPineInputs = useStore((s) => s.refreshPineInputs);
  useEffect(() => {
    if (strategy.pine && pineInputs.length === 0) void refreshPineInputs();
  }, [strategy.pine, pineInputs.length, refreshPineInputs, candles.length > 0]);
  const firstKey = numericParams[0]?.key;
  useEffect(() => {
    if (!strategy.pine || !firstKey || numericParams.some((p) => p.key === optConfig.sweepA.key)) return;
    const d = pineInputs.find((i) => i.name === firstKey);
    const base = typeof d?.defval === 'number' ? d.defval : 10;
    setOptConfig({
      sweepA: { key: firstKey, from: Math.max(1, Math.round(base * 0.5)), to: Math.max(2, Math.round(base * 1.5)), step: 1 },
      sweepB: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy.pine, firstKey]);
  const combos = paramValues(optConfig.sweepA).length * (optConfig.sweepB ? paramValues(optConfig.sweepB).length : 1);

  return (
    <div>
      <div className="hint mb-2">
        Grid-search strategy parameters in your browser — thousands of backtests, no limits, no server. Click a result to apply it and
        re-run instantly.
      </div>

      <div className="form-grid">
        <label className="form-field">
          <span>Parameter A</span>
          <select
            value={optConfig.sweepA.key}
            onChange={(e) => setOptConfig({ sweepA: { ...optConfig.sweepA, key: e.target.value } })}
          >
            {numericParams.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <SweepRange
          from={optConfig.sweepA.from}
          to={optConfig.sweepA.to}
          step={optConfig.sweepA.step}
          onChange={(patch) => setOptConfig({ sweepA: { ...optConfig.sweepA, ...patch } })}
        />

        <label className="form-field">
          <span>Parameter B (2D sweep)</span>
          <select
            value={optConfig.sweepB?.key ?? ''}
            onChange={(e) => {
              if (!e.target.value) setOptConfig({ sweepB: null });
              else setOptConfig({ sweepB: optConfig.sweepB ? { ...optConfig.sweepB, key: e.target.value } : { key: e.target.value, from: 2, to: 50, step: 2 } });
            }}
          >
            <option value="">— none (1D) —</option>
            {numericParams.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {optConfig.sweepB && (
          <SweepRange
            from={optConfig.sweepB.from}
            to={optConfig.sweepB.to}
            step={optConfig.sweepB.step}
            onChange={(patch) => setOptConfig({ sweepB: { ...optConfig.sweepB!, ...patch } })}
          />
        )}

        <label className="form-field">
          <span>Rank by</span>
          <select value={optConfig.metric} onChange={(e) => setOptConfig({ metric: e.target.value as MetricKey })}>
            {METRICS.map((m) => (
              <option key={m} value={m}>
                {METRIC_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row mt-3 wrap">
        <button className="primary" disabled={optRunning || candles.length < 3 || combos === 0} onClick={() => void runOptimizer()}>
          {optRunning ? <span className="spinner" /> : '⛭'} {optRunning ? ' Optimizing…' : `Optimize ${combos} combinations`}
        </button>
        {combos > 2000 && <span className="hint" style={{ color: 'var(--amber)' }}>Large grid — this may take a while.</span>}
        <span className="hint">{numericParams.length === 0 ? 'This strategy has no numeric parameters to sweep.' : ''}</span>
      </div>

      {optRunning && (
        <div className="progress mt-3" style={{ maxWidth: 420 }}>
          <div style={{ width: `${Math.round(optProgress * 100)}%` }} />
        </div>
      )}

      {optResult && (
        <div className="mt-3">
          <div className="row mb-2 wrap">
            <span className="section-title" style={{ margin: 0 }}>
              Top results · {METRIC_LABELS[optResult.metric]}
            </span>
            <span className="badge">{optResult.combos} combos</span>
            {optResult.errored > 0 && <span className="badge red">{optResult.errored} failed</span>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 16, alignItems: 'start' }}>
            <TopResultsTable rows={optResult.rows} metric={optResult.metric} onApply={(row) => void applyOptimizeRow(row)} />
            <Heatmap rows={optResult.rows} metric={optResult.metric} onApply={(row) => void applyOptimizeRow(row)} />
          </div>
        </div>
      )}
    </div>
  );
}

function SweepRange({
  from,
  to,
  step,
  onChange,
}: {
  from: number;
  to: number;
  step: number;
  onChange: (patch: { from?: number; to?: number; step?: number }) => void;
}) {
  return (
    <div className="form-field" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
      <label className="form-field" style={{ flex: 1 }}>
        <span>From</span>
        <input type="number" value={from} onChange={(e) => onChange({ from: Number(e.target.value) })} />
      </label>
      <label className="form-field" style={{ flex: 1 }}>
        <span>To</span>
        <input type="number" value={to} onChange={(e) => onChange({ to: Number(e.target.value) })} />
      </label>
      <label className="form-field" style={{ flex: 1 }}>
        <span>Step</span>
        <input type="number" min={0.001} value={step} onChange={(e) => onChange({ step: Math.max(0.001, Number(e.target.value)) })} />
      </label>
    </div>
  );
}

export function formatMetric(metric: MetricKey, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? '∞' : '—';
  if (metric.endsWith('Pct')) return fmtPct(value, 1);
  return fmtNum(value, 2);
}

function TopResultsTable({ rows, metric, onApply }: { rows: OptimizeRow[]; metric: MetricKey; onApply: (row: OptimizeRow) => void }) {
  const top = rows.slice(0, 12);
  const paramKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r.params)))).slice(0, 4);
  return (
    <div className="table-wrap" style={{ maxHeight: 220 }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            {paramKeys.map((k) => (
              <th key={k}>{k}</th>
            ))}
            <th>{METRIC_LABELS[metric]}</th>
            <th>Return</th>
            <th>Max DD</th>
            <th>Trades</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {top.map((row, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              {paramKeys.map((k) => (
                <td key={k}>{row.params[k] ?? '—'}</td>
              ))}
              <td style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{formatMetric(metric, row.value)}</td>
              <td className={row.metrics.totalReturnPct >= 0 ? 'pos' : 'neg'}>{fmtPct(row.metrics.totalReturnPct, 1)}</td>
              <td className="neg">{fmtPct(row.metrics.maxDrawdownPct, 1)}</td>
              <td>{row.metrics.trades}</td>
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
  );
}

function Heatmap({ rows, metric, onApply }: { rows: OptimizeRow[]; metric: MetricKey; onApply: (row: OptimizeRow) => void }) {
  const withB = rows.filter((r) => Object.keys(r.params).length >= 2);
  const aKey = Object.keys(rows[0]?.params ?? {})[0];
  const bKey = Object.keys(rows[0]?.params ?? {})[1];
  if (!aKey) return null;

  const values = rows.map((r) => r.value).filter((v): v is number => v != null && Number.isFinite(v));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const aVals = Array.from(new Set(rows.map((r) => r.params[aKey]))).sort((x, y) => x - y);
  const bVals = bKey ? Array.from(new Set(rows.map((r) => r.params[bKey]))).sort((x, y) => x - y) : [null];
  if (aVals.length * bVals.length > 900) {
    return <div className="hint">Heatmap hidden (grid too large). See the table instead.</div>;
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
  for (const r of rows) lookup.set(`${r.params[aKey]}|${bKey ? r.params[bKey] : ''}`, r);

  const best = rows[0];
  return (
    <div>
      <div className="hint mb-2">
        Rows: <b>{aKey}</b>
        {bKey ? (
          <>
            {' '}
            · Columns: <b>{bKey}</b>
          </>
        ) : null}{' '}
        · colour = {METRIC_LABELS[metric]}
        {withB.length === 0 ? ' (1D sweep)' : ''}
      </div>
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
            aKey={aKey}
            bVals={bVals}
            bKey={bKey}
            lookup={lookup}
            color={color}
            metric={metric}
            bestKey={best ? `${best.params[aKey]}|${bKey ? best.params[bKey] : ''}` : ''}
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
            title={row ? `${aKey}=${av}${bKey ? `, ${bKey}=${bv}` : ''} → ${formatMetric(metric, row.value)}` : 'no result'}
            style={{
              background: color(row?.value ?? null),
              outline: key === bestKey ? '1px solid var(--accent-2)' : undefined,
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
