import type { Pt } from '../drawingGeometry';

/**
 * Chart-pattern maths (XABCD, Cypher, ABCD). Pure: no React and no canvas.
 *
 * The ratio lines follow TradingView's chart pattern tools, whose drawings join the points of the pattern with
 * dashed lines and label each with the ratio of two legs:
 *  - XABCD: X-B = AB/XA, A-C = BC/AB, B-D = CD/BC, X-D = AD/XA (the harmonic pattern definitions, for example the
 *    Gartley: B retraces 0.618 of XA, D retraces 0.786 of XA).
 *    Source: https://www.tradingview.com/support/solutions/43000569909-xabcd-pattern-drawing-tool/ (checked): it
 *    gives AB as a retracement of XA, BC as a retracement of AB "shown along the line AC" and CD as an extension of
 *    BC "shown along the line BD". The X-D line (AD/XA) is not on that page; it is the harmonic definition (D
 *    retraces XA).
 *  - Cypher: X-B = AB/XA, X-C = XC/XA (C extends beyond A, 1.13 to 1.414 of XA), X-D = CD/XC (D retraces 0.786 of
 *    XC). Source: https://www.tradingview.com/support/solutions/43000791680-cypher-harmonic-pattern-drawing-tool/
 *    (checked): B retraces 0.382 to 0.618 of XA, C is an extension of XA of 1.13 to 1.414, D is a 0.786 retracement
 *    of the entire XC leg.
 *  - ABCD: A-C = BC/AB, B-D = CD/BC (the same BC/AB and CD/BC legs the XABCD page describes).
 *    Source: https://www.tradingview.com/support/solutions/43000570202-abcd-pattern-drawing-tool/ (checked): it
 *    gives the legs AB, BC and CD ("Classic ABCD: CD should be either 127.2% or 161.8% of BC").
 *
 * A ratio is the absolute price move of one leg divided by the absolute price move of the other.
 */

/** A leg of the pattern, by the indexes of its two points. */
export type Leg = readonly [number, number];

/** A dashed ratio line from point `from` to point `to`, labelled num / den. */
export interface RatioLine {
  from: number;
  to: number;
  num: Leg;
  den: Leg;
  /** The leg names, for the tests and tooltips, for example "AB/XA". */
  name: string;
}

export interface PatternSpec {
  /** One letter per point, in order. */
  labels: readonly string[];
  /** The triangles (point indexes) that are filled once all three points exist. */
  fills: readonly (readonly [number, number, number])[];
  ratios: readonly RatioLine[];
}

const XABCD_LABELS = ['X', 'A', 'B', 'C', 'D'] as const;

export const XABCD: PatternSpec = {
  labels: XABCD_LABELS,
  fills: [[0, 1, 2], [2, 3, 4]],
  ratios: [
    { from: 0, to: 2, num: [1, 2], den: [0, 1], name: 'AB/XA' },
    { from: 1, to: 3, num: [2, 3], den: [1, 2], name: 'BC/AB' },
    { from: 2, to: 4, num: [3, 4], den: [2, 3], name: 'CD/BC' },
    { from: 0, to: 4, num: [1, 4], den: [0, 1], name: 'AD/XA' },
  ],
};

export const CYPHER: PatternSpec = {
  labels: XABCD_LABELS,
  fills: [[0, 1, 2], [2, 3, 4]],
  ratios: [
    { from: 0, to: 2, num: [1, 2], den: [0, 1], name: 'AB/XA' },
    { from: 0, to: 3, num: [0, 3], den: [0, 1], name: 'XC/XA' },
    { from: 0, to: 4, num: [3, 4], den: [0, 3], name: 'CD/XC' },
  ],
};

export const ABCD: PatternSpec = {
  labels: ['A', 'B', 'C', 'D'],
  fills: [],
  ratios: [
    { from: 0, to: 2, num: [1, 2], den: [0, 1], name: 'BC/AB' },
    { from: 1, to: 3, num: [2, 3], den: [1, 2], name: 'CD/BC' },
  ],
};

/** The ratio of leg a to leg b (absolute price moves), or null when b has no length or a price is not finite. */
export function legRatio(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  const r = Math.abs(a) / Math.abs(b);
  return Number.isFinite(r) ? r : null;
}

/** A ratio as the plain number shown on the chart: 3 decimals. */
export function formatRatio(r: number): string {
  return r.toFixed(3);
}

/** The ratio of a ratio line given the points' prices, or null when a point is missing or the divisor leg is flat. */
export function lineRatio(r: RatioLine, prices: readonly number[]): number | null {
  const [n0, n1] = r.num;
  const [d0, d1] = r.den;
  if ([n0, n1, d0, d1].some((i) => !(i < prices.length))) return null;
  return legRatio(prices[n1] - prices[n0], prices[d1] - prices[d0]);
}

/**
 * Where a point's letter goes: beside the point and away from the shape, that is opposite the direction to the
 * neighbouring points (the mean of the unit vectors to them). A lone or fully enclosed point goes above.
 */
export function labelOffset(pts: readonly Pt[], i: number, distance = 12): Pt {
  const p = pts[i];
  let sx = 0;
  let sy = 0;
  for (const j of [i - 1, i + 1]) {
    const q = pts[j];
    if (!q) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d === 0) continue;
    sx += (q.x - p.x) / d;
    sy += (q.y - p.y) / d;
  }
  const len = Math.hypot(sx, sy);
  if (len < 1e-6) return { x: p.x, y: p.y - distance };
  return { x: p.x - (sx / len) * distance, y: p.y - (sy / len) * distance };
}
