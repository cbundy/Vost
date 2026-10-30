/**
 * Pure model and layout of the Table drawing: a grid of text cells. The validation of stored cells, the row and
 * column edits, the column widths and row heights from the cells' text, and the cell under a point. The measuring
 * function is passed in, so this module has no DOM.
 */
import { cleanText } from '../drawings';
import type { Pt } from '../drawingGeometry';
import { textBoxLayout, noteLine, type TextBoxOpts } from '../textLayout';

export type Cells = string[][];

/** Most rows and most columns a table may have. */
export const TABLE_MAX = 20;
/** The size of a table when it is placed. */
export const TABLE_DEFAULT_ROWS = 2;
export const TABLE_DEFAULT_COLS = 2;
/** Narrowest a column is drawn, empty cells included. */
export const TABLE_MIN_COL_WIDTH = 56;

/** A table of empty cells. */
export function emptyCells(rows = TABLE_DEFAULT_ROWS, cols = TABLE_DEFAULT_COLS): Cells {
  const r = Math.min(TABLE_MAX, Math.max(1, Math.floor(rows)));
  const c = Math.min(TABLE_MAX, Math.max(1, Math.floor(cols)));
  return Array.from({ length: r }, () => Array<string>(c).fill(''));
}

/**
 * Stored cells made valid: ragged rows padded to the widest row, cut to 20 by 20, each cell cleaned. Null when
 * `raw` is not a non-empty array of arrays of strings.
 */
export function validateCells(raw: unknown): Cells | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const rows: string[][] = [];
  for (const row of raw.slice(0, TABLE_MAX)) {
    if (!Array.isArray(row)) return null;
    const cells: string[] = [];
    for (const c of row.slice(0, TABLE_MAX)) {
      if (typeof c !== 'string') return null;
      cells.push(cleanText(c));
    }
    rows.push(cells);
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width === 0) return null;
  return rows.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r));
}

/** The table grown or cut to `rows` by `cols` (1..20 each): new cells are empty and added at the end, cut ones come off the end. */
export function resizeCells(cells: Cells, rows: number, cols: number): Cells {
  const r = Math.min(TABLE_MAX, Math.max(1, Math.floor(rows)));
  const c = Math.min(TABLE_MAX, Math.max(1, Math.floor(cols)));
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => cells[i]?.[j] ?? ''));
}

const rowsOf = (cells: Cells) => cells.length;
const colsOf = (cells: Cells) => cells[0]?.length ?? 0;
export const tableSize = (cells: Cells): { rows: number; cols: number } => ({ rows: rowsOf(cells), cols: colsOf(cells) });

/** An empty row inserted so it becomes row `at` (0..rows); the same table at the 20-row limit. */
export function insertRow(cells: Cells, at: number): Cells {
  if (rowsOf(cells) >= TABLE_MAX) return cells;
  const i = Math.min(rowsOf(cells), Math.max(0, at));
  return [...cells.slice(0, i), Array<string>(colsOf(cells)).fill(''), ...cells.slice(i)];
}

/** An empty column inserted so it becomes column `at` (0..cols); the same table at the 20-column limit. */
export function insertColumn(cells: Cells, at: number): Cells {
  if (colsOf(cells) >= TABLE_MAX) return cells;
  const i = Math.min(colsOf(cells), Math.max(0, at));
  return cells.map((r) => [...r.slice(0, i), '', ...r.slice(i)]);
}

/** Row `at` removed; the same table when it is the last row or `at` is out of range. */
export function deleteRow(cells: Cells, at: number): Cells {
  if (rowsOf(cells) <= 1 || at < 0 || at >= rowsOf(cells)) return cells;
  return cells.filter((_, i) => i !== at);
}

/** Column `at` removed; the same table when it is the last column or `at` is out of range. */
export function deleteColumn(cells: Cells, at: number): Cells {
  if (colsOf(cells) <= 1 || at < 0 || at >= colsOf(cells)) return cells;
  return cells.map((r) => r.filter((_, i) => i !== at));
}

/** The cell after (dir 1) or before (dir -1) a cell in reading order, or null past either end. */
export function stepCell(cells: Cells, row: number, col: number, dir: 1 | -1): { row: number; col: number } | null {
  const cols = colsOf(cells);
  const n = row * cols + col + dir;
  if (n < 0 || n >= rowsOf(cells) * cols) return null;
  return { row: Math.floor(n / cols), col: n % cols };
}

export type TableLayout = {
  /** Width of each column and height of each row, in pixels. */
  colWidths: number[];
  rowHeights: number[];
  /** Left edge of each column and top edge of each row, from the table's top-left. */
  colX: number[];
  rowY: number[];
  width: number;
  height: number;
  /** Per cell: the lines of text, the x offset of each from the cell's left edge and the line height. */
  cells: { lines: string[]; offsets: number[] }[][];
  lineHeight: number;
};

/**
 * Lays a table out: each column is as wide as its widest cell (at least {@link TABLE_MIN_COL_WIDTH}), each row as
 * tall as its tallest, text aligned inside its column. `measure(text, bold)` is the pixel width of a line; the
 * first row is bold when `header` is on.
 */
export function tableLayout(cells: Cells, opts: TextBoxOpts, header: boolean, measure: (s: string, bold: boolean) => number): TableLayout {
  const lineHeight = noteLine(opts.size);
  const minHeight = lineHeight + opts.pad * 2;
  const laid = cells.map((row, i) => {
    const bold = header && i === 0 ? true : opts.bold;
    return row.map((text) => {
      const box = textBoxLayout(text, { ...opts, bold, align: 'left' }, (s) => measure(s, bold));
      return { box, widths: box.lines.map((l) => measure(l, bold)) };
    });
  });
  const cols = colsOf(cells);
  const colWidths = Array.from({ length: cols }, (_, j) => Math.max(TABLE_MIN_COL_WIDTH, ...laid.map((r) => r[j]?.box.width ?? 0)));
  const rowHeights = laid.map((r) => Math.max(minHeight, ...r.map((c) => c.box.height)));
  const colX: number[] = [];
  const rowY: number[] = [];
  let x = 0;
  for (const w of colWidths) {
    colX.push(x);
    x += w;
  }
  let y = 0;
  for (const h of rowHeights) {
    rowY.push(y);
    y += h;
  }
  const out = laid.map((r) =>
    r.map((c, j) => {
      const inner = colWidths[j] - opts.pad * 2;
      const offsets = c.widths.map((w) => opts.pad + (opts.align === 'center' ? (inner - w) / 2 : opts.align === 'right' ? inner - w : 0));
      return { lines: c.box.lines, offsets };
    }),
  );
  return { colWidths, rowHeights, colX, rowY, width: x, height: y, cells: out, lineHeight };
}

/** Where a table's top-left is drawn: its anchor's pixel, moved so the whole table stays inside the pane. */
export function tableOrigin(anchor: Pt, layout: Pick<TableLayout, 'width' | 'height'>, pane: { width: number; height: number }): Pt {
  return { x: Math.max(0, Math.min(anchor.x, pane.width - layout.width)), y: Math.max(0, Math.min(anchor.y, pane.height - layout.height)) };
}

/** The cell a point is in for a table drawn with its top-left at `origin`; null outside the grid. A point on a shared border belongs to the cell after it. */
export function cellAt(layout: Pick<TableLayout, 'colX' | 'rowY' | 'colWidths' | 'rowHeights' | 'width' | 'height'>, origin: Pt, p: Pt): { row: number; col: number } | null {
  const x = p.x - origin.x;
  const y = p.y - origin.y;
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return null;
  let col = 0;
  while (col + 1 < layout.colX.length && x >= layout.colX[col + 1]) col++;
  let row = 0;
  while (row + 1 < layout.rowY.length && y >= layout.rowY[row + 1]) row++;
  return { row, col };
}

/** The cell nearest a point: the one under it, else the closest one on the grid's edge. */
export function nearestCell(layout: TableLayout, origin: Pt, p: Pt): { row: number; col: number } {
  const q = { x: Math.min(origin.x + layout.width - 1e-6, Math.max(origin.x, p.x)), y: Math.min(origin.y + layout.height - 1e-6, Math.max(origin.y, p.y)) };
  return cellAt(layout, origin, q) ?? { row: 0, col: 0 };
}
