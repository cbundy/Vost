import type { Candle } from '../types';
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

/** The view of the series that is being replaced. `from`/`to` are the times of the visible edges (null when unknown). */
export interface OldView {
  logical: { from: number; to: number };
  from: number | null;
  to: number | null;
  length: number;
}

export type CarriedView =
  | { kind: 'logical'; range: { from: number; to: number } }
  | { kind: 'time'; from: number; to: number; needFrom: number | null };

/** How many bars of `candles` lie in [from, to]. */
export function windowBars(candles: readonly Candle[], from: number, to: number): number {
  let n = 0;
  for (const c of candles) if (c.time >= from && c.time <= to) n++;
  return n;
}

/**
 * The view to show on the new series after an asset switch, or null to fit all bars. At the live edge (the old view reached
 * the last bar): the same bar count and right offset ending at the new last bar. Scrolled back: the same time window, with
 * `needFrom` set when it starts before the first new bar.
 */
export function carriedView(old: OldView, candles: readonly Candle[]): CarriedView | null {
  const n = candles.length;
  if (n === 0 || old.length === 0) return null;
  const { from: lf, to: lt } = old.logical;
  if (lt >= old.length - 1) {
    const to = n - 1 + (lt - (old.length - 1));
    return { kind: 'logical', range: { from: to - (lt - lf), to } };
  }
  if (old.from == null || old.to == null) return null;
  const first = candles[0].time;
  const last = candles[n - 1].time;
  const to = Math.min(old.to, last);
  if (old.from > to) return null;
  if (old.from < first) return { kind: 'time', from: old.from, to, needFrom: old.from };
  if (windowBars(candles, old.from, to) < MIN_RANGE_BARS) return null;
  return { kind: 'time', from: old.from, to, needFrom: null };
}
