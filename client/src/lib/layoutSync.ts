/**
 * Pure helpers for "Sync in layout": the change a chart announces, the bar lookup the crosshair sync needs, and a
 * small in-memory bus that carries the view syncs (crosshair, visible time range) between the mounted charts.
 */
import type { Candle, Interval } from '../types';
import type { TimeRange } from './timeRange';

/** A committed change on one chart that other charts may follow. */
export type SyncChange =
  | { kind: 'symbol'; providerId: string; symbol: string }
  | { kind: 'interval'; timeframe: Interval }
  | { kind: 'range'; range: TimeRange | null };

/** Opt-out for the actions a sync applies to the receiving charts: they must never announce again. */
export interface BroadcastOpt {
  broadcast?: boolean;
}

/**
 * The open time of the bar whose span contains `time`, or null before the first bar or after the end of the last
 * (the last bar's span is taken to be as long as the one before it). `candles` is sorted by time.
 */
export function barTimeAt(candles: readonly Candle[], time: number): number | null {
  const n = candles.length;
  if (n === 0 || time < candles[0].time) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (candles[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  if (lo === n - 1 && n > 1 && time >= candles[n - 1].time + (candles[n - 1].time - candles[n - 2].time)) return null;
  if (lo === n - 1 && n === 1 && time > candles[0].time) return null;
  return candles[lo].time;
}

export interface CrosshairSync {
  time: number;
  price: number;
  providerId: string;
  symbol: string;
}

export interface TimeRangeSync {
  from: number;
  to: number;
}

export interface ViewHandlers {
  crosshair?(pos: CrosshairSync | null): void;
  timeRange?(range: TimeRangeSync): void;
}

const subscribers = new Map<string, ViewHandlers>();

/** Registers a chart's handlers; returns the unsubscribe. */
export function subscribe(chartId: string, handlers: ViewHandlers): () => void {
  subscribers.set(chartId, handlers);
  return () => {
    if (subscribers.get(chartId) === handlers) subscribers.delete(chartId);
  };
}

/** Delivers a crosshair position (null: the pointer left) to every chart but the source. */
export function publishCrosshair(sourceId: string, pos: CrosshairSync | null): void {
  for (const [id, h] of [...subscribers]) if (id !== sourceId) h.crosshair?.(pos);
}

/** Delivers a visible time range to every chart but the source. */
export function publishTimeRange(sourceId: string, range: TimeRangeSync): void {
  for (const [id, h] of [...subscribers]) if (id !== sourceId) h.timeRange?.(range);
}

let hovered: string | null = null;

/** Records which chart the pointer is over (null: none). */
export function setHovered(chartId: string, over: boolean): void {
  if (over) hovered = chartId;
  else if (hovered === chartId) hovered = null;
}

/**
 * Whether a chart's visible-range changes are the person's own: the chart under the pointer, else the active chart
 * (keyboard input). Every other chart is only following.
 */
export function drivesTime(chartId: string, active: boolean): boolean {
  return hovered != null ? hovered === chartId : active;
}

/** Two visible ranges are the same when their ends differ by under a second: the chart rounds them to its own bars. */
export function sameTimeRange(a: TimeRangeSync | null, b: TimeRangeSync | null): boolean {
  return !!a && !!b && Math.abs(a.from - b.from) < 1 && Math.abs(a.to - b.to) < 1;
}
