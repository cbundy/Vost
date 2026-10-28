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
