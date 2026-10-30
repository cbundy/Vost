import { AreaSeries, ColorType, LineStyle, createChart, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { METRIC_LABELS, type MetricKey, type OptimizeRow } from '../lib/backtest/optimizer';
import { formatMetric } from '../lib/backtest/optimizerTable';
import type { EquityPoint } from '../lib/backtest/types';
import type { Span } from '../lib/backtest/validation';
import type { WalkForwardOutput, WalkForwardWindow } from '../lib/backtest/walkForward';
import { fmtNum, fmtPct, fmtTime, pnlClass } from '../lib/format';
import { fmtTick } from '../lib/time';
import { DOWN_COLOR, UP_COLOR, chartTheme } from '../lib/theme';
import { useStore } from '../state/store';

/** The walk-forward section: one row per window, the combined held-out figures and the joined held-out equity. */
export function WalkForwardResults({
  walkForward,
  keys,
  metric,
  initialCapital,
  onApply,
}: {
  walkForward: WalkForwardOutput;
  keys: string[];
  metric: MetricKey;
  initialCapital: number;
  onApply: (row: OptimizeRow) => void;
}) {
  const timeZone = useStore((s) => s.timeZone);
  const span = (s: Span) => `${fmtTime(s.from, { timeZone, dateOnly: true })} → ${fmtTime(s.to, { timeZone, dateOnly: true })} (${fmtNum(s.bars, 0)})`;
  const c = walkForward.combined;
  return (
    <div className="mb-3">
      <div className="row mb-2 wrap">
        <span className="section-title" style={{ margin: 0 }}>
          Walk-forward · {METRIC_LABELS[metric]}
        </span>
        <span className="badge">{walkForward.anchored ? 'anchored' : 'rolling'}</span>
        {walkForward.failed > 0 && <span className="badge red">{walkForward.failed} failed</span>}
      </div>
      <div className="hint mb-2">
        Each window's grid is searched on its in-sample bars and the winner is run on the held-out bars after them. The table and heatmap above show the last
        window's in-sample grid.
      </div>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Window</th>
              <th>In-sample</th>
              <th>Held-out</th>
              {keys.map((k) => (
                <th key={k}>{k}</th>
              ))}
              <th style={{ color: 'var(--accent-2)' }}>{METRIC_LABELS[metric]} (in-sample)</th>
              <th style={{ color: 'var(--accent-2)' }}>{METRIC_LABELS[metric]} (held-out)</th>
              <th>Total return (held-out)</th>
              <th>Max drawdown (held-out)</th>
              <th>Trades (held-out)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {walkForward.results.map((w) => (
              <WindowRow key={w.index} w={w} keys={keys} metric={metric} span={span} onApply={onApply} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2" aria-label="Combined held-out result">
        {c ? (
          <div className="row wrap">
            <span className="section-title" style={{ margin: 0 }}>
              Combined held-out
            </span>
            <span>
              Total return <b className={`mono ${pnlClass(c.totalReturnPct)}`}>{fmtPct(c.totalReturnPct)}</b>
            </span>
            <span>
              Max drawdown <b className="mono neg">{fmtPct(c.maxDrawdownPct)}</b>
            </span>
            <span>
              Trades <b className="mono">{fmtNum(c.trades, 0)}</b>
            </span>
            <span title="Mean held-out CAGR divided by mean in-sample CAGR of the winners">
              Walk-forward efficiency <b className="mono">{c.efficiency == null ? 'n/a' : fmtNum(c.efficiency, 2)}</b>
            </span>
          </div>
        ) : (
          <div className="hint" style={{ color: 'var(--amber)' }}>
            Incomplete: {walkForward.results.length - walkForward.incomplete} of {walkForward.windows} windows have a held-out result.
          </div>
        )}
      </div>
      {c && walkForward.equity.length > 0 && <StitchedEquity equity={walkForward.equity} initialCapital={initialCapital} positive={c.totalReturnPct >= 0} />}
    </div>
  );
}

function WindowRow({
  w,
  keys,
  metric,
  span,
  onApply,
}: {
  w: WalkForwardWindow;
  keys: string[];
  metric: MetricKey;
  span: (s: Span) => string;
  onApply: (row: OptimizeRow) => void;
}) {
  const params = w.params;
  const note = w.status === 'no-winner' ? 'no winner' : w.status === 'failed' ? 'failed' : null;
  const h = w.heldOutMetrics;
  return (
    <tr>
      <td>{w.index}</td>
      <td>{span(w.inSample)}</td>
      <td>{span(w.heldOut)}</td>
      {keys.map((k) => (
        <td key={k}>{params ? (params[k] ?? '—') : '—'}</td>
      ))}
      <td style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{params ? formatMetric(metric, w.inSampleValue) : '—'}</td>
      {note ? (
        <td colSpan={4}>{note}</td>
      ) : (
        <>
          <td style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{formatMetric(metric, w.heldOutValue)}</td>
          <td className={pnlClass(h?.totalReturnPct)}>{fmtPct(h?.totalReturnPct)}</td>
          <td className="neg">{fmtPct(h?.maxDrawdownPct)}</td>
          <td>{fmtNum(h?.trades, 0)}</td>
        </>
      )}
      <td>
        {params && w.inSampleMetrics && (
          <button
            className="ghost"
            onClick={() => onApply({ params, metrics: w.inSampleMetrics!, value: w.inSampleValue })}
            title="Apply these parameters and run the backtest"
          >
            Apply
          </button>
        )}
      </td>
    </tr>
  );
}

function StitchedEquity({ equity, initialCapital, positive }: { equity: EquityPoint[]; initialCapital: number; positive: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const timeZone = useStore((s) => s.timeZone);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: chartTheme.text, fontSize: 10 },
      grid: { vertLines: { color: chartTheme.gridFaint }, horzLines: { color: chartTheme.gridFaint } },
      rightPriceScale: { borderColor: chartTheme.scaleBorder },
      timeScale: {
        borderColor: chartTheme.scaleBorder,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (t: Time, type: number) => fmtTick(t as number, type, timeZone),
      },
      localization: { timeFormatter: (t: Time) => fmtTime(t as number, { timeZone }) },
      crosshair: { vertLine: { color: chartTheme.crosshairFaint }, horzLine: { color: chartTheme.crosshairFaint } },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: positive ? UP_COLOR : DOWN_COLOR,
      topColor: positive ? 'rgba(34,197,94,0.28)' : 'rgba(239,68,68,0.28)',
      bottomColor: 'rgba(0,0,0,0)',
      lineWidth: 2,
      priceLineVisible: false,
    });
    series.setData(equity.map((p) => ({ time: p.time as UTCTimestamp, value: p.equity })));
    series.createPriceLine({ price: initialCapital, color: chartTheme.refLine, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'initial' });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [equity, initialCapital, positive, timeZone]);
  return (
    <div className="mt-2">
      <div className="hint mb-1">Held-out equity, joined window by window</div>
      <div ref={ref} aria-label="Joined held-out equity" style={{ height: 180, width: '100%' }} />
    </div>
  );
}
