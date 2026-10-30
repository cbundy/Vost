/** Pure maths for freehand strokes (the brush and the highlighter): thinning, smoothing and hit testing. No chart or React imports. */
import type { Pt } from '../drawingGeometry';
import { polylineHit } from './shapes';

const distToChord = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
};

/** Ramer-Douglas-Peucker: the points that keep every dropped one within `tolerance` of the result. Iterative; the ends are always kept. */
export function simplify(pts: readonly Pt[], tolerance: number): Pt[] {
  if (pts.length <= 2) return [...pts];
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToChord(pts[i], pts[lo], pts[hi]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = true;
      stack.push([lo, at], [at, hi]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Thins with `tolerance`, raising it until at most `cap` points remain (the cap is at least 2). The ends are kept. */
export function thinToCap(pts: readonly Pt[], cap: number, tolerance: number): Pt[] {
  const max = Math.max(2, cap);
  let tol = Math.max(tolerance, 0);
  let out = simplify(pts, tol);
  while (out.length > max) {
    tol = tol > 0 ? tol * 1.5 : 0.5;
    out = simplify(pts, tol);
  }
  return out;
}

/**
 * The curve drawn through a stroke's points: Chaikin corner cutting, one pass per 5 of `smoothing` (0 to 20, at most 4
 * passes). The first and last points are kept; smoothing 0 returns the points as they are.
 */
export function smoothPath(pts: readonly Pt[], smoothing: number): Pt[] {
  const passes = Math.min(4, Math.ceil(Math.max(0, smoothing) / 5));
  let cur = [...pts];
  for (let k = 0; k < passes && cur.length > 2; k++) {
    const next: Pt[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Whether p is within `halfWidth + tolerance` of the stroke through `pts`. */
export function strokeHit(pts: readonly Pt[], p: Pt, halfWidth: number, tolerance: number): boolean {
  return polylineHit(pts, p, false, halfWidth + tolerance);
}
