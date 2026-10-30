import { distToSegment, pointInRect, type Pt } from '../drawingGeometry';
import { pointInPolygon } from './shapes';

/** Pure geometry of the note tools (Note, Anchored note, Callout, Comment). Sizes are in pixels. */

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** The pin marker: a round head of radius `R` whose centre is `LIFT` above the tip. */
export const PIN = { R: 8, LIFT: 20 } as const;
/** Gap between the pin's head and its popup. */
const POPUP_GAP = 6;
/** Half the width of a callout pointer where it leaves the box, and the shortest edge it needs. */
const WEDGE_HALF = 8;
/** How far a comment's tail reaches from the bubble to the tip. */
export const TAIL = { LENGTH: 14, SKEW: 10, WIDTH: 14 } as const;

/** The centre of the pin's head for a tip at `tip`. */
export const pinCentre = (tip: Pt): Pt => ({ x: tip.x, y: tip.y - PIN.LIFT });

/** The pin as a path: the head's circle and the two straight sides that meet at the tip, tangent to the circle. */
export function pinPath(tip: Pt): { centre: Pt; r: number; left: Pt; right: Pt; tip: Pt } {
  const centre = pinCentre(tip);
  // The sides leave the circle at the angle whose cosine is r / lift.
  const a = Math.acos(PIN.R / PIN.LIFT);
  const dx = Math.sin(a) * PIN.R;
  const dy = Math.cos(a) * PIN.R;
  return { centre, r: PIN.R, left: { x: centre.x - dx, y: centre.y + dy }, right: { x: centre.x + dx, y: centre.y + dy }, tip: { ...tip } };
}

/** Whether p is on the pin's head or its body, within `tolerance`. */
export function pinHit(tip: Pt, p: Pt, tolerance: number): boolean {
  const { centre, r } = pinPath(tip);
  if (Math.hypot(p.x - centre.x, p.y - centre.y) <= r + tolerance) return true;
  return distToSegment(p, centre, tip) <= tolerance + 2;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A rectangle of the given size kept inside the pane; one larger than the pane sits at its top-left corner. */
export function keepInside(x: number, y: number, size: Size, pane: Size): Rect {
  return { x: Math.max(0, Math.min(x, pane.width - size.width)), y: Math.max(0, Math.min(y, pane.height - size.height)), ...size };
}

/** The popup of a pin: beside its head (to the right, else to the left), centred on it, kept inside the pane. */
export function popupRect(tip: Pt, box: Size, pane: Size): Rect {
  const c = pinCentre(tip);
  const right = c.x + PIN.R + POPUP_GAP;
  const x = right + box.width <= pane.width ? right : c.x - PIN.R - POPUP_GAP - box.width;
  return keepInside(x, c.y - box.height / 2, box, pane);
}

/** Whether p is in a rectangle or within `tolerance` of it. */
export const inRect = (r: Rect, p: Pt, tolerance = 0): boolean => pointInRect(p, { x: r.x, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, tolerance);

/**
 * The pointer of a callout: a wedge from the box edge nearest `target` to it, as [base, base, tip]. None when the
 * target is inside the box (or on it), which includes equal anchors.
 */
export function calloutWedge(box: Rect, target: Pt): [Pt, Pt, Pt] | null {
  const x1 = box.x + box.width;
  const y1 = box.y + box.height;
  const outX = target.x < box.x ? box.x - target.x : target.x > x1 ? target.x - x1 : 0;
  const outY = target.y < box.y ? box.y - target.y : target.y > y1 ? target.y - y1 : 0;
  if (outX === 0 && outY === 0) return null;
  const tip = { ...target };
  if (outX >= outY) {
    const x = target.x < box.x ? box.x : x1;
    const half = Math.min(WEDGE_HALF, box.height / 2);
    const y = clamp(target.y, box.y + half, y1 - half);
    return [{ x, y: y - half }, { x, y: y + half }, tip];
  }
  const y = target.y < box.y ? box.y : y1;
  const half = Math.min(WEDGE_HALF, box.width / 2);
  const x = clamp(target.x, box.x + half, x1 - half);
  return [{ x: x - half, y }, { x: x + half, y }, tip];
}

/** Whether p is on the callout's box or its pointer (within `tolerance`). */
export function calloutHit(box: Rect, target: Pt, p: Pt, tolerance: number): boolean {
  if (inRect(box, p, tolerance)) return true;
  const wedge = calloutWedge(box, target);
  return !!wedge && pointInPolygon(p, wedge, tolerance);
}

export type CommentShape = { rect: Rect; /** [base, base, tip]: the tip is the anchor. */ tail: [Pt, Pt, Pt]; flipX: boolean; flipY: boolean };

/**
 * A comment's bubble and tail. The tail's tip is the anchor; the bubble sits above and to the right of it, below it
 * where the pane's top edge needs it and to its left where the right edge does, and is kept inside the pane.
 */
export function commentShape(tip: Pt, box: Size, pane: Size): CommentShape {
  const flipY = tip.y - TAIL.LENGTH - box.height < 0;
  const flipX = tip.x - TAIL.SKEW + box.width > pane.width;
  const sx = flipX ? -1 : 1;
  const x = flipX ? tip.x + TAIL.SKEW - box.width : tip.x - TAIL.SKEW;
  const y = flipY ? tip.y + TAIL.LENGTH : tip.y - TAIL.LENGTH - box.height;
  const rect = keepInside(x, y, box, pane);
  const edge = flipY ? rect.y : rect.y + rect.height;
  // The base sits on the bubble's edge beside the tip, kept clear of the corners.
  const lo = rect.x + Math.min(8, rect.width / 2);
  const hi = rect.x + rect.width - Math.min(8, rect.width / 2);
  const a = clamp(tip.x + sx * 2, lo, hi);
  const b = clamp(tip.x + sx * (2 + TAIL.WIDTH), lo, hi);
  return { rect, tail: [{ x: a, y: edge }, { x: b, y: edge }, { ...tip }], flipX, flipY };
}

/** Whether p is on the bubble or its tail (within `tolerance`). */
export function commentHit(shape: CommentShape, p: Pt, tolerance: number): boolean {
  return inRect(shape.rect, p, tolerance) || pointInPolygon(p, shape.tail, tolerance);
}
