/** Pure maths of the channel tools: parallel offsets, linear regression, flat and disjoint edges. No chart imports. */
import type { OhlcBar, Pt } from '../drawingGeometry';

/** The bar value a regression is fitted to. */
export const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'] as const;
export type Source = (typeof SOURCES)[number];

/** One bar's value for a source; the close for an unknown source. */
export function sourceValue(bar: OhlcBar, source: string): number {
  switch (source) {
    case 'open':
      return bar.open;
    case 'high':
      return bar.high;
    case 'low':
      return bar.low;
    case 'hl2':
      return (bar.high + bar.low) / 2;
    case 'hlc3':
      return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4':
      return (bar.open + bar.high + bar.low + bar.close) / 4;
    default:
      return bar.close;
  }
}

/** A least-squares line over consecutive bars: value at bar index k is `intercept + slope * (k - firstIndex)`. */
export type Regression = {
  /** Bars fitted (at least 2). */
  n: number;
  /** Index (in the candle list) of the first fitted bar. */
  firstIndex: number;
  /** Price change per bar. */
  slope: number;
  /** The fitted price at the first bar. */
  intercept: number;
  /** Population standard deviation of the source around the line. */
  stdev: number;
};

/** First index whose time is >= t in an ascending list. */
function lowerBound(candles: readonly OhlcBar[], t: number): number {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The linear regression of `source` over the bars with time between the two times (inclusive, in either order).
 * Null when fewer than two bars fall in the range.
 */
export function regression(candles: readonly OhlcBar[], timeA: number, timeB: number, source: string): Regression | null {
  const lo = Math.min(timeA, timeB);
  const hi = Math.max(timeA, timeB);
  const first = lowerBound(candles, lo);
  let end = first;
  while (end < candles.length && candles[end].time <= hi) end++;
  const n = end - first;
  if (n < 2) return null;
  let sumY = 0;
  for (let i = first; i < end; i++) sumY += sourceValue(candles[i], source);
  const meanX = (n - 1) / 2;
  const meanY = sumY / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    sxy += dx * (sourceValue(candles[first + i], source) - meanY);
    sxx += dx * dx;
  }
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const r = sourceValue(candles[first + i], source) - (intercept + slope * i);
    ss += r * r;
  }
  return { n, firstIndex: first, slope, intercept, stdev: Math.sqrt(ss / n) };
}

/** The regression line's price at a (fractional) bar index. */
export function regressionAt(r: Regression, index: number): number {
  return r.intercept + r.slope * (index - r.firstIndex);
}

/** y of the line a-b at x; a.y for a vertical line. */
export function lineYAt(a: Pt, b: Pt, x: number): number {
  return b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** How far (vertically) the second edge of a parallel channel lies from the line a-b: c is on the second edge. */
export function parallelOffset(a: Pt, b: Pt, c: Pt): number {
  return c.y - lineYAt(a, b, c.x);
}

/** The second edge of a parallel channel: a-b moved vertically by `offset`. */
export function parallelEdge(a: Pt, b: Pt, offset: number): [Pt, Pt] {
  return [{ x: a.x, y: a.y + offset }, { x: b.x, y: b.y + offset }];
}

/**
 * The segment a-b continued to the pane's left (x = 0) and right (x = width) edge. The result runs left to right; a
 * vertical segment is not continued.
 */
export function extendAcross(a: Pt, b: Pt, width: number, left: boolean, right: boolean): [Pt, Pt] {
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  if (l.x === r.x) return [{ ...l }, { ...r }];
  return [left && l.x > 0 ? { x: 0, y: lineYAt(l, r, 0) } : { ...l }, right && r.x < width ? { x: width, y: lineYAt(l, r, width) } : { ...r }];
}

/** The flat edge of a flat top/bottom: from the sloped edge's first x to its second x at c's y. */
export function flatEdge(a: Pt, b: Pt, c: Pt): [Pt, Pt] {
  return [{ x: a.x, y: c.y }, { x: b.x, y: c.y }];
}

/**
 * The second edge of a disjoint channel: it starts at c and mirrors the first edge a-b across the horizontal (same
 * horizontal run, opposite rise), so the two edges are not parallel unless the first is flat.
 */
export function disjointEdge(a: Pt, b: Pt, c: Pt): [Pt, Pt] {
  return [{ ...c }, { x: c.x + (b.x - a.x), y: c.y - (b.y - a.y) }];
}

/** Whether p is inside the polygon (even-odd rule). */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
