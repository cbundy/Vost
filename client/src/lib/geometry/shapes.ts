import { distToSegment, type Pt } from '../drawingGeometry';

/** The circle's radius in pixels: the distance from its centre to the point on its edge. */
export function circleRadius(centre: Pt, edge: Pt): number {
  return Math.hypot(edge.x - centre.x, edge.y - centre.y);
}

/** Whether p is on the circle's border (within `tolerance`), or anywhere inside it when it is `filled`. */
export function circleHit(centre: Pt, edge: Pt, p: Pt, filled: boolean, tolerance: number): boolean {
  const r = circleRadius(centre, edge);
  const d = Math.hypot(p.x - centre.x, p.y - centre.y);
  return filled ? d <= r + tolerance : Math.abs(d - r) <= tolerance;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * The outline of the arrow marker: a shaft from `tail` to a head whose tip is `tip`. The shaft width is a tenth of the
 * length (3 to 12 pixels), the head is 2.5 shaft widths wide and a third of the length long (10 to 40 pixels, never
 * longer than the arrow). Seven points, clockwise from the tail's left; none when the points are equal.
 */
export function arrowMarkerOutline(tail: Pt, tip: Pt): Pt[] {
  const len = Math.hypot(tip.x - tail.x, tip.y - tail.y);
  if (len === 0) return [];
  const ux = (tip.x - tail.x) / len;
  const uy = (tip.y - tail.y) / len;
  const nx = -uy;
  const ny = ux;
  const shaft = clamp(len * 0.1, 3, 12) / 2;
  const head = shaft * 2.5;
  const headLen = Math.min(len, clamp(len / 3, 10, 40));
  const bx = tip.x - ux * headLen;
  const by = tip.y - uy * headLen;
  const at = (x: number, y: number, w: number): Pt => ({ x: x + nx * w, y: y + ny * w });
  return [at(tail.x, tail.y, -shaft), at(bx, by, -shaft), at(bx, by, -head), { x: tip.x, y: tip.y }, at(bx, by, head), at(bx, by, shaft), at(tail.x, tail.y, shaft)];
}

/** Whether p is inside the polygon, or within `tolerance` of its edge. */
export function pointInPolygon(p: Pt, poly: readonly Pt[], tolerance = 0): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    if (tolerance > 0 && distToSegment(p, a, b) <= tolerance) return true;
  }
  return inside;
}

/** Pixel size of an arrow mark: the head is `HEAD_W` wide and `HEAD_H` long, the shaft `SHAFT_W` wide, the whole arrow `LENGTH` long. */
export const MARK = { HEAD_W: 16, HEAD_H: 10, SHAFT_W: 6, LENGTH: 22 } as const;

export type MarkDirection = 'up' | 'down';

/**
 * The outline of an arrow mark with its tip at `tip`: an "up" mark points up and sits below the point, a "down" mark
 * points down and sits above it. Seven points, clockwise from the tip.
 */
export function arrowMarkOutline(tip: Pt, dir: MarkDirection): Pt[] {
  const s = dir === 'up' ? 1 : -1;
  const { HEAD_W, HEAD_H, SHAFT_W, LENGTH } = MARK;
  const hw = HEAD_W / 2;
  const sw = SHAFT_W / 2;
  return [
    { x: tip.x, y: tip.y },
    { x: tip.x + hw, y: tip.y + s * HEAD_H },
    { x: tip.x + sw, y: tip.y + s * HEAD_H },
    { x: tip.x + sw, y: tip.y + s * LENGTH },
    { x: tip.x - sw, y: tip.y + s * LENGTH },
    { x: tip.x - sw, y: tip.y + s * HEAD_H },
    { x: tip.x - hw, y: tip.y + s * HEAD_H },
  ];
}

export type Rect = { x: number; y: number; w: number; h: number };

const LABEL_GAP = 4;

/** The box of a label (`w` by `h`) beyond an arrow mark's tail: below an "up" mark, above a "down" mark, centred on the point. */
export function arrowMarkLabelRect(tip: Pt, dir: MarkDirection, w: number, h: number): Rect {
  const y = dir === 'up' ? tip.y + MARK.LENGTH + LABEL_GAP : tip.y - MARK.LENGTH - LABEL_GAP - h;
  return { x: tip.x - w / 2, y, w, h };
}

/** The box of a label (`w` by `h`) at the arrow marker's tail, pushed away from the tip; null for equal points. */
export function arrowMarkerLabelRect(tail: Pt, tip: Pt, w: number, h: number): Rect | null {
  const len = Math.hypot(tip.x - tail.x, tip.y - tail.y);
  if (len === 0) return null;
  const bx = (tail.x - tip.x) / len;
  const by = (tail.y - tip.y) / len;
  const cx = tail.x + bx * (w / 2 + LABEL_GAP);
  const cy = tail.y + by * (h / 2 + LABEL_GAP);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Whether p is inside the box, within `tolerance`. */
export function inRect(r: Rect | null, at: Pt, tolerance = 0): boolean {
  return !!r && at.x >= r.x - tolerance && at.x <= r.x + r.w + tolerance && at.y >= r.y - tolerance && at.y <= r.y + r.h + tolerance;
}

/** Whether p is within `tolerance` of any segment of the polyline through `pts`, and of the closing segment too when `closed`. Safe for no points, one point and repeated points. */
export function polylineHit(pts: readonly Pt[], p: Pt, closed: boolean, tolerance: number): boolean {
  if (pts.length === 0) return false;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tolerance;
  const n = closed && pts.length > 2 ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) if (distToSegment(p, pts[i], pts[(i + 1) % pts.length]) <= tolerance) return true;
  return false;
}

/** The signed perpendicular distance of c from the line a-b (positive on the side of the normal (-uy, ux)); zero when a and b are equal. */
export function sideDistance(a: Pt, b: Pt, c: Pt): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return 0;
  return ((c.x - a.x) * -(b.y - a.y) + (c.y - a.y) * (b.x - a.x)) / len;
}

/** The unit normal of a-b, (-uy, ux); (0, 0) when a and b are equal. */
export function sideNormal(a: Pt, b: Pt): Pt {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return len === 0 ? { x: 0, y: 0 } : { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

/** A point at distance `dist` from the middle of a-b along the side's normal (the bulge top of an arc, the minor axis end of an ellipse). */
export function sideMidOffset(a: Pt, b: Pt, dist: number): Pt {
  const n = sideNormal(a, b);
  return { x: (a.x + b.x) / 2 + n.x * dist, y: (a.y + b.y) / 2 + n.y * dist };
}

/** The point c' such that the side a-b with c' has the same signed width as before: a point `width` from a along the normal. */
export function pointAtWidth(a: Pt, b: Pt, width: number): Pt {
  const n = sideNormal(a, b);
  return { x: a.x + n.x * width, y: a.y + n.y * width };
}

/** The four corners of the rotated rectangle: side a-b, then the same side moved by the signed distance of c from it. */
export function rotatedRectCorners(a: Pt, b: Pt, c: Pt): Pt[] {
  const n = sideNormal(a, b);
  const w = sideDistance(a, b, c);
  return [a, b, { x: b.x + n.x * w, y: b.y + n.y * w }, { x: a.x + n.x * w, y: a.y + n.y * w }];
}

/** The ellipse through the axis a-b and the third point: centre, semi-axes and the axis' rotation in radians. */
export type EllipseShape = { cx: number; cy: number; rx: number; ry: number; rot: number };

export function ellipseFrom3(a: Pt, b: Pt, c: Pt): EllipseShape {
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    rx: Math.hypot(b.x - a.x, b.y - a.y) / 2,
    ry: Math.abs(sideDistance(a, b, c)),
    rot: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** A point of the ellipse at parameter t (radians); `ry` may be negative to flip the side. */
function ellipsePoint(e: EllipseShape, t: number, ry = e.ry): Pt {
  const lx = e.rx * Math.cos(t);
  const ly = ry * Math.sin(t);
  const cos = Math.cos(e.rot);
  const sin = Math.sin(e.rot);
  return { x: e.cx + lx * cos - ly * sin, y: e.cy + lx * sin + ly * cos };
}

/** The closed outline of the ellipse as `steps` points (the first is not repeated). */
export function ellipseOutline(e: EllipseShape, steps = 96): Pt[] {
  return Array.from({ length: steps }, (_, i) => ellipsePoint(e, (i / steps) * Math.PI * 2));
}

/** Whether p is on the ellipse's border (within `tolerance`), or anywhere inside it when it is `filled`. */
export function ellipseHit(e: EllipseShape, p: Pt, filled: boolean, tolerance: number): boolean {
  const outline = ellipseOutline(e);
  return polylineHit(outline, p, true, tolerance) || (filled && pointInPolygon(p, outline));
}

/** The arc from a to b: the half of the ellipse with axis a-b and the signed other semi-axis `sideDistance(a, b, c)`, as `steps + 1` points from a to b. */
export function arcPoints(a: Pt, b: Pt, c: Pt, steps = 64): Pt[] {
  const e = ellipseFrom3(a, b, c);
  const d = sideDistance(a, b, c);
  // t runs from pi (point a) to 0 (point b); the sign of d puts the bulge on c's side.
  return Array.from({ length: steps + 1 }, (_, i) => ellipsePoint(e, Math.PI * (1 - i / steps), d));
}

/** Points of the quadratic Bezier a, control, b (`steps + 1` of them). */
export function quadraticPoints(a: Pt, control: Pt, b: Pt, steps = 48): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y };
  });
}

/** Points of the cubic Bezier a, c1, c2, b (`steps + 1` of them). */
export function cubicPoints(a: Pt, c1: Pt, c2: Pt, b: Pt, steps = 64): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    const k0 = u * u * u;
    const k1 = 3 * u * u * t;
    const k2 = 3 * u * t * t;
    const k3 = t * t * t;
    return { x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x, y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y };
  });
}

/**
 * The curve through the points a (start), b (end) and its control points: none is a straight line, one a quadratic
 * Bezier, two a cubic one. Points are given as the tool stores them: start, end, then the controls.
 */
export function curvePoints(pts: readonly Pt[]): Pt[] {
  if (pts.length < 2) return [...pts];
  if (pts.length === 2) return [pts[0], pts[1]];
  if (pts.length === 3) return quadraticPoints(pts[0], pts[2], pts[1]);
  return cubicPoints(pts[0], pts[2], pts[3], pts[1]);
}

/** The fraction of its length a new curve's control point sits to one side of its chord. */
export const CURVE_BEND = 0.3;

/** The control point of a new quadratic curve from `a` to `b`: a fixed fraction of the length to one side of the middle. */
export function defaultCurveControl(a: Pt, b: Pt): Pt {
  return sideMidOffset(a, b, CURVE_BEND * Math.hypot(b.x - a.x, b.y - a.y));
}

/** The two control points of a new cubic curve from `a` to `b`: a third of the way along, bent to opposite sides (an S). */
export function defaultDoubleCurveControls(a: Pt, b: Pt): [Pt, Pt] {
  const n = sideNormal(a, b);
  const k = CURVE_BEND * Math.hypot(b.x - a.x, b.y - a.y);
  return [
    { x: a.x + (b.x - a.x) / 3 + n.x * k, y: a.y + (b.y - a.y) / 3 + n.y * k },
    { x: a.x + ((b.x - a.x) * 2) / 3 - n.x * k, y: a.y + ((b.y - a.y) * 2) / 3 - n.y * k },
  ];
}
