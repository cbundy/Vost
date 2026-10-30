import { distToSegment, type Pt } from '../drawingGeometry';
import { keepInside, type Size } from './notes';
import { pointInPolygon, type Rect } from './shapes';

/** Pure geometry of the price markers (Price note, Price label, Signpost, Flag mark). Sizes are in pixels. */

export const POLE = 24;
export const FLAG = { W: 16, H: 10 } as const;
export const DOT_R = 4;
const PLATE_GAP = 0;

export type PlatePosition = 'above' | 'below';

const finite = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Shifts a set of points so their bounding box lies inside the pane (a box larger than the pane sits at its corner). */
function shiftInside(pts: Pt[], pane: Size | undefined): Pt[] {
  if (!pane || !pts.every(finite)) return pts;
  const x0 = Math.min(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const w = Math.max(...pts.map((p) => p.x)) - x0;
  const h = Math.max(...pts.map((p) => p.y)) - y0;
  const r = keepInside(x0, y0, { width: w, height: h }, pane);
  return pts.map((p) => ({ x: p.x + r.x - x0, y: p.y + r.y - y0 }));
}

/** A pointed tag: its point at `tip`, its body (`size`) to the right. Kept inside the pane when one is given. */
export function priceTagOutline(tip: Pt, size: Size, pane?: Size): Pt[] {
  const notch = size.height / 2;
  const x1 = tip.x + notch;
  const x2 = x1 + size.width;
  const top = tip.y - size.height / 2;
  const bottom = tip.y + size.height / 2;
  return shiftInside([tip, { x: x1, y: top }, { x: x2, y: top }, { x: x2, y: bottom }, { x: x1, y: bottom }].map((p) => ({ ...p })), pane);
}

/** The body rectangle of a tag outline (its last four points). */
export function priceTagBody(outline: Pt[]): Rect {
  const [, a, , c] = outline;
  return { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y };
}

/** The pole of a signpost (anchor to the plate's near edge) and its plate. The plate is kept inside the pane unless `free`. */
export function signpostShape(anchor: Pt, size: Size, position: PlatePosition, pane?: Size, free = false): { pole: [Pt, Pt]; plate: Rect } {
  const up = position === 'above';
  const x = anchor.x - size.width / 2;
  const y = up ? anchor.y - POLE - size.height - PLATE_GAP : anchor.y + POLE + PLATE_GAP;
  const r = pane && !free && Number.isFinite(x) && Number.isFinite(y) ? keepInside(x, y, size, pane) : { x, y, width: size.width, height: size.height };
  const plate: Rect = { x: r.x, y: r.y, w: size.width, h: size.height };
  const edge = up ? plate.y + plate.h : plate.y;
  return { pole: [{ x: anchor.x, y: anchor.y }, { x: anchor.x, y: edge }], plate };
}

/** The plate of a signpost for a pane the pole may lead out of: true when the anchor itself is outside the pane. */
export const anchorOutside = (anchor: Pt, pane: Size): boolean => !finite(anchor) || anchor.x < 0 || anchor.y < 0 || anchor.x > pane.width || anchor.y > pane.height;

/** A flag mark: the pole from the anchor to its top, and the swallow-tailed flag at the top. */
export function flagShape(anchor: Pt): { pole: [Pt, Pt]; flag: Pt[] } {
  const top = anchor.y - POLE;
  const { x } = anchor;
  return {
    pole: [{ x, y: anchor.y }, { x, y: top }],
    flag: [{ x, y: top }, { x: x + FLAG.W, y: top }, { x: x + FLAG.W - 4, y: top + FLAG.H / 2 }, { x: x + FLAG.W, y: top + FLAG.H }, { x, y: top + FLAG.H }],
  };
}

/** Whether p is on a pole (within `tolerance`). */
export const poleHit = (pole: [Pt, Pt], p: Pt, tolerance: number): boolean => distToSegment(p, pole[0], pole[1]) <= tolerance;

/** Whether p is on the flag mark's flag or pole. */
export function flagHit(anchor: Pt, p: Pt, tolerance: number): boolean {
  const { pole, flag } = flagShape(anchor);
  return pointInPolygon(p, flag, tolerance) || poleHit(pole, p, tolerance);
}
