import type { Pt } from '../drawingGeometry';

/** The angle of the line a -> b in degrees, counter-clockwise from the horizontal (screen y grows downward); 0 for equal points. */
export function lineAngleDeg(a: Pt, b: Pt): number {
  if (a.x === b.x && a.y === b.y) return 0;
  const deg = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
  return deg === 0 ? 0 : deg;
}

/** The distance between two points in pixels. */
export function lineDistance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * The canvas arc from the horizontal reference (to the right of a) to the line a -> b: start and end in radians
 * for `ctx.arc` and whether it runs anticlockwise on screen (the line rises).
 */
export function angleArc(a: Pt, b: Pt): { start: number; end: number; anticlockwise: boolean } {
  const rad = (lineAngleDeg(a, b) * Math.PI) / 180;
  return { start: 0, end: -rad, anticlockwise: rad > 0 };
}

/** The arc's radius: a third of the line, between 12 and 48 pixels. */
export function arcRadius(a: Pt, b: Pt): number {
  return Math.max(12, Math.min(48, lineDistance(a, b) / 3));
}

/** The dotted horizontal reference of the trend angle: from a to the right, as long as the line is wide (at least 48), within the pane. */
export function referenceEnd(a: Pt, b: Pt, width: number): Pt {
  const len = Math.max(48, Math.abs(b.x - a.x));
  return { x: Math.max(a.x, Math.min(a.x + len, width)), y: a.y };
}
