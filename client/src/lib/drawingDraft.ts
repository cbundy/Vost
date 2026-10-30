/**
 * The pure steps of placing a drawing that needs several anchors: click, click, click; or press-drag-release for
 * the first two and a click for each further one. The draft keeps the anchors placed so far plus one moving last
 * anchor that follows the pointer. No chart or React imports.
 */
import type { Pt } from './drawingGeometry';
import { anchorRange, type Anchor, type AnchorSpec } from './drawings';

/** Pixels a press must travel to count as a drag (press-drag-release rather than click, click). */
export const DRAG_PX = 4;

export type DraftPhase = 'pressing' | 'waiting';

export type Draft = {
  tool: string;
  /** The placed anchors, then the moving one that follows the pointer. */
  anchors: Anchor[];
  /** Where the press that started (or last extended) the draft landed. */
  start: Pt;
  /** pressing: the button is down; waiting: the pointer is up and the next click places the moving anchor. */
  phase: DraftPhase;
};

/** What a step leaves: the draft still in flight (or null) and the finished anchors (or null). */
export type DraftStep = { draft: Draft | null; done: Anchor[] | null };

/** The first press: the first anchor is placed and the moving one sits on it. */
export function startDraft(tool: string, anchor: Anchor, start: Pt): Draft {
  return { tool, anchors: [anchor, anchor], start, phase: 'pressing' };
}

/** The pointer moved: the moving anchor follows it. */
export function moveDraft(draft: Draft, anchor: Anchor): Draft {
  return { ...draft, anchors: [...draft.anchors.slice(0, -1), anchor] };
}

/** Places the moving anchor at `anchor`: the drawing is done when it has `total` anchors (a range's max), else another one starts moving. */
function place(draft: Draft, anchor: Anchor, total: AnchorSpec): DraftStep {
  const placed = [...draft.anchors.slice(0, -1), anchor];
  if (placed.length >= anchorRange(total).max) return { draft: null, done: placed };
  return { draft: { ...draft, anchors: [...placed, anchor], phase: 'waiting' }, done: null };
}

/** A press while waiting places the next anchor where the pointer is. */
export function pressDraft(draft: Draft, anchor: Anchor, total: AnchorSpec): DraftStep {
  // On an open-ended draft a press on the point just placed adds nothing: it is the second press of a double-click.
  const last = draft.anchors[draft.anchors.length - 2];
  if (isOpenEnded(total) && draft.phase === 'waiting' && draft.anchors.length > 2 && sameAnchor(last, anchor)) return { draft, done: null };
  return place(draft, anchor, total);
}

/**
 * The pointer is released after the press that started (or extended) the draft: a drag of {@link DRAG_PX} or more
 * places the moving anchor where it was dragged to; a click leaves it waiting for the next one.
 */
export function releaseDraft(draft: Draft, at: Pt, total: AnchorSpec): DraftStep {
  const moved = Math.hypot(at.x - draft.start.x, at.y - draft.start.y) >= DRAG_PX;
  if (!moved) return { draft: { ...draft, phase: 'waiting' }, done: null };
  return place(draft, draft.anchors[draft.anchors.length - 1], total);
}

/** A second finger lands: a draft still being pressed is dropped (the chart takes the pinch), a waiting one stays. */
export function secondFinger(draft: Draft): Draft | null {
  return draft.phase === 'pressing' ? null : draft;
}

/** Whether the tool takes any number of anchors between a least and a most, ended by the user rather than by a count. */
export function isOpenEnded(spec: AnchorSpec): boolean {
  const { min, max } = anchorRange(spec);
  return max > min;
}

const sameAnchor = (a: Anchor, b: Anchor) => a.time === b.time && a.price === b.price;

/**
 * The user ends an open-ended draft (double-click, double tap, Enter or a click on the first point): the moving anchor
 * is dropped, and so is a last placed anchor that repeats the one before it (the second press of a double-click lands
 * on the first). The drawing is done when `min` anchors remain; fewer cancels it.
 */
export function endDraft(draft: Draft, min: number): DraftStep {
  const placed = draft.anchors.slice(0, -1);
  const n = placed.length;
  if (n >= 2 && sameAnchor(placed[n - 1], placed[n - 2])) placed.pop();
  if (placed.length < min) return { draft: null, done: null };
  return { draft: null, done: placed };
}

/** Backspace during placement: the last placed anchor is removed (the moving one stays); with only the first placed the draft is cancelled. A draft still being pressed is left alone. */
export function undoPoint(draft: Draft): Draft | null {
  if (draft.phase === 'pressing') return draft;
  const placed = draft.anchors.slice(0, -1);
  if (placed.length <= 1) return null;
  return { ...draft, anchors: [...placed.slice(0, -1), draft.anchors[draft.anchors.length - 1]] };
}

/**
 * A press at `p` lands on the first placed point (within `radius` pixels of `first`) once `min` points are placed:
 * it ends the draft there (a polyline closes) instead of adding a point.
 */
export function closesOnFirst(draft: Draft, p: Pt, first: Pt, radius: number, min: number): boolean {
  if (draft.phase !== 'waiting' || draft.anchors.length - 1 < min) return false;
  return Math.hypot(p.x - first.x, p.y - first.y) <= radius;
}
