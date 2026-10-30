import type { Pt } from '../drawingGeometry';
import { labelFont, LABEL_LINE_HEIGHT } from './labelGeometry';
import type { PineTable, PineTableCell, PineTablePosition } from './types';

/** The gap between a table and the pane edge it is pinned to. */
export const TABLE_INSET = 4;
/** The space between a cell's text and its edge. */
export const TABLE_PAD = 4;

export interface TableCellBox {
  row: number;
  col: number;
  /** Relative to the table's top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  cell: PineTableCell;
  lines: string[];
}

export interface TableLayout {
  width: number;
  height: number;
  /** Where the table's top-left is drawn in the pane. */
  origin: Pt;
  /** The visible cells (set and not merged away), a merged range once under its first cell. */
  cells: TableCellBox[];
}

/** The top-left of a table of `size` pinned at `position` of a pane. */
export function tableOrigin(position: PineTablePosition, size: { width: number; height: number }, pane: { width: number; height: number }): Pt {
  const [v, h] = position.split('_') as ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'];
  return {
    x: h === 'left' ? TABLE_INSET : h === 'right' ? pane.width - size.width - TABLE_INSET : (pane.width - size.width) / 2,
    y: v === 'top' ? TABLE_INSET : v === 'bottom' ? pane.height - size.height - TABLE_INSET : (pane.height - size.height) / 2,
  };
}

/**
 * Lays a table out in a pane: each column as wide as its widest cell text plus padding (or its `width` percent of
 * the pane), each row as tall as its tallest, a merged range as wide and tall as the columns and rows it spans. A
 * column or row with no set cell takes no space. `measure(text, font)` is a text line's pixel width.
 */
export function tableLayout(table: PineTable, pane: { width: number; height: number }, measure: (s: string, font: string) => number): TableLayout {
  const rows = table.cells.length;
  const cols = Math.max(0, table.columns, ...table.cells.map((r) => r.length));
  const spanOf = (row: number, col: number) => {
    const m = table.merges.find((q) => q.startRow === row && q.startCol === col);
    return { cols: m ? Math.max(1, m.endCol - m.startCol + 1) : 1, rows: m ? Math.max(1, m.endRow - m.startRow + 1) : 1 };
  };

  const boxes: { row: number; col: number; cell: PineTableCell; lines: string[]; w: number; h: number; spanCols: number; spanRows: number }[] = [];
  const usedCol = new Array<boolean>(cols).fill(false);
  const usedRow = new Array<boolean>(rows).fill(false);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = table.cells[row]?.[col];
      if (!cell) continue;
      const span = spanOf(row, col);
      // A merged-away cell is not drawn, and a set column or row is one that holds a cell that is.
      if (cell.hidden) continue;
      const font = labelFont(cell);
      const lines = cell.text === '' ? [] : cell.text.split('\n');
      const textW = Math.max(0, ...lines.map((s) => measure(s, font)));
      const w = cell.widthPct > 0 ? (pane.width * cell.widthPct) / 100 : textW + 2 * TABLE_PAD;
      const h = cell.heightPct > 0 ? (pane.height * cell.heightPct) / 100 : lines.length * cell.textSize * LABEL_LINE_HEIGHT + 2 * TABLE_PAD;
      boxes.push({ row, col, cell, lines, w, h, spanCols: span.cols, spanRows: span.rows });
      for (let c = col; c < col + span.cols && c < cols; c++) usedCol[c] = true;
      for (let r = row; r < row + span.rows && r < rows; r++) usedRow[r] = true;
    }
  }

  const colW = new Array<number>(cols).fill(0);
  const rowH = new Array<number>(rows).fill(0);
  const lastUsed = (flags: boolean[], from: number, count: number) => {
    for (let i = Math.min(flags.length, from + count) - 1; i >= from; i--) if (flags[i]) return i;
    return from;
  };
  // Single-cell spans size their column and row first; a merged cell then widens only the last column / row it spans.
  for (const b of boxes.filter((q) => q.spanCols === 1 && q.spanRows === 1)) {
    colW[b.col] = Math.max(colW[b.col], b.w);
    rowH[b.row] = Math.max(rowH[b.row], b.h);
  }
  for (const b of boxes.filter((q) => q.spanCols > 1 || q.spanRows > 1)) {
    const cs = lastUsed(usedCol, b.col, b.spanCols);
    const rs = lastUsed(usedRow, b.row, b.spanRows);
    let have = 0;
    for (let c = b.col; c < b.col + b.spanCols && c < cols; c++) have += colW[c];
    colW[cs] += Math.max(0, b.w - have);
    let tall = 0;
    for (let r = b.row; r < b.row + b.spanRows && r < rows; r++) tall += rowH[r];
    rowH[rs] += Math.max(0, b.h - tall);
  }

  const colX: number[] = [];
  const rowY: number[] = [];
  let x = 0;
  for (const w of colW) {
    colX.push(x);
    x += w;
  }
  let y = 0;
  for (const h of rowH) {
    rowY.push(y);
    y += h;
  }
  const origin = tableOrigin(table.position, { width: x, height: y }, pane);
  const cells = boxes.map((b): TableCellBox => {
    const endCol = Math.min(cols, b.col + b.spanCols);
    const endRow = Math.min(rows, b.row + b.spanRows);
    return {
      row: b.row,
      col: b.col,
      x: colX[b.col],
      y: rowY[b.row],
      w: (endCol < cols ? colX[endCol] : x) - colX[b.col],
      h: (endRow < rows ? rowY[endRow] : y) - rowY[b.row],
      cell: b.cell,
      lines: b.lines,
    };
  });
  return { width: x, height: y, origin, cells };
}

/** The cell box under a point of the pane, a merged range counting as its first cell; null off the table or on a cell never set. */
export function cellAt(layout: TableLayout, p: Pt): TableCellBox | null {
  const x = p.x - layout.origin.x;
  const y = p.y - layout.origin.y;
  for (const b of layout.cells) if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b;
  return null;
}
