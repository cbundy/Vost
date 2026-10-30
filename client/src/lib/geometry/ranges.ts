/** Pure figures of the range tools (price range, date range, date and price range). No chart imports. */
import { measureSummary, type MeasureSummary, type OhlcBar } from '../drawingGeometry';
import { barVolume } from './volume';

export type RangeSummary = MeasureSummary & {
  /** The change in whole ticks, or null when the tick size is unknown. */
  ticks: number | null;
  /** The summed volume of the loaded bars whose time lies in [min time, max time], inclusive. */
  volume: number;
};

/** What the range tools show between two anchors: the measure's figures plus ticks and the volume of the bars inside. */
export function rangeSummary(
  start: { time: number; price: number },
  end: { time: number; price: number },
  times: readonly number[],
  candles: readonly OhlcBar[],
  tickSize?: number,
): RangeSummary {
  const m = measureSummary(start, end, times);
  const lo = Math.min(start.time, end.time);
  const hi = Math.max(start.time, end.time);
  let volume = 0;
  for (const c of candles) if (c.time >= lo && c.time <= hi) volume += barVolume(c);
  const ticks = typeof tickSize === 'number' && Number.isFinite(tickSize) && tickSize > 0 ? Math.round(m.change / tickSize) || 0 : null;
  return { ...m, ticks, volume };
}
