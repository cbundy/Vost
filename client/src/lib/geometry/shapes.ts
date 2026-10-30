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
