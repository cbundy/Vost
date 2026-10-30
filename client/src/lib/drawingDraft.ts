/**
 * The pure steps of placing a drawing that needs several anchors: click, click, click; or press-drag-release for
 * the first two and a click for each further one. The draft keeps the anchors placed so far plus one moving last
 * anchor that follows the pointer. No chart or React imports.
 */
import type { Pt } from './drawingGeometry';
import type { Anchor } from './drawings';

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

/** Places the moving anchor at `anchor`: the drawing is done when it has `total` anchors, else another one starts moving. */
function place(draft: Draft, anchor: Anchor, total: number): DraftStep {
  const placed = [...draft.anchors.slice(0, -1), anchor];
  if (placed.length >= total) return { draft: null, done: placed };
  return { draft: { ...draft, anchors: [...placed, anchor], phase: 'waiting' }, done: null };
}

/** A press while waiting places the next anchor where the pointer is. */
export function pressDraft(draft: Draft, anchor: Anchor, total: number): DraftStep {
  return place(draft, anchor, total);
}

/**
 * The pointer is released after the press that started (or extended) the draft: a drag of {@link DRAG_PX} or more
 * places the moving anchor where it was dragged to; a click leaves it waiting for the next one.
 */
export function releaseDraft(draft: Draft, at: Pt, total: number): DraftStep {
  const moved = Math.hypot(at.x - draft.start.x, at.y - draft.start.y) >= DRAG_PX;
  if (!moved) return { draft: { ...draft, phase: 'waiting' }, done: null };
  return place(draft, draft.anchors[draft.anchors.length - 1], total);
}

/** A second finger lands: a draft still being pressed is dropped (the chart takes the pinch), a waiting one stays. */
export function secondFinger(draft: Draft): Draft | null {
  return draft.phase === 'pressing' ? null : draft;
}
