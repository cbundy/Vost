import type { Pt } from '../../lib/drawingGeometry';
import type { Anchor } from '../../lib/drawings';

/** Pane fractions (kept in an anchor's `time` and `price`) to pane pixels. A pane of no size gives 0. */
export function fractionToPoint(a: Anchor, width: number, height: number): Pt {
  const clamp = (f: number) => (Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0);
  return { x: clamp(a.time) * Math.max(0, width), y: clamp(a.price) * Math.max(0, height) };
}

/** Pane pixels to pane fractions, clamped onto the pane. A pane of no size gives 0. */
export function pointToFraction(p: Pt, width: number, height: number): Anchor {
  const f = (v: number, size: number) => (size > 0 && Number.isFinite(v) ? Math.min(1, Math.max(0, v / size)) : 0);
  return { time: f(p.x, width), price: f(p.y, height) };
}
