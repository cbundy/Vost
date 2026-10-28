/** Pure geometry for chart drawings: no chart imports, so it runs under the node test environment. */

export type Pt = { x: number; y: number };

/** Pixels around a point or line within which a press counts as a hit. */
export const HIT_TOLERANCE = 6;
/** Radius of the round handle drawn on a selected drawing's anchors. */
export const HANDLE_RADIUS = 5;
/** Pixels within which a press counts as grabbing a handle. */
export const HANDLE_HIT_RADIUS = 9;

/** Median gap between consecutive bar times (seconds); 60 when fewer than two bars. */
export function medianInterval(times: readonly number[]): number {
  if (times.length < 2) return 60;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const g = times[i] - times[i - 1];
    if (g > 0) gaps.push(g);
  }
  if (gaps.length === 0) return 60;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/** Index of the last time <= t in an ascending array, or -1. */
function lastAtOrBefore(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Time (unix seconds) to a fractional logical bar index: interpolated between bars,
 * extrapolated past either end by the median bar interval.
 */
export function timeToLogical(times: readonly number[], t: number): number {
  const n = times.length;
  if (n === 0) return 0;
  const step = medianInterval(times);
  if (t <= times[0]) return (t - times[0]) / step;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / step;
  const i = lastAtOrBefore(times, t);
  const span = times[i + 1] - times[i];
  return i + (t - times[i]) / span;
}

/** The inverse of {@link timeToLogical}. */
export function logicalToTime(times: readonly number[], logical: number): number {
  const n = times.length;
  if (n === 0) return 0;
  const step = medianInterval(times);
  if (logical <= 0) return times[0] + logical * step;
  if (logical >= n - 1) return times[n - 1] + (logical - (n - 1)) * step;
  const i = Math.floor(logical);
  return times[i] + (logical - i) * (times[i + 1] - times[i]);
}

/** Distance from point p to the segment a-b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Whether p is within the handle hit radius of a handle centre. */
export function hitsHandle(p: Pt, handle: Pt, radius = HANDLE_HIT_RADIUS): boolean {
  return Math.hypot(p.x - handle.x, p.y - handle.y) <= radius;
}

/** Handle hit radius for a touch pointer (a fingertip is wider than a mouse). */
export const TOUCH_HANDLE_HIT_RADIUS = 12;
/** Body hit tolerance for a touch pointer. */
export const TOUCH_HIT_TOLERANCE = 10;

export type HitOpts = { handleRadius: number; tolerance: number };
export const MOUSE_HIT: HitOpts = { handleRadius: HANDLE_HIT_RADIUS, tolerance: HIT_TOLERANCE };
export const TOUCH_HIT: HitOpts = { handleRadius: TOUCH_HANDLE_HIT_RADIUS, tolerance: TOUCH_HIT_TOLERANCE };

export type OhlcBar = { time: number; open: number; high: number; low: number; close: number };

/**
 * Magnet: when the anchor's fractional bar index is within half a bar of a real bar, moves it to that
 * bar's time and to the nearest of its open, high, low, close. Outside every bar it is returned as is.
 * `priceOnly` keeps the time (a horizontal line).
 */
export function snapToBar(
  candles: readonly OhlcBar[],
  anchor: { time: number; price: number },
  opts: { priceOnly?: boolean } = {},
): { time: number; price: number } {
  const n = candles.length;
  if (n === 0) return anchor;
  const logical = timeToLogical(
    candles.map((c) => c.time),
    anchor.time,
  );
  const i = Math.round(logical);
  if (i < 0 || i > n - 1 || Math.abs(logical - i) > 0.5) return anchor;
  const bar = candles[i];
  let price = bar.open;
  for (const v of [bar.high, bar.low, bar.close]) if (Math.abs(v - anchor.price) < Math.abs(price - anchor.price)) price = v;
  return { time: opts.priceOnly ? anchor.time : bar.time, price };
}
