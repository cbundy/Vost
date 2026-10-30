import type { Pt } from '../../lib/drawingGeometry';
import type { Drawing } from '../../lib/drawings';
import { cellAt, nearestCell, type TableLayout } from '../../lib/geometry/table';
import type { DrawingPrimitive } from './drawingPrimitive';
import { getTool } from './tools';
import { layoutTable, originOf } from './tools/table';

export type CellRef = { row: number; col: number };

/** Where a table is on the chart now: its layout and its drawn top-left, in chart pixels; null when it cannot be placed. */
function placeOf(prim: DrawingPrimitive, d: Drawing): { layout: TableLayout; origin: Pt } | null {
  const tool = getTool(d.tool);
  const p = d.anchors[0] && prim.toPoint(d.anchors[0], tool);
  if (!p) return null;
  const view = prim.viewFor(d);
  const layout = layoutTable(view.cells, view.style);
  return { layout, origin: originOf(p, layout, view) };
}

/** The cell of a table under a chart pixel; with `nearest` the closest cell when the pixel is just off the grid. */
export function cellUnder(prim: DrawingPrimitive, d: Drawing, p: Pt, nearest = false): CellRef | null {
  const at = placeOf(prim, d);
  if (!at) return null;
  return nearest ? nearestCell(at.layout, at.origin, p) : cellAt(at.layout, at.origin, p);
}

/** A cell's box in chart pixels (from the chart container's top-left), for the editor laid over it. */
export function cellRect(prim: DrawingPrimitive, d: Drawing, cell: CellRef): { left: number; top: number; width: number; height: number } | null {
  const at = placeOf(prim, d);
  const { row, col } = cell;
  if (!at || col >= at.layout.colX.length || row >= at.layout.rowY.length) return null;
  return {
    left: at.origin.x + at.layout.colX[col],
    top: at.origin.y + at.layout.rowY[row],
    width: at.layout.colWidths[col],
    height: at.layout.rowHeights[row],
  };
}
