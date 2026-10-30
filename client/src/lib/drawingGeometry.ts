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

/**
 * The time of the whole bar slot nearest a fractional logical index: a bar's own time inside the data, a whole
 * step past either end; 0 with no bars.
 */
export function barSlotTime(times: readonly number[], logical: number): number {
  return logicalToTime(times, Math.round(logical));
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
 * `priceOnly` keeps the time (a horizontal line); `timeOnly` keeps the price (a vertical line).
 */
export function snapToBar(
  candles: readonly OhlcBar[],
  anchor: { time: number; price: number },
  opts: { priceOnly?: boolean; timeOnly?: boolean } = {},
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
  return { time: opts.priceOnly ? anchor.time : bar.time, price: opts.timeOnly ? anchor.price : price };
}

/** Where the ray from a through b leaves the pane [0,width] x [0,height]; a itself when a equals b. */
export function rayEnd(a: Pt, b: Pt, width: number, height: number): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return { ...a };
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (width - a.x) / dx);
  else if (dx < 0) t = Math.min(t, (0 - a.x) / dx);
  if (dy > 0) t = Math.min(t, (height - a.y) / dy);
  else if (dy < 0) t = Math.min(t, (0 - a.y) / dy);
  t = Math.max(0, t);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * The segment a-b drawn on the pane, optionally continued past b (`right`) and back past a (`left`) until it
 * leaves the pane [0,width] x [0,height]. An end already outside the pane stays where it is.
 */
export function extendSegment(a: Pt, b: Pt, width: number, height: number, left: boolean, right: boolean): [Pt, Pt] {
  const far = (from: Pt, to: Pt): Pt => {
    const end = rayEnd(from, to, width, height);
    return Math.hypot(end.x - from.x, end.y - from.y) < Math.hypot(to.x - from.x, to.y - from.y) ? { ...to } : end;
  };
  return [left ? far(b, a) : { ...a }, right ? far(a, b) : { ...b }];
}

/** Whether p is inside the rectangle with opposite corners a and b, or within tol of its border. */
export function pointInRect(p: Pt, a: Pt, b: Pt, tol: number): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - tol &&
    p.x <= Math.max(a.x, b.x) + tol &&
    p.y >= Math.min(a.y, b.y) - tol &&
    p.y <= Math.max(a.y, b.y) + tol
  );
}

/** The four corners of the rectangle with opposite corners a and b: top-left, top-right, bottom-right, bottom-left. */
export function rectCorners(a: Pt, b: Pt): Pt[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** The new opposite corners [a, b] when corner (an index of {@link rectCorners}) is dragged to q: the opposite corner stays. */
export function rectCornerDrag(a: Pt, b: Pt, corner: number, q: Pt): [Pt, Pt] {
  const opposite = rectCorners(a, b)[(corner + 2) % 4];
  return [opposite, { x: q.x, y: q.y }];
}

/**
 * Word-wraps text into lines no wider than maxWidth by the given width function. Breaks at spaces; a single
 * word wider than maxWidth is broken by characters. Always returns at least one line.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const joined = line ? `${line} ${word}` : word;
      if (measure(joined) <= maxWidth) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      while (rest && measure(rest) > maxWidth) {
        let n = 1;
        while (n < rest.length && measure(rest.slice(0, n + 1)) <= maxWidth) n++;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export type MeasureSummary = {
  /** End price minus start price. */
  change: number;
  /** Change as a percent of the start price, or null when the start price is 0. */
  pct: number | null;
  /** Absolute number of bars between the two times. */
  bars: number;
  /** Absolute seconds between the two times. */
  seconds: number;
  direction: 'up' | 'down' | 'flat';
};

/** The numbers the measure tool shows between two anchors; bar times give the bar count. */
export function measureSummary(
  start: { time: number; price: number },
  end: { time: number; price: number },
  times: readonly number[],
): MeasureSummary {
  const change = end.price - start.price;
  return {
    change,
    pct: start.price === 0 ? null : (change / start.price) * 100,
    bars: Math.abs(Math.round(timeToLogical(times, end.time) - timeToLogical(times, start.time))),
    seconds: Math.abs(end.time - start.time),
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  };
}
