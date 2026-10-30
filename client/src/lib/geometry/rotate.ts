/**
 * Pure geometry of a rotated square box (an icon, emoji or sticker): its corners, a point test, the rotation handle,
 * and the size and angle a handle drag gives. Angles are degrees, clockwise on the screen, 0 with the box upright.
 * No chart or React imports.
 */
import type { Pt } from '../drawingGeometry';

/** Smallest and largest side of a glyph box in pixels. */
export const GLYPH_SIZE_MIN = 8;
export const GLYPH_SIZE_MAX = 512;
/** How far the rotation handle sits above the box's top edge, in pixels. */
export const ROTATE_HANDLE_GAP = 24;
/** Shift snaps a drag's angle to a multiple of this many degrees. */
export const ANGLE_SNAP = 15;

/** An angle in degrees as 0 up to (not including) 360; a value that is not finite gives 0. */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const a = deg % 360;
  return a < 0 ? a + 360 : a + 0;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** A point turned clockwise by `deg` about `c`. */
export function rotatePoint(p: Pt, c: Pt, deg: number): Pt {
  const r = rad(deg);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** The four corners of the box of side `size` centred on `c` and turned by `angle`: top left, top right, bottom right, bottom left. */
export function boxCorners(c: Pt, size: number, angle: number): [Pt, Pt, Pt, Pt] {
  const h = size / 2;
  return [
    rotatePoint({ x: c.x - h, y: c.y - h }, c, angle),
    rotatePoint({ x: c.x + h, y: c.y - h }, c, angle),
    rotatePoint({ x: c.x + h, y: c.y + h }, c, angle),
    rotatePoint({ x: c.x - h, y: c.y + h }, c, angle),
  ];
}

/** Whether p lies in the rotated box, grown by `tolerance` pixels on every side. */
export function pointInBox(p: Pt, c: Pt, size: number, angle: number, tolerance = 0): boolean {
  const q = rotatePoint(p, c, -angle);
  const h = size / 2 + tolerance;
  return Math.abs(q.x - c.x) <= h && Math.abs(q.y - c.y) <= h;
}

/** Where the rotation handle is: above the middle of the box's top edge, turned with the box. */
export function rotationHandle(c: Pt, size: number, angle: number, gap = ROTATE_HANDLE_GAP): Pt {
  return rotatePoint({ x: c.x, y: c.y - size / 2 - gap }, c, angle);
}

/** A side length held between {@link GLYPH_SIZE_MIN} and {@link GLYPH_SIZE_MAX}, whole pixels. */
export function clampSize(size: number): number {
  if (!Number.isFinite(size)) return GLYPH_SIZE_MIN;
  return Math.round(Math.min(GLYPH_SIZE_MAX, Math.max(GLYPH_SIZE_MIN, size)));
}

/** The side a corner dragged to p gives: the corner of a box of side s is s / sqrt(2) from the centre. */
export function sizeFromCorner(c: Pt, p: Pt): number {
  return clampSize(Math.hypot(p.x - c.x, p.y - c.y) * Math.SQRT2);
}

/** The angle a rotation handle dragged to p gives, about the centre (straight above is 0); Shift snaps to {@link ANGLE_SNAP} degree steps. */
export function angleFromDrag(c: Pt, p: Pt, shift = false): number {
  if (p.x === c.x && p.y === c.y) return 0;
  const deg = (Math.atan2(p.x - c.x, c.y - p.y) * 180) / Math.PI;
  return normalizeAngle(shift ? Math.round(deg / ANGLE_SNAP) * ANGLE_SNAP : Math.round(deg));
}
