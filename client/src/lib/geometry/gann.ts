/**
 * Pure Gann maths shared by the four Gann tools (box, square fixed, square, fan). No chart or React imports.
 *
 * What the tools follow (TradingView's help pages were not reachable from the build environment, so the shapes
 * below are the ones its Gann tools are known for, and the defaults are the ones the Fibonacci tools already use):
 * - Gann box: two points, opposite corners; price and time level tables 0, 0.25, 0.382, 0.5, 0.618, 0.75, 1; the
 *   box diagonals are its angles.
 * - Gann square: two points, opposite corners of a free rectangle; point 1 is the origin of its fans and arcs.
 *   Three tables, each with its own toggle and colour per entry: levels (grid lines), fans (1x4 ... 4x1) and arcs.
 * - Gann square fixed: the same, but the square is held 1:1 in pixels. Its side is the larger of the two point
 *   distances, so the second point only picks the direction and size; see {@link fixedSquareCorner}.
 * - Gann fan: two points; lines from point 1 at 1x8 ... 8x1 of the box the points span, 1x1 through point 2.
 */
import type { Pt } from '../drawingGeometry';

/** The box's (and the square's) default level ratios. */
export const GANN_BOX_LEVELS: readonly number[] = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
/** The fan's default lines: 1x8, 1x4, 1x3, 1x2, 1x1, 2x1, 3x1, 4x1, 8x1. */
export const GANN_FAN_LEVELS: readonly number[] = [0.125, 0.25, 0.333, 0.5, 1, 2, 3, 4, 8];
/** The square's default fans: 1x4, 1x2, 1x1, 2x1, 4x1. */
export const GANN_SQUARE_FAN_LEVELS: readonly number[] = [0.25, 0.5, 1, 2, 4];
/** The square's default arcs, as fractions of the square. */
export const GANN_SQUARE_ARC_LEVELS: readonly number[] = [0.25, 0.382, 0.5, 0.618, 0.75, 1];

/** Coordinate of level r between `from` (0) and `to` (1); reversed, the ratio is measured from `to`. */
export function boxCoord(from: number, to: number, r: number, reverse = false): number {
  return from + (to - from) * (reverse ? 1 - r : r);
}

/** A fan value as its ratio label: 0.125 is "1x8", 1 is "1x1", 4 is "4x1". */
export function ratioLabel(v: number): string {
  return v >= 1 ? `${Math.round(v)}x1` : `1x${Math.round(1 / v)}`;
}

/**
 * Where fan line v from a ends on the box that a and b span: 1 is the diagonal through b; a larger value is steeper
 * and ends on the far horizontal edge (2x1 at half the box width), a smaller one ends on the far vertical edge
 * (1x2 at half the box height). Null for a value that is not positive and finite.
 */
export function fanEnd(a: Pt, b: Pt, v: number): Pt | null {
  if (!(v > 0) || !Number.isFinite(v)) return null;
  return v >= 1 ? { x: a.x + (b.x - a.x) / v, y: b.y } : { x: b.x, y: a.y + (b.y - a.y) * v };
}

/** The point `reach` away from `from` on the ray through `through`; null when the two are the same point. */
export function farPoint(from: Pt, through: Pt, reach: number): Pt | null {
  const d = Math.hypot(through.x - from.x, through.y - from.y);
  if (!(d > 1e-9)) return null;
  return { x: from.x + ((through.x - from.x) / d) * reach, y: from.y + ((through.y - from.y) / d) * reach };
}

/** The second corner of the fixed square: the side is the larger of |dx| and |dy|, in the direction of b. */
export function fixedSquareCorner(a: Pt, b: Pt): Pt {
  const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return { x: a.x + (b.x < a.x ? -side : side), y: a.y + (b.y < a.y ? -side : side) };
}

/** A quarter arc around a, in the rectangle a-b, at ratio r of its width and height, as a polyline. */
export function squareArc(a: Pt, b: Pt, r: number, steps = 24): Pt[] {
  const rx = (b.x - a.x) * r;
  const ry = (b.y - a.y) * r;
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    out.push({ x: a.x + rx * Math.cos(t), y: a.y + ry * Math.sin(t) });
  }
  return out;
}

/** The fan's bands: for each pair of neighbouring ends, the polygon from a through both (and b when they straddle it). */
export function fanBands(a: Pt, b: Pt, ends: readonly { v: number; end: Pt }[]): Pt[][] {
  const out: Pt[][] = [];
  for (let i = 1; i < ends.length; i++) {
    const p = ends[i - 1];
    const q = ends[i];
    out.push(p.v < 1 && q.v > 1 ? [a, p.end, b, q.end] : [a, p.end, q.end]);
  }
  return out;
}
