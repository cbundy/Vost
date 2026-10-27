import { useState } from 'react';
import { useStore } from '../state/store';
import { FULL_RANGE, type TimeRange } from '../lib/timeRange';
import { TimeRangePicker } from './TimeRangePicker';

/** Top bar Range button and its draft panel; the store changes only on Apply. */
export function ChartRangeControl() {
  const chartRange = useStore((s) => s.chartRange);
  const fullCandles = useStore((s) => s.fullCandles);
  const candles = useStore((s) => s.candles);
  const timeZone = useStore((s) => s.timeZone);
  const loading = useStore((s) => s.loadState === 'loading');
  const setChartRange = useStore((s) => s.setChartRange);
  const clearChartRange = useStore((s) => s.clearChartRange);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TimeRange>(FULL_RANGE);

  const full = fullCandles ?? candles;
  const bounds = full.length > 0 ? { first: full[0].time, last: full[full.length - 1].time } : undefined;
  const active = chartRange != null;

  const toggle = () => {
    if (!open) setDraft(chartRange ?? FULL_RANGE);
    setOpen(!open);
  };

  return (
    <div className="chart-range">
      <button
        className={active ? 'chart-range-btn active' : 'chart-range-btn'}
        onClick={toggle}
        disabled={full.length === 0}
        aria-expanded={open}
        title="Show a time window of the chart"
      >
        {active ? 'Range on' : 'Range'}
      </button>
      {active && (
        <button className="ghost" onClick={clearChartRange} title="Show all loaded bars again">
          Clear range
        </button>
      )}
      {open && (
        <div className="chart-range-panel" role="dialog" aria-label="Chart range">
          <TimeRangePicker value={draft} onChange={setDraft} timeZone={timeZone} bounds={bounds} label="Chart range" />
          <div className="chart-range-actions">
            <button onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="primary"
              disabled={loading}
              aria-busy={loading}
              onClick={() => {
                // a refusal leaves the panel open so the window can be corrected
                void setChartRange(draft).then((applied) => {
                  if (applied) setOpen(false);
                });
              }}
            >
              {loading ? <span className="spinner" role="status" aria-label="Loading" /> : 'Apply'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
