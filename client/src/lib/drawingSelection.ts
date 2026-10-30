import type { Pt } from './drawingGeometry';

/** Pure helpers on the selection: an ordered list of drawing ids, never holding one twice. */

export type Rect = { left: number; top: number; right: number; bottom: number };

/** The selection with the id added, or removed when it is already in. */
export function toggle(sel: readonly string[], id: string): string[] {
  return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
}

/** A selection of just this drawing. */
export function only(id: string): string[] {
  return [id];
}

/** The selection with every id added that is not in it already, in order. */
export function addAll(sel: readonly string[], ids: readonly string[]): string[] {
  const out = [...sel];
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

/** The selection without the ids no drawing has any more; the same list when none is gone. */
export function prune<T extends readonly string[]>(sel: T, drawings: readonly { id: string }[]): T | string[] {
  const live = new Set(drawings.map((d) => d.id));
  return sel.every((id) => live.has(id)) ? sel : sel.filter((id) => live.has(id));
}

/** The box between two corners, whichever way it was dragged. */
export function normalizeRect(a: Pt, b: Pt): Rect {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

/** Whether every point lies in the box; an ignored axis is not tested (a price-only tool ignores x, a time-only tool y). */
export function inBox(points: readonly Pt[], rect: Rect, ignore: { ignoreX?: boolean; ignoreY?: boolean } = {}): boolean {
  if (points.length === 0) return false;
  return points.every(
    (p) =>
      (ignore.ignoreX || (p.x >= rect.left && p.x <= rect.right)) && (ignore.ignoreY || (p.y >= rect.top && p.y <= rect.bottom)),
  );
}
