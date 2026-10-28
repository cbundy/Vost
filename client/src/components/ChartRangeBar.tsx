import type { IChartApi, Time } from 'lightweight-charts';
import { useMemo } from 'react';
import { useStore } from '../state/store';
import { topbarTier } from '../lib/paneSizes';
import { useViewportSize } from '../lib/useViewportSize';
import { QUICK_RANGES, quickRangeState, type QuickRangeKey } from '../lib/quickRange';
import { ChartRangeControl } from './ChartRangeControl';
import { ZoneClock } from './ZoneClock';

/** The slim bar under the chart: quick ranges, the Range picker and the time-zone clock. */
export function ChartRangeBar({ chartApi }: { chartApi: IChartApi | null }) {
  const candles = useStore((s) => s.candles);
  const timeZone = useStore((s) => s.timeZone);
  const tier = topbarTier(useViewportSize().width);
  const states = useMemo(
    () => QUICK_RANGES.map((q) => ({ ...q, state: quickRangeState(q.key, candles, timeZone) })),
    [candles, timeZone],
  );

  const apply = (key: QuickRangeKey) => {
    const q = states.find((x) => x.key === key)?.state;
    if (!chartApi || !q || !q.enabled) return;
    if (q.showAll || q.from == null || q.to == null) chartApi.timeScale().fitContent();
    else chartApi.timeScale().setVisibleRange({ from: q.from as Time, to: q.to as Time });
  };

  return (
    <div className="chart-range-bar">
      <div className="quick-ranges" role="toolbar" aria-label="Quick ranges">
        {states.map((q) => (
          <button key={q.key} className="ghost" title={q.title} disabled={!chartApi || !q.state.enabled} onClick={() => apply(q.key)}>
            {q.label}
          </button>
        ))}
      </div>
      {(tier === 'full' || tier === 'compact') && <ChartRangeControl />}
      <ZoneClock />
    </div>
  );
}
