import { useEffect, useState } from 'react';
import { gridSize, MAX_GRID_COMBOS, METRIC_LABELS, type MetricKey, type SweepParam } from '../lib/backtest/optimizer';
import { getStrategy } from '../lib/backtest/strategies';
import { fmtNum, fmtTime } from '../lib/format';
import { describeTimeRange } from '../lib/timeRange';
import { useStore } from '../state/store';
import { selectBars } from '../state/chart';
import { useChart } from '../state/chartContext';
import { OptimizerResults } from './OptimizerResults';

const METRICS: MetricKey[] = ['sharpe', 'totalReturnPct', 'cagrPct', 'sortino', 'profitFactor', 'winRatePct', 'calmar', 'maxDrawdownPct'];

export function OptimizerTab() {
  const btConfig = useChart((s) => s.btConfig);
  const optConfig = useChart((s) => s.optConfig);
  const optRunning = useChart((s) => s.optRunning);
  const optProgress = useChart((s) => s.optProgress);
  const optResult = useChart((s) => s.optResult);
  const candles = useChart(selectBars);
  const btRange = useChart((s) => s.btRange);
  const timeZone = useStore((s) => s.timeZone);
  const setOptConfig = useChart((s) => s.setOptConfig);
  const runOptimizer = useChart((s) => s.runOptimizer);
  const cancelOptimizer = useChart((s) => s.cancelOptimizer);
  const applyOptimizeRow = useChart((s) => s.applyOptimizeRow);

  const range = describeTimeRange(candles, btRange);
  const rangeSet = btRange.from != null || btRange.to != null;
  const rangeText = !rangeSet
    ? 'Range: full data (set in Backtest)'
    : range.error === 'from-after-to'
      ? 'Range: From is later than To (set in Backtest)'
      : range.error === 'too-few-bars'
        ? 'Range: fewer than 3 bars (set in Backtest)'
        : `Range: ${fmtNum(range.count, 0)} of ${fmtNum(range.total, 0)} bars · ${fmtTime(range.slice[0].time, { timeZone })} → ${fmtTime(range.slice[range.slice.length - 1].time, { timeZone })} (set in Backtest)`;

  const strategy = getStrategy(btConfig.strategyId);
  const pineInputs = useChart((s) => s.pineInputs);
  const numericParams = strategy.pine
    ? pineInputs
        .filter((i) => i.type === 'int' || i.type === 'float')
        .map((i) => ({ key: i.name, label: i.name, isInt: i.type === 'int' }))
    : strategy.params.filter((p) => p.type !== 'select').map((p) => ({ key: p.key, label: p.label, isInt: p.type === 'int' }));
  const refreshPineInputs = useChart((s) => s.refreshPineInputs);
  useEffect(() => {
    if (strategy.pine && pineInputs.length === 0) void refreshPineInputs();
  }, [strategy.pine, pineInputs.length, refreshPineInputs, candles.length > 0]);
  const firstKey = numericParams[0]?.key;
  const defaultValue = (key: string): number => {
    if (strategy.pine) {
      const d = pineInputs.find((i) => i.name === key)?.defval;
      return typeof d === 'number' ? d : 10;
    }
    return btConfig.params[key] ?? strategy.params.find((p) => p.key === key)?.default ?? 10;
  };
  const defaultSweep = (key: string): SweepParam => {
    const base = defaultValue(key);
    return { key, from: Math.max(1, Math.round(base * 0.5)), to: Math.max(2, Math.round(base * 1.5)), step: 1 };
  };
  useEffect(() => {
    if (!strategy.pine || !firstKey || optConfig.sweeps.some((sw) => numericParams.some((p) => p.key === sw.key))) return;
    setOptConfig({ sweeps: [defaultSweep(firstKey)] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy.pine, firstKey]);
  const combos = gridSize(optConfig);
  const isIntKey = (key: string) => numericParams.find((p) => p.key === key)?.isInt === true;
  const stepProblem = optConfig.sweeps.find((sw) => isIntKey(sw.key) && !Number.isInteger(sw.step))?.key ?? null;
  const usedKeys = new Set(optConfig.sweeps.map((sw) => sw.key));
  const nextFree = numericParams.find((p) => !usedKeys.has(p.key));
  const patchSweep = (i: number, patch: Partial<SweepParam>) =>
    setOptConfig({ sweeps: optConfig.sweeps.map((sw, j) => (j === i ? { ...sw, ...patch } : sw)) });
  const overLimit = combos > MAX_GRID_COMBOS;

  return (
    <div>
      <div className="hint mb-2">
        Grid-search strategy parameters in your browser — up to {fmtNum(MAX_GRID_COMBOS, 0)} backtests per run, no server. Click a result to apply it and
        re-run instantly.
      </div>

      <div className="form-grid">
        {optConfig.sweeps.map((sw, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <label className="form-field">
              <span>Parameter {i + 1}</span>
              <select value={sw.key} onChange={(e) => patchSweep(i, { key: e.target.value })}>
                {numericParams
                  .filter((p) => p.key === sw.key || !usedKeys.has(p.key))
                  .map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
              </select>
            </label>
            <SweepRange from={sw.from} to={sw.to} step={sw.step} onChange={(patch) => patchSweep(i, patch)}>
              <button
                className="ghost"
                aria-label={`Remove parameter ${i + 1}`}
                disabled={optConfig.sweeps.length <= 1}
                onClick={() => setOptConfig({ sweeps: optConfig.sweeps.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </SweepRange>
          </div>
        ))}
        <div className="form-field">
          <button
            className="ghost"
            aria-label="Add parameter"
            disabled={!nextFree}
            onClick={() => nextFree && setOptConfig({ sweeps: [...optConfig.sweeps, defaultSweep(nextFree.key)] })}
          >
            + Add parameter
          </button>
        </div>

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
        <button className="primary" disabled={optRunning || candles.length < 3 || range.error != null || combos === 0 || overLimit || stepProblem != null} onClick={() => void runOptimizer()}>
          {optRunning ? <span className="spinner" /> : '⛭'} {optRunning ? ' Optimizing…' : `Optimize ${combos} combinations`}
        </button>
        {overLimit && (
          <span className="hint" style={{ color: 'var(--amber)' }}>
            Grid too large: {fmtNum(combos, 0)} combinations, the limit is {fmtNum(MAX_GRID_COMBOS, 0)}. Narrow a range or raise a step.
          </span>
        )}
        {stepProblem != null && (
          <span className="hint" style={{ color: 'var(--amber)' }}>
            {stepProblem} is a whole-number parameter: use a whole-number step.
          </span>
        )}
        {!overLimit && combos > 2000 && <span className="hint" style={{ color: 'var(--amber)' }}>Large grid — this may take a while.</span>}
        <span className="hint">{rangeText}</span>
        <span className="hint">{numericParams.length === 0 ? 'This strategy has no numeric parameters to sweep.' : ''}</span>
      </div>

      {optRunning && (
        <div className="row mt-3">
          <div className="progress" style={{ maxWidth: 420, flex: 1 }}>
            <div style={{ width: `${Math.round(optProgress * 100)}%` }} />
          </div>
          <button className="ghost" aria-label="Cancel" onClick={() => cancelOptimizer()}>
            Cancel
          </button>
        </div>
      )}

      {optResult && <OptimizerResults result={optResult} onApply={(row) => void applyOptimizeRow(row)} />}
    </div>
  );
}

function SweepRange({
  from,
  to,
  step,
  onChange,
  children,
}: {
  from: number;
  to: number;
  step: number;
  onChange: (patch: { from?: number; to?: number; step?: number }) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="form-field" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 6 }}>
      <label className="form-field" style={{ flex: '1 1 72px', minWidth: 72 }}>
        <span>From</span>
        <input type="number" value={from} onChange={(e) => onChange({ from: Number(e.target.value) })} />
      </label>
      <label className="form-field" style={{ flex: '1 1 72px', minWidth: 72 }}>
        <span>To</span>
        <input type="number" value={to} onChange={(e) => onChange({ to: Number(e.target.value) })} />
      </label>
      <label className="form-field" style={{ flex: '1 1 72px', minWidth: 72 }}>
        <span>Step</span>
        <input type="number" min={0.001} value={step} onChange={(e) => onChange({ step: Math.max(0.001, Number(e.target.value)) })} />
      </label>
      {children}
    </div>
  );
}
