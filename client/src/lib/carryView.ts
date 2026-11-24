import type { Candle } from '../types';
import { barSeconds } from './backtest/higherTimeframe';
import { MIN_RANGE_BARS } from './timeRange';

/** What identifies the series a chart shows. `datasetId` is a dataset id, or a marker for a chart range; null for provider data. */
export interface SeriesIdentity {
  providerId: string;
  symbol: string;
  timeframe: string;
  datasetId: string | null;
}

/** Whether going from `prev` to `next` is an asset switch: provider data on both sides, the same timeframe, another provider or symbol. */
export function isAssetSwitch(prev: SeriesIdentity | null, next: SeriesIdentity): boolean {
  if (!prev || prev.datasetId != null || next.datasetId != null) return false;
  if (prev.timeframe !== next.timeframe) return false;
  return prev.providerId !== next.providerId || prev.symbol !== next.symbol;
}

/** The view of the series that is being replaced: its logical range over its own bars. */
export interface OldView {
  logical: { from: number; to: number };
  candles: readonly Candle[];
}

export type CarriedView =
  | { kind: 'logical'; range: { from: number; to: number } }
  | { kind: 'time'; from: number; to: number; needFrom: number | null };

/** The time at logical index `i`: interpolated between bars, extrapolated by `barSec` per bar outside the data. */
export function timeAtLogical(candles: readonly Candle[], i: number, barSec: number): number {
  const n = candles.length;
  if (i <= 0) return candles[0].time + i * barSec;
  if (i >= n - 1) return candles[n - 1].time + (i - (n - 1)) * barSec;
  const lo = Math.floor(i);
  const f = i - lo;
  return candles[lo].time + f * (candles[lo + 1].time - candles[lo].time);
}

/** The logical index of time `t`: interpolated between bars, extrapolated by `barSec` per bar outside the data. */
export function logicalAtTime(candles: readonly Candle[], t: number, barSec: number): number {
  const n = candles.length;
  if (t <= candles[0].time) return (t - candles[0].time) / barSec;
  if (t >= candles[n - 1].time) return n - 1 + (t - candles[n - 1].time) / barSec;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - candles[lo].time) / (candles[lo + 1].time - candles[lo].time);
}

/** How many bars of `candles` lie in [from, to]. */
export function windowBars(candles: readonly Candle[], from: number, to: number): number {
  let n = 0;
  for (const c of candles) if (c.time >= from && c.time <= to) n++;
  return n;
}

/**
 * The view to show on the new series after an asset switch, or null to fit all bars. At the live edge (the old view reached
 * the last bar): the same bar count and right offset ending at the new last bar. Scrolled back: the same time window, taken
 * from the old logical range so empty space past the data is kept (not clipped to the bars), with `needFrom` set when it
 * starts before the first new bar.
 */
export function carriedView(old: OldView, candles: readonly Candle[]): CarriedView | null {
  const n = candles.length;
  const oldN = old.candles.length;
  if (n === 0 || oldN === 0) return null;
  const { from: lf, to: lt } = old.logical;
  if (lt >= oldN - 1) {
    const to = n - 1 + (lt - (oldN - 1));
    return { kind: 'logical', range: { from: to - (lt - lf), to } };
  }
  const oldBar = barSeconds(old.candles as Candle[]);
  const from = timeAtLogical(old.candles, lf, oldBar);
  const to = timeAtLogical(old.candles, lt, oldBar);
  if (from > candles[n - 1].time) return null;
  if (from < candles[0].time) return { kind: 'time', from, to, needFrom: from };
  if (windowBars(candles, from, to) < MIN_RANGE_BARS) return null;
  return { kind: 'time', from, to, needFrom: null };
}
