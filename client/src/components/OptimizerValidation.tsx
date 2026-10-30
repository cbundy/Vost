import { useRef } from 'react';
import { METRIC_LABELS, type OptimizeRow } from '../lib/backtest/optimizer';
import { formatMetric } from '../lib/backtest/optimizerTable';
import {
  DEFAULT_SPLIT,
  SPLIT_PCT_MAX,
  SPLIT_PCT_MIN,
  SPLIT_TOPN_MAX,
  SPLIT_TOPN_MIN,
  type Check,
  type Span,
  type ValidationConfig,
  type ValidationOutput,
} from '../lib/backtest/validation';
import {
  DEFAULT_WALK_FORWARD,
  WF_PCT_MAX,
  WF_PCT_MIN,
  WF_WINDOWS_MAX,
  WF_WINDOWS_MIN,
  type WalkForwardConfig,
} from '../lib/backtest/walkForward';
import { fmtNum, fmtPct, fmtTime, pnlClass } from '../lib/format';
import { useStore } from '../state/store';
import type { MetricKey } from '../lib/backtest/optimizer';

type Split = Extract<ValidationConfig, { method: 'split' }>;

const wholeOrNaN = (text: string): number => (text === '' ? NaN : Number(text));

/** The Validation select and the inputs of the chosen method. The last split and walk-forward values survive a switch away and back. */
export function ValidationSettings({ value, onChange }: { value: ValidationConfig; onChange: (v: ValidationConfig) => void }) {
  const lastSplit = useRef<Split>({ ...DEFAULT_SPLIT });
  const lastWalk = useRef<WalkForwardConfig>({ ...DEFAULT_WALK_FORWARD });
  if (value.method === 'split') lastSplit.current = value;
  if (value.method === 'walk-forward') lastWalk.current = value;
  const split = value.method === 'split' ? value : null;
  const walk = value.method === 'walk-forward' ? value : null;
  return (
    <>
      <label className="form-field">
        <span>Validation</span>
        <select
          value={value.method}
          onChange={(e) =>
            onChange(e.target.value === 'split' ? { ...lastSplit.current } : e.target.value === 'walk-forward' ? { ...lastWalk.current } : { method: 'none' })
          }
        >
          <option value="none">None</option>
          <option value="split">In-sample / out-of-sample</option>
          <option value="walk-forward">Walk-forward</option>
        </select>
      </label>
      {walk && (
        <>
          <label className="form-field">
            <span>Windows</span>
            <input
              type="number"
              min={WF_WINDOWS_MIN}
              max={WF_WINDOWS_MAX}
              step={1}
              value={Number.isNaN(walk.windows) ? '' : walk.windows}
              onChange={(e) => onChange({ ...walk, windows: wholeOrNaN(e.target.value) })}
            />
          </label>
          <label className="form-field">
            <span>In-sample %</span>
            <input
              type="number"
              min={WF_PCT_MIN}
              max={WF_PCT_MAX}
              step={1}
              value={Number.isNaN(walk.inSamplePct) ? '' : walk.inSamplePct}
              onChange={(e) => onChange({ ...walk, inSamplePct: wholeOrNaN(e.target.value) })}
            />
          </label>
          <label className="form-field">
            <span>Mode</span>
            <select value={walk.anchored ? 'anchored' : 'rolling'} onChange={(e) => onChange({ ...walk, anchored: e.target.value === 'anchored' })}>
              <option value="rolling">Rolling</option>
              <option value="anchored">Anchored</option>
            </select>
          </label>
        </>
      )}
      {split && (
        <>
          <label className="form-field">
            <span>In-sample %</span>
            <input
              type="number"
              min={SPLIT_PCT_MIN}
              max={SPLIT_PCT_MAX}
              step={1}
              value={Number.isNaN(split.inSamplePct) ? '' : split.inSamplePct}
              onChange={(e) => onChange({ ...split, inSamplePct: e.target.value === '' ? NaN : Number(e.target.value) })}
            />
          </label>
          <label className="form-field">
            <span>Top results to check</span>
            <input
              type="number"
              min={SPLIT_TOPN_MIN}
              max={SPLIT_TOPN_MAX}
              step={1}
              value={Number.isNaN(split.topN) ? '' : split.topN}
              onChange={(e) => onChange({ ...split, topN: e.target.value === '' ? NaN : Number(e.target.value) })}
            />
          </label>
        </>
      )}
    </>
  );
}

const CHECK_COLUMNS: Array<{ id: 'totalReturnPct' | 'sharpe' | 'maxDrawdownPct' | 'trades'; label: string; format: (v: number | null) => string; pnl?: boolean }> = [
  { id: 'totalReturnPct', label: 'Total return', format: (v) => fmtPct(v), pnl: true },
  { id: 'sharpe', label: 'Sharpe', format: (v) => fmtNum(v, 2) },
  { id: 'maxDrawdownPct', label: 'Max drawdown', format: (v) => fmtPct(v) },
  { id: 'trades', label: 'Trades', format: (v) => fmtNum(v, 0) },
];

/** The held-out check: both spans, then one row per checked result with in-sample and held-out figures side by side. */
export function HeldOutCheck({
  validation,
  keys,
  metric,
  onApply,
}: {
  validation: ValidationOutput;
  keys: string[];
  metric: MetricKey;
  onApply: (row: OptimizeRow) => void;
}) {
  const timeZone = useStore((s) => s.timeZone);
  const span = (s: Span) => `${fmtTime(s.from, { timeZone })} → ${fmtTime(s.to, { timeZone })} (${fmtNum(s.bars, 0)} bars)`;
  return (
    <div className="mb-3">
      <div className="row mb-2 wrap">
        <span className="section-title" style={{ margin: 0 }}>
          Held-out check · {METRIC_LABELS[metric]}
        </span>
        {validation.failed > 0 && <span className="badge red">{validation.failed} failed</span>}
      </div>
      <div className="hint">In-sample: {span(validation.inSample)}</div>
      <div className="hint mb-2">Held-out: {span(validation.heldOut)}</div>
      {validation.checks.length === 0 ? (
        <div className="hint">No result had a ranking value to check.</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>In-sample rank</th>
                {keys.map((k) => (
                  <th key={k}>{k}</th>
                ))}
                <th style={{ color: 'var(--accent-2)' }}>{METRIC_LABELS[metric]} (in-sample)</th>
                <th style={{ color: 'var(--accent-2)' }}>{METRIC_LABELS[metric]} (held-out)</th>
                {CHECK_COLUMNS.map((c) => (
                  <th key={c.id}>{c.label} (in-sample)</th>
                ))}
                {CHECK_COLUMNS.map((c) => (
                  <th key={`h-${c.id}`}>{c.label} (held-out)</th>
                ))}
                <th>Held-out rank</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {validation.checks.map((ch) => (
                <CheckRow key={ch.rank} ch={ch} keys={keys} metric={metric} onApply={onApply} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CheckRow({ ch, keys, metric, onApply }: { ch: Check; keys: string[]; metric: MetricKey; onApply: (row: OptimizeRow) => void }) {
  const inValue = ch.inSample[metric] as number | null;
  return (
    <tr>
      <td>{ch.rank}</td>
      {keys.map((k) => (
        <td key={k}>{ch.params[k] ?? '—'}</td>
      ))}
      <td style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{formatMetric(metric, inValue)}</td>
      <td style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{ch.heldOut ? formatMetric(metric, ch.heldOutValue) : 'failed'}</td>
      {CHECK_COLUMNS.map((c) => {
        const v = ch.inSample[c.id] as number | null;
        return (
          <td key={c.id} className={c.pnl ? pnlClass(v) : c.id === 'maxDrawdownPct' ? 'neg' : undefined}>
            {c.format(v)}
          </td>
        );
      })}
      {CHECK_COLUMNS.map((c) => {
        const v = ch.heldOut ? (ch.heldOut[c.id] as number | null) : null;
        return (
          <td key={`h-${c.id}`} className={c.pnl ? pnlClass(v) : c.id === 'maxDrawdownPct' ? 'neg' : undefined}>
            {c.format(v)}
          </td>
        );
      })}
      <td>{ch.heldOutRank ?? '—'}</td>
      <td>
        <button className="ghost" onClick={() => onApply({ params: ch.params, metrics: ch.inSample, value: ch.inSample[metric] as number | null })} title="Apply these parameters and run the backtest">
          Apply
        </button>
      </td>
    </tr>
  );
}
