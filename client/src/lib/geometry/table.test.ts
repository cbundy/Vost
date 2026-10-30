import { describe, expect, it } from 'vitest';
import { TEXT_MAX } from '../drawings';
import { boxOpts } from '../../components/chart/tools/textBox';
import {
  TABLE_MAX,
  TABLE_MIN_COL_WIDTH,
  cellAt,
  deleteColumn,
  deleteRow,
  emptyCells,
  insertColumn,
  insertRow,
  nearestCell,
  resizeCells,
  stepCell,
  tableLayout,
  tableOrigin,
  validateCells,
} from './table';

const style = { size: 12, bold: false, italic: false, align: 'left', wrap: false };
const opts = boxOpts(style);
/** 10 px per character, 20 px more when bold. */
const measure = (s: string, bold: boolean) => s.length * 10 + (bold ? 20 : 0);

describe('validateCells', () => {
  it('pads ragged rows to the widest row', () => {
    expect(validateCells([['a'], ['b', 'c', 'd'], []])).toEqual([['a', '', ''], ['b', 'c', 'd'], ['', '', '']]);
  });
  it('cuts to 20 by 20 and each cell to TEXT_MAX, and trims', () => {
    const big = Array.from({ length: 25 }, () => Array<string>(30).fill(' x '));
    const out = validateCells(big)!;
    expect(out).toHaveLength(TABLE_MAX);
    expect(out[0]).toHaveLength(TABLE_MAX);
    expect(out[0][0]).toBe('x');
    expect(validateCells([['y'.repeat(TEXT_MAX + 50)]])![0][0]).toHaveLength(TEXT_MAX);
  });
  it('rejects non-arrays, non-strings and empty', () => {
    for (const bad of [undefined, null, 'a', 5, {}, [], [[]], [[], []], ['a'], [['a', 1]], [['a'], null], [[null]]]) expect(validateCells(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('row and column edits', () => {
  const t = [['a', 'b'], ['c', 'd']];
  it('inserts a row and a column at an index', () => {
    expect(insertRow(t, 1)).toEqual([['a', 'b'], ['', ''], ['c', 'd']]);
    expect(insertRow(t, 2)).toEqual([['a', 'b'], ['c', 'd'], ['', '']]);
    expect(insertColumn(t, 1)).toEqual([['a', '', 'b'], ['c', '', 'd']]);
    expect(insertColumn(t, 0)).toEqual([['', 'a', 'b'], ['', 'c', 'd']]);
  });
  it('deletes a row and a column, never the last one', () => {
    expect(deleteRow(t, 0)).toEqual([['c', 'd']]);
    expect(deleteColumn(t, 1)).toEqual([['a'], ['c']]);
    expect(deleteRow([['a']], 0)).toEqual([['a']]);
    expect(deleteColumn([['a']], 0)).toEqual([['a']]);
    expect(deleteRow(t, 5)).toBe(t);
  });
  it('never goes above 20', () => {
    const full = emptyCells(TABLE_MAX, TABLE_MAX);
    expect(insertRow(full, 1)).toBe(full);
    expect(insertColumn(full, 1)).toBe(full);
  });
  it('resizes, adding and removing at the end and keeping the text', () => {
    expect(resizeCells(t, 3, 1)).toEqual([['a'], ['c'], ['']]);
    expect(resizeCells(t, 1, 3)).toEqual([['a', 'b', '']]);
    expect(resizeCells(t, 99, 0)).toHaveLength(TABLE_MAX);
    expect(resizeCells(t, 99, 0)[0]).toHaveLength(1);
  });
  it('steps through cells in reading order', () => {
    expect(stepCell(t, 0, 1, 1)).toEqual({ row: 1, col: 0 });
    expect(stepCell(t, 1, 0, -1)).toEqual({ row: 0, col: 1 });
    expect(stepCell(t, 1, 1, 1)).toBeNull();
    expect(stepCell(t, 0, 0, -1)).toBeNull();
  });
});

describe('tableLayout', () => {
  it('sizes a column to its widest cell and a row to its tallest', () => {
    const l = tableLayout([['aaaaaaaa', 'b'], ['cc', 'd\ne\nf']], opts, false, measure);
    expect(l.colWidths[0]).toBe(80 + 12);
    expect(l.rowHeights[0]).toBe(28);
    expect(l.rowHeights[1]).toBe(16 * 3 + 12);
    expect(l.colX).toEqual([0, l.colWidths[0]]);
    expect(l.width).toBe(l.colWidths[0] + l.colWidths[1]);
    expect(l.height).toBe(l.rowHeights[0] + l.rowHeights[1]);
  });
  it('gives empty cells the minimum width and a one-line height', () => {
    const l = tableLayout(emptyCells(2, 2), opts, false, measure);
    expect(l.colWidths).toEqual([TABLE_MIN_COL_WIDTH, TABLE_MIN_COL_WIDTH]);
    expect(l.rowHeights).toEqual([28, 28]);
  });
  it('measures the header row bold', () => {
    const plain = tableLayout([['abcdefgh'], ['x']], opts, false, measure);
    const head = tableLayout([['abcdefgh'], ['x']], opts, true, measure);
    expect(head.colWidths[0]).toBe(plain.colWidths[0] + 20);
  });
  it('aligns text inside a wider column', () => {
    const rows = [['aaaaaaaaaa'], ['b']];
    expect(tableLayout(rows, { ...opts, align: 'left' }, false, measure).cells[1][0].offsets[0]).toBe(6);
    expect(tableLayout(rows, { ...opts, align: 'right' }, false, measure).cells[1][0].offsets[0]).toBe(6 + 90);
    expect(tableLayout(rows, { ...opts, align: 'center' }, false, measure).cells[1][0].offsets[0]).toBe(6 + 45);
  });
  it('lays out 1 by 1 and 20 by 20', () => {
    expect(tableLayout([['x']], opts, false, measure).cells).toHaveLength(1);
    const l = tableLayout(emptyCells(20, 20), opts, false, measure);
    expect(l.width).toBe(20 * TABLE_MIN_COL_WIDTH);
    expect(l.height).toBe(20 * 28);
    expect(l.colX).toHaveLength(20);
  });
});

describe('cellAt', () => {
  const l = tableLayout([['aaaa', 'b'], ['c', 'd']], opts, false, measure);
  const o = { x: 100, y: 50 };
  it('finds the cell under a point', () => {
    expect(cellAt(l, o, { x: 101, y: 51 })).toEqual({ row: 0, col: 0 });
    expect(cellAt(l, o, { x: o.x + l.colX[1] + 1, y: o.y + l.rowY[1] + 1 })).toEqual({ row: 1, col: 1 });
    expect(cellAt(l, o, { x: o.x + l.width - 1, y: o.y + l.height - 1 })).toEqual({ row: 1, col: 1 });
  });
  it('gives a border to the cell after it and nothing outside the grid', () => {
    expect(cellAt(l, o, { x: o.x + l.colX[1], y: o.y + 5 })).toEqual({ row: 0, col: 1 });
    expect(cellAt(l, o, { x: o.x + l.width, y: o.y + 5 })).toBeNull();
    expect(cellAt(l, o, { x: o.x - 1, y: o.y + 5 })).toBeNull();
    expect(cellAt(l, o, { x: o.x + 5, y: o.y + l.height })).toBeNull();
  });
  it('finds the nearest cell for a point just off the grid', () => {
    expect(nearestCell(l, o, { x: o.x - 10, y: o.y - 10 })).toEqual({ row: 0, col: 0 });
    expect(nearestCell(l, o, { x: o.x + l.width + 10, y: o.y + l.height + 10 })).toEqual({ row: 1, col: 1 });
  });
});

describe('tableOrigin', () => {
  it('keeps the whole table inside the pane', () => {
    const l = { width: 100, height: 60 };
    expect(tableOrigin({ x: 50, y: 40 }, l, { width: 400, height: 300 })).toEqual({ x: 50, y: 40 });
    expect(tableOrigin({ x: 390, y: 290 }, l, { width: 400, height: 300 })).toEqual({ x: 300, y: 240 });
    expect(tableOrigin({ x: -20, y: -5 }, l, { width: 400, height: 300 })).toEqual({ x: 0, y: 0 });
    expect(tableOrigin({ x: 10, y: 10 }, l, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});
