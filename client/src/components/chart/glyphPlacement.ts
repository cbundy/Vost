/**
 * The glyph tools' (icon, emoji, sticker) share of drawing on the chart: which entry is armed, the item that follows
 * the pointer before it is placed, and a handle drag that resizes or rotates. Kept out of useDrawings so that only
 * calls are added there.
 */
import type { Pt } from '../../lib/drawingGeometry';
import { previewPatch, type Anchor, type Drawing, type DrawingsState } from '../../lib/drawings';
import { useStore } from '../../state/store';
import type { DrawingPrimitive } from './drawingPrimitive';
import type { DrawingTool } from './tools/types';

/** The entry id the glyph tool places next, or '' when none is picked yet. */
export function armedGlyph(toolId: string): string {
  return useStore.getState().glyphArmed[toolId] ?? '';
}

/** The temporary drawing that follows the pointer while a glyph tool is armed (never stored). */
export function hoverGlyph(def: DrawingTool, anchor: Anchor): Drawing | null {
  const glyph = armedGlyph(def.id);
  return glyph ? { id: 'hover', tool: def.id, anchors: [anchor], glyph } : null;
}

/** A drawing as it was when a handle drag began. */
export type StyleDragItem = {
  id: string;
  tool: string;
  origAnchors: Anchor[];
  origStyle: Drawing['style'];
  origPts: Pt[];
};

/**
 * The state with a handle drag applied to a glyph drawing, or null when the tool does not change style by a handle
 * (the caller then moves anchors). The anchors stay as they were; the size or angle the tool returns goes over the
 * drawing's own style. Nothing is recorded in the history: the release commits the whole drag as one step.
 */
export function previewStyleDrag(
  state: DrawingsState,
  def: DrawingTool,
  item: StyleDragItem,
  handle: number,
  prim: DrawingPrimitive,
  delta: Pt,
  shift: boolean,
): DrawingsState | null {
  if (!def.dragStyle) return null;
  const view = prim.viewFor({ tool: def.id, anchors: item.origAnchors, style: item.origStyle });
  const h = def.handles(item.origPts, view)[handle];
  if (!h) return null;
  const changed = def.dragStyle(item.origPts, handle, { x: h.x + delta.x, y: h.y + delta.y }, view, { shift });
  if (!changed) return state;
  return previewPatch(state, item.id, { anchors: item.origAnchors, style: { ...(item.origStyle ?? {}), ...changed } });
}
