/**
 * Pure Fibonacci maths shared by the Fibonacci tools: the level ratios and prices, the Fibonacci bar counts of the
 * time zone, circle, arc and spiral shapes, and the distances the tools hit test with. No chart or React imports.
 */
import { distToSegment, type Pt } from '../drawingGeometry';
import { clipLine, clipPolygon } from './pitchfork';

/** Fibonacci retracement ratios, from the end anchor (0) to the start anchor (1). */
export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/**
 * Price of each level: level r is end + (start - end) * r. Reversed, level r is measured from the start
 * anchor instead: start + (end - start) * r.
 */
export function fibLevelPrices(start: number, end: number, levels: readonly number[] = FIB_LEVELS, reverse = false): number[] {
  const [from, to] = reverse ? [start, end] : [end, start];
  return levels.map((r) => from + (to - from) * r);
}

/** The first `count` terms of the sequence the time zone counts bars by: 0, 1, 2, 3, 5, 8, 13, ... */
export function fibSequence(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i < 4) out.push(i);
    else out.push(out[i - 1] + out[i - 2]);
  }
  return out;
}

/** The time zone's default bar counts: 0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89. */
export const FIB_TIME_ZONE_LEVELS: readonly number[] = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
/** The speed resistance fan's default price and time ratios. */
export const FIB_SPEED_LEVELS: readonly number[] = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
/** The circles' default radii, as multiples of the radius through both points. */
export const FIB_CIRCLE_LEVELS: readonly number[] = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
/** The speed resistance arcs' default radii, as multiples of the distance between the points. */
export const FIB_ARC_LEVELS: readonly number[] = [0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** The trend-based extension's (and the Fib channel's) default ratios. */
export const FIB_EXTENSION_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
/** The trend-based time's default ratios. */
export const FIB_TREND_TIME_LEVELS: readonly number[] = [0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3, 3.618, 4.236];
/** The wedge's default radii, as multiples of the length of the edge A-B. */
export const FIB_WEDGE_LEVELS: readonly number[] = [0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** The golden ratio. */
export const GOLDEN = (1 + Math.sqrt(5)) / 2;

/** Pixel x of the time zone line n units from x0, one unit being x1 - x0. */
export function fibTimeX(x0: number, x1: number, n: number): number {
  return x0 + n * (x1 - x0);
}

/** Fractional logical bar index of time zone line n, from the anchors' logical indices. */
export function fibTimeLogical(l0: number, l1: number, n: number): number {
  return l0 + n * (l1 - l0);
}

/**
 * The point where fan line r ends on the box with corners start and end: on the vertical edge through end for a
 * price ratio, on the horizontal edge through end for a time ratio. Ratio 1 is the diagonal. Reversed, the ratio
 * is measured from the end corner instead.
 */
export function fanValue(start: number, end: number, r: number, reverse = false): number {
  return reverse ? end + (start - end) * r : start + (end - start) * r;
}

/** Radius of a circle level: the ratio times half the distance between the points (level 1 passes through both). */
export function circleRadius(a: Pt, b: Pt, ratio: number): number {
  return (Math.hypot(b.x - a.x, b.y - a.y) / 2) * Math.abs(ratio);
}

/** Radius of an arc level: the ratio times the distance between the points. */
export function arcRadius(a: Pt, b: Pt, ratio: number): number {
  return Math.hypot(b.x - a.x, b.y - a.y) * Math.abs(ratio);
}

/** Absolute distance from p to a circle of radius r around c. */
export function distToCircle(p: Pt, c: Pt, r: number): number {
  return Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r);
}

/**
 * Distance from p to a half circle of radius r around c, the half on the side of the direction (dx, dy). The ends
 * of the half circle count, so a point beyond them measures to the end. A full circle ignores the direction.
 */
export function distToArc(p: Pt, c: Pt, r: number, dir: Pt, full = false): number {
  if (full || (dir.x === 0 && dir.y === 0)) return distToCircle(p, c, r);
  const vx = p.x - c.x;
  const vy = p.y - c.y;
  if (vx * dir.x + vy * dir.y >= 0) return Math.abs(Math.hypot(vx, vy) - r);
  const len = Math.hypot(dir.x, dir.y);
  const nx = -dir.y / len;
  const ny = dir.x / len;
  return Math.min(Math.hypot(p.x - (c.x + nx * r), p.y - (c.y + ny * r)), Math.hypot(p.x - (c.x - nx * r), p.y - (c.y - ny * r)));
}

/** Whether p is on the half of the disc around c on the side of dir (always true for a full circle). */
export function onArcSide(p: Pt, c: Pt, dir: Pt, full = false): boolean {
  return full || (p.x - c.x) * dir.x + (p.y - c.y) * dir.y >= 0;
}

const SPIRAL_STEP = Math.PI / 36;
const SPIRAL_MAX_POINTS = 4000;

/**
 * Points of a golden spiral around `center` that passes through `through`: its radius grows by the golden ratio per
 * quarter turn. It starts where the radius is half a pixel (or at `through` when that is closer in) and ends when
 * the radius passes `maxRadius`. `ccw` turns it counter-clockwise on the screen. Empty when the points coincide.
 */
export function spiralPoints(center: Pt, through: Pt, ccw: boolean, maxRadius: number): Pt[] {
  const d = Math.hypot(through.x - center.x, through.y - center.y);
  if (!(d > 1e-6) || !Number.isFinite(maxRadius)) return [];
  const dir = ccw ? -1 : 1;
  const theta0 = Math.atan2(through.y - center.y, through.x - center.x);
  const perRad = Math.log(GOLDEN) / (Math.PI / 2);
  const from = d > 0.5 ? -Math.log(d / 0.5) / perRad : 0;
  const to = maxRadius > d ? Math.log(maxRadius / d) / perRad : 0;
  // Sample on a grid of whole steps from `through` (t = 0), so the curve passes exactly through it.
  const first = -Math.min(Math.ceil(-from / SPIRAL_STEP), SPIRAL_MAX_POINTS / 2);
  const last = Math.min(Math.ceil(to / SPIRAL_STEP), SPIRAL_MAX_POINTS / 2);
  const out: Pt[] = [];
  for (let i = first; i <= last; i++) {
    const t = i * SPIRAL_STEP;
    const r = d * Math.exp(perRad * t);
    out.push({ x: center.x + r * Math.cos(theta0 + dir * t), y: center.y + r * Math.sin(theta0 + dir * t) });
  }
  return out;
}

/** Distance from p to the spiral of {@link spiralPoints}; Infinity when there is none. */
export function distToSpiral(p: Pt, center: Pt, through: Pt, ccw: boolean): number {
  const reach = Math.hypot(p.x - center.x, p.y - center.y) * GOLDEN + 2;
  const pts = spiralPoints(center, through, ccw, reach);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  return best;
}

/* ------------------------- three-point Fibonacci tools ------------------------- */

/** Price of each trend-based extension level: C + (B - A) * r; reversed, C + (A - B) * r. */
export function extensionPrices(a: number, b: number, c: number, levels: readonly number[] = FIB_EXTENSION_LEVELS, reverse = false): number[] {
  const unit = reverse ? a - b : b - a;
  return levels.map((r) => c + unit * r);
}

/** The vertical offset of each Fib channel level from the line A-B: ratio times `d` (the pixel offset of C from A-B). */
export function fibChannelOffsets(d: number, levels: readonly number[] = FIB_EXTENSION_LEVELS): number[] {
  return levels.map((r) => d * r);
}

/** Pixel x of the trend-based time line r: x_C + (x_B - x_A) * r. */
export function trendTimeX(xa: number, xb: number, xc: number, r: number): number {
  return xc + (xb - xa) * r;
}

/** Fractional logical bar index of the trend-based time line r. */
export function trendTimeLogical(la: number, lb: number, lc: number, r: number): number {
  return lc + (lb - la) * r;
}

export type WedgeGeometry = {
  /** The length of the edge A-B: the radius of level 1. */
  radius: number;
  /** Angle of the edge A-B. */
  start: number;
  /** Signed angle from the edge A-B to the edge A-C, the smaller way round (-pi, pi]. */
  sweep: number;
  /** Angle of the edge A-C. */
  end: number;
};

/** The wedge's apex A, radius unit and sweep; null when A-B or A-C has no length. */
export function wedgeGeometry(a: Pt, b: Pt, c: Pt): WedgeGeometry | null {
  const radius = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(radius > 1e-9) || !Number.isFinite(radius)) return null;
  if (!(Math.hypot(c.x - a.x, c.y - a.y) > 1e-9)) return null;
  const start = Math.atan2(b.y - a.y, b.x - a.x);
  const end = Math.atan2(c.y - a.y, c.x - a.x);
  let sweep = end - start;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  return Number.isFinite(sweep) ? { radius, start, sweep, end } : null;
}

/** Whether the angle of p around a is within the wedge's sweep. */
export function inWedgeSweep(p: Pt, a: Pt, g: WedgeGeometry): boolean {
  let rel = Math.atan2(p.y - a.y, p.x - a.x) - g.start;
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel <= -Math.PI) rel += 2 * Math.PI;
  return g.sweep >= 0 ? rel >= 0 && rel <= g.sweep : rel <= 0 && rel >= g.sweep;
}

/** Distance from p to the wedge arc of radius r around a; the arc's ends count. */
export function distToWedgeArc(p: Pt, a: Pt, g: WedgeGeometry, r: number): number {
  if (inWedgeSweep(p, a, g)) return Math.abs(Math.hypot(p.x - a.x, p.y - a.y) - r);
  const e = (ang: number) => Math.hypot(p.x - (a.x + r * Math.cos(ang)), p.y - (a.y + r * Math.sin(ang)));
  return Math.min(e(g.start), e(g.end));
}

/** The two points of pitchfan level r on the line B-C: M + r(C - M) and M - r(C - M), M being the midpoint. */
export function pitchfanPoints(b: Pt, c: Pt, r: number): [Pt, Pt] {
  const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  return [{ x: m.x + r * (c.x - m.x), y: m.y + r * (c.y - m.y) }, { x: m.x - r * (c.x - m.x), y: m.y - r * (c.y - m.y) }];
}

export type PitchfanLevel = { value: number; color: string; on: boolean };
export type PitchfanShape = {
  /** The median A-M (clipped to the pane when extended, else ending at M). */
  median: [Pt, Pt] | null;
  /** Two lines per enabled level. */
  lines: { value: number; color: string; seg: [Pt, Pt] }[];
  /** Fills between neighbouring lines on each side, from the median outward. */
  fills: { color: string; poly: Pt[] }[];
};

/** Every line and fill of a pitchfan on a pane of the given size; empty when A, B and C do not span a fan. */
export function pitchfanShape(a: Pt, b: Pt, c: Pt, levels: readonly PitchfanLevel[], width: number, height: number, extend: boolean): PitchfanShape {
  const out: PitchfanShape = { median: null, lines: [], fills: [] };
  const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  if (![a, b, c].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return out;
  const seg = (to: Pt): [Pt, Pt] | null => {
    const d = { x: to.x - a.x, y: to.y - a.y };
    if (d.x === 0 && d.y === 0) return null;
    return extend ? clipLine(a, d, width, height, false) : [{ ...a }, { ...to }];
  };
  out.median = seg(m);
  const on = levels.filter((l) => l.on && Number.isFinite(l.value) && l.value !== 0).sort((x, y) => Math.abs(x.value) - Math.abs(y.value));
  const far = (to: Pt): Pt => {
    const len = Math.hypot(to.x - a.x, to.y - a.y);
    if (!(len > 0)) return { ...to };
    const k = (2 * (width + height + Math.abs(a.x) + Math.abs(a.y))) / len;
    return { x: a.x + (to.x - a.x) * k, y: a.y + (to.y - a.y) * k };
  };
  for (const side of [0, 1] as const) {
    let prevPt = m;
    let prevVal = 0;
    for (const l of on) {
      const pt = pitchfanPoints(b, c, Math.abs(l.value))[side];
      const s = seg(pt);
      if (s) out.lines.push({ value: l.value, color: l.color, seg: s });
      if (Math.abs(l.value) !== prevVal) {
        const poly = clipPolygon(extend ? [a, far(prevPt), far(pt)] : [a, prevPt, pt], width, height);
        if (poly.length >= 3) out.fills.push({ color: l.color, poly });
      }
      prevPt = pt;
      prevVal = Math.abs(l.value);
    }
  }
  return out;
}
