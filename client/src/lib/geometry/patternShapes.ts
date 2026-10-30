import type { Pt } from '../drawingGeometry';

/**
 * The parts of the Head and shoulders and Triangle pattern drawings that are not legs between the points: the
 * neckline, the triangle's two lines and the fills they bound. Pure: no React and no canvas. Pixel coordinates.
 *
 * Sources (TradingView help pages, checked 2026-10-30):
 *  - Triangle pattern https://www.tradingview.com/support/solutions/43000570208-triangle-pattern-drawing-tool/ :
 *    four points A B C D, A and C on consecutive highs (or lows) and B and D on the alternate ones; the lines A-C and
 *    B-D converge to the apex; a Background fill. The apex extension and the fill polygon follow that description.
 *  - Head and shoulders https://www.tradingview.com/support/solutions/43000570149-head-and-shoulders-drawing-tool/ :
 *    it describes the left shoulder, head and right shoulder on a base line called the neckline. It gives no point
 *    count or settings: the seven points, the neckline through the two neck points ending where it crosses the outer
 *    legs, and the three fills follow the pattern's definition.
 */

/** A drawing part: extra lines and filled polygons (each at least three points) computed from the points. */
export interface PatternShape {
  lines: readonly (readonly [Pt, Pt])[];
  fills: readonly (readonly Pt[])[];
}

const finite = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Where the segment a-b crosses the infinite line through n and m, or null when parallel or not crossing. */
function crossSegmentWithLine(a: Pt, b: Pt, n: Pt, m: Pt): Pt | null {
  const side = (p: Pt) => (m.x - n.x) * (p.y - n.y) - (m.y - n.y) * (p.x - n.x);
  const sa = side(a);
  const sb = side(b);
  if (sa === sb) return null;
  const t = sa / (sa - sb);
  if (!(t >= 0 && t <= 1)) return null;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The point of the line n-m at x, or null for a vertical line. */
function lineAtX(n: Pt, m: Pt, x: number): Pt | null {
  if (m.x === n.x) return null;
  return { x, y: n.y + ((m.y - n.y) * (x - n.x)) / (m.x - n.x) };
}

/**
 * The ends of the neckline through the neck points `n` (P2) and `m` (P4): where it crosses the left leg P0-P1 and
 * the right leg P5-P6. A leg it does not cross, or a missing one, ends it at the x of the leg's outer point (P0 on
 * the left, P6 on the right), and at the neck point itself when the neckline is vertical.
 */
export function necklineEnds(p0: Pt, p1: Pt, n: Pt, m: Pt, p5?: Pt, p6?: Pt): { left: Pt; right: Pt } {
  const left = crossSegmentWithLine(p0, p1, n, m) ?? lineAtX(n, m, p0.x) ?? { ...n };
  const right = p5 && p6 ? (crossSegmentWithLine(p5, p6, n, m) ?? lineAtX(n, m, p6.x) ?? { ...m }) : { ...m };
  return { left, right };
}

/** The part of the segment a-b inside the pane [0,width] x [0,height], or null when none is. */
export function clipSegment(a: Pt, b: Pt, width: number, height: number): [Pt, Pt] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x], [dx, width - a.x], [-dy, a.y], [dy, height - a.y]] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  if (t0 > t1) return null;
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
}

/** Head and shoulders: the neckline once P4 exists, and a fill per shoulder and the head once their points exist. */
export function headAndShouldersShape(p: readonly Pt[], width: number, height: number): PatternShape {
  if (p.length < 5 || !p.slice(0, 5).every(finite)) return { lines: [], fills: [] };
  const [p0, p1, p2, p3, p4] = p;
  if (p2.x === p4.x && p2.y === p4.y) return { lines: [], fills: [] };
  const full = p.length >= 7 && finite(p[5]) && finite(p[6]);
  const { left, right } = necklineEnds(p0, p1, p2, p4, full ? p[5] : undefined, full ? p[6] : undefined);
  const clipped = clipSegment(left, right, width, height);
  return {
    lines: clipped ? [clipped] : [],
    fills: [[left, p1, p2], [p2, p3, p4], ...(full ? [[p4, p[5], right]] : [])],
  };
}

/** The intersection of the lines a-b and c-d, or null when they are parallel or one has no length. */
export function lineIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (den === 0 || !Number.isFinite(den)) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const q = { x: a.x + rx * t, y: a.y + ry * t };
  return finite(q) ? q : null;
}

/**
 * The apex of the triangle A B C D: where A-C and B-D meet, when that is to the right of both C and D and inside
 * the pane; otherwise null.
 */
export function triangleApex(a: Pt, b: Pt, c: Pt, d: Pt, width: number, height: number): Pt | null {
  const q = lineIntersection(a, c, b, d);
  if (!q || !(q.x > Math.max(c.x, d.x)) || q.x > width || q.y < 0 || q.y > height) return null;
  return q;
}

/** Triangle pattern: the line A-C (once C exists), B-D (once D exists), and the fill once all four exist. */
export function triangleShape(p: readonly Pt[], width: number, height: number): PatternShape {
  if (p.length < 3 || !p.slice(0, 4).every(finite)) return { lines: [], fills: [] };
  const [a, b, c, d] = p;
  if (!d) return { lines: [[a, c]], fills: [] };
  const apex = triangleApex(a, b, c, d, width, height);
  if (apex) return { lines: [[a, apex], [b, apex]], fills: [[a, b, apex]] };
  return { lines: [[a, c], [b, d]], fills: [[a, c, d, b]] };
}
