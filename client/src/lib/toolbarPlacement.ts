/**
 * Where the floating drawing toolbar sits: the drawing's pixel box and the toolbar's spot beside it. Pure: no React or
 * chart imports.
 */
import type { Pt } from './drawingGeometry';
import type { Rect } from './drawingSelection';

/** The tool flags that decide which axis of the drawing is real. */
export type BoxFlags = { priceOnly?: boolean; timeOnly?: boolean; fullWidth?: boolean; fullHeight?: boolean };

/** Gap between the drawing and the toolbar, and the margin kept from the chart area's edges. */
export const TOOLBAR_GAP = 8;
export const TOOLBAR_MARGIN = 4;

/**
 * The pixel bounding box of a drawing's placed points. A price-only or full-width tool spans the pane's width and a
 * time-only or full-height tool its height. Null with no points.
 */
export function drawingBox(points: readonly Pt[], flags: BoxFlags, pane: { width: number; height: number }): Rect | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const wide = flags.priceOnly === true || flags.fullWidth === true;
  const tall = flags.timeOnly === true || flags.fullHeight === true;
  return {
    left: wide ? 0 : Math.min(...xs),
    right: wide ? pane.width : Math.max(...xs),
    top: tall ? 0 : Math.min(...ys),
    bottom: tall ? pane.height : Math.max(...ys),
  };
}

export type ToolbarSpot = { left: number; top: number; side: 'above' | 'below' };

/**
 * The toolbar's top-left corner: centred over the box and `gap` above it, else `gap` below it, else (no room on either
 * side, as for a box that spans the pane's height) at the top. Always inside the area, `margin` from its edges.
 */
export function placeToolbar(
  box: Rect,
  size: { width: number; height: number },
  area: { width: number; height: number },
  margin = TOOLBAR_MARGIN,
  gap = TOOLBAR_GAP,
): ToolbarSpot {
  const clamp = (v: number, max: number) => Math.max(margin, Math.min(v, max));
  const left = clamp((box.left + box.right) / 2 - size.width / 2, area.width - size.width - margin);
  const maxTop = area.height - size.height - margin;
  const above = box.top - gap - size.height;
  const below = box.bottom + gap;
  if (above >= margin) return { left, top: clamp(above, maxTop), side: 'above' };
  if (below <= maxTop) return { left, top: below, side: 'below' };
  return { left, top: clamp(above, maxTop), side: 'above' };
}
