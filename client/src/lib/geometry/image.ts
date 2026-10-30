/**
 * Pure box maths of the Image drawing: the size a picture is placed at, a box from two corners, and a corner drag
 * that keeps (or frees) the aspect ratio. No DOM, no chart.
 */
import type { Pt } from '../drawingGeometry';

/** Smallest side, in pixels, of a box this module returns. */
export const MIN_SIDE = 1;

/** The natural size of a picture scaled down (never up) so it fits within half the pane, keeping its ratio; at least 1 by 1. */
export function fitToHalfPane(w: number, h: number, paneW: number, paneH: number): { w: number; h: number } {
  const nw = Math.max(MIN_SIDE, w);
  const nh = Math.max(MIN_SIDE, h);
  const scale = Math.min(1, paneW > 0 ? paneW / 2 / nw : 1, paneH > 0 ? paneH / 2 / nh : 1);
  return { w: Math.max(MIN_SIDE, Math.round(nw * scale)), h: Math.max(MIN_SIDE, Math.round(nh * scale)) };
}

/** The box with opposite corners a and b: its top-left and size, never smaller than one pixel a side. */
export function boxFromCorners(a: Pt, b: Pt): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(MIN_SIDE, Math.abs(b.x - a.x)), h: Math.max(MIN_SIDE, Math.abs(b.y - a.y)) };
}

/** The ratio (width over height) of the box with opposite corners a and b; 1 when it has no height. */
export function ratioOf(a: Pt, b: Pt): number {
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  return w > 0 && h > 0 ? w / h : 1;
}

/**
 * The corner a drag ends on, from the fixed opposite corner and the pointer q: with `free` it is q itself (but never
 * a zero-size box); otherwise the box keeps `ratio` (width over height), is as large as the pointer asks on either
 * axis and lies in the quadrant of q.
 */
export function dragCorner(opposite: Pt, q: Pt, ratio: number, free: boolean): Pt {
  const dx = q.x - opposite.x;
  const dy = q.y - opposite.y;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  if (free) return { x: opposite.x + sx * Math.max(MIN_SIDE, Math.abs(dx)), y: opposite.y + sy * Math.max(MIN_SIDE, Math.abs(dy)) };
  const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
  const w = Math.max(MIN_SIDE, Math.abs(dx), Math.abs(dy) * r, MIN_SIDE * r);
  const h = w / r;
  return { x: opposite.x + sx * w, y: opposite.y + sy * h };
}

/** A click places the picture at `size` with the click as its top-left. */
export function naturalEnd(start: Pt, size: { w: number; h: number }): Pt {
  return { x: start.x + size.w, y: start.y + size.h };
}
