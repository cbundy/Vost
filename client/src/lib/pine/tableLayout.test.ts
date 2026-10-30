import { describe, expect, it } from 'vitest';
import { cellAt, tableLayout, tableOrigin, TABLE_INSET, TABLE_PAD } from './tableLayout';
import type { PineTable, PineTableCell, PineTablePosition } from './types';

const cell = (text: string, o: Partial<PineTableCell> = {}): PineTableCell => ({
  text, textColor: '#FFFFFF', bgColor: null, textSize: 10, halign: 'center', valign: 'center', widthPct: 0, heightPct: 0, tooltip: '',
  bold: false, italic: false, monospace: false, hidden: false, ...o,
});
const table = (cells: (PineTableCell | null)[][], o: Partial<PineTable> = {}): PineTable => ({
  pane: 'price', position: 'top_left', columns: cells[0]?.length ?? 0, rows: cells.length, bgColor: null, frameColor: null, frameWidth: 0,
  borderColor: null, borderWidth: 0, cells, merges: [], ...o,
});
const pane = { width: 800, height: 400 };
const measure = (s: string) => 6 * s.length;

describe('tableOrigin', () => {
  const size = { width: 100, height: 40 };
  it.each<[PineTablePosition, number, number]>([
    ['top_left', TABLE_INSET, TABLE_INSET],
    ['top_center', 350, TABLE_INSET],
    ['top_right', 800 - 100 - TABLE_INSET, TABLE_INSET],
    ['middle_left', TABLE_INSET, 180],
    ['middle_center', 350, 180],
    ['middle_right', 696, 180],
    ['bottom_left', TABLE_INSET, 400 - 40 - TABLE_INSET],
    ['bottom_center', 350, 356],
    ['bottom_right', 696, 356],
  ])('puts %s at %d,%d', (position, x, y) => {
    expect(tableOrigin(position, size, pane)).toEqual({ x, y });
  });
});

describe('tableLayout', () => {
  it('sizes a column to its widest text plus padding and a row to its tallest cell', () => {
    const l = tableLayout(table([[cell('ab'), cell('abcdef')], [cell('abcd'), cell('a\nb')]]), pane, measure);
    expect(l.width).toBe(24 + 2 * TABLE_PAD + 36 + 2 * TABLE_PAD);
    const byPos = (r: number, c: number) => l.cells.find((b) => b.row === r && b.col === c)!;
    expect(byPos(0, 0).w).toBe(24 + 2 * TABLE_PAD);
    expect(byPos(1, 1).h).toBe(25 + 2 * TABLE_PAD);
    expect(byPos(0, 0).h).toBe(12.5 + 2 * TABLE_PAD);
  });

  it('lets a percent width win over the text', () => {
    const l = tableLayout(table([[cell('abcdefghij', { widthPct: 10 })]]), pane, measure);
    expect(l.width).toBe(80);
  });

  it('spans a merged range over the sum of its columns and rows', () => {
    const t = table([[cell('Header'), cell(''), cell('', { hidden: true })], [cell('aaaaaa'), cell('bbbbbbbb'), cell('c')]], {
      merges: [{ startCol: 0, startRow: 0, endCol: 2, endRow: 0 }],
    });
    t.cells[0][1] = cell('', { hidden: true });
    const l = tableLayout(t, pane, measure);
    expect(l.cells.filter((b) => b.row === 0)).toHaveLength(1);
    const head = l.cells.find((b) => b.row === 0)!;
    expect(head.w).toBe(l.width);
    expect(head.h).toBe(10 * 1.25 + 2 * TABLE_PAD);
  });

  it('widens the last column of a merged range whose text is wider than the columns', () => {
    const t = table([[cell('a very long header text'), cell('', { hidden: true })], [cell('a'), cell('b')]], {
      merges: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }],
    });
    const l = tableLayout(t, pane, measure);
    expect(l.cells.find((b) => b.row === 0)!.w).toBe(6 * 23 + 2 * TABLE_PAD);
    expect(l.cells.find((b) => b.row === 1 && b.col === 0)!.w).toBe(6 + 2 * TABLE_PAD);
  });

  it('gives a column and a row with no set cell no space', () => {
    const l = tableLayout(table([[cell('a'), null, cell('b')], [null, null, null], [cell('c'), null, cell('d')]]), pane, measure);
    expect(l.width).toBe(2 * (6 + 2 * TABLE_PAD));
    expect(l.height).toBe(2 * (12.5 + 2 * TABLE_PAD));
    expect(l.cells.find((b) => b.col === 2)!.x).toBe(6 + 2 * TABLE_PAD);
  });

  it('is placed from the pane size alone', () => {
    const t = table([[cell('a')]], { position: 'bottom_right' });
    const a = tableLayout(t, { width: 800, height: 400 }, measure).origin;
    expect(a).toEqual({ x: 800 - 14 - TABLE_INSET, y: 400 - 20.5 - TABLE_INSET });
    expect(tableLayout(t, { width: 600, height: 300 }, measure).origin).not.toEqual(a);
  });
});

describe('cellAt', () => {
  it('finds the merged parent for a point anywhere in the merge and nothing off the table', () => {
    const t = table([[cell('Header'), cell('', { hidden: true })], [cell('a', { tooltip: 'x' }), cell('b')]], {
      merges: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }],
    });
    const l = tableLayout(t, pane, measure);
    const head = l.cells.find((b) => b.row === 0)!;
    const inRight = { x: l.origin.x + head.w - 2, y: l.origin.y + 3 };
    expect(cellAt(l, inRight)).toBe(head);
    expect(cellAt(l, { x: l.origin.x + 3, y: l.origin.y + head.h + 3 })!.cell.tooltip).toBe('x');
    expect(cellAt(l, { x: 700, y: 300 })).toBeNull();
  });
});
