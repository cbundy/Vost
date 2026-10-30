import { describe, expect, it } from 'vitest';
import { resolveStyle, validateValue } from '../../../lib/drawingStyle';
import { ANCHOR_COUNTS, CELL_TOOLS, TEXT_TOOLS, TOOLS, VALIDATORS } from './index';
import { table } from './table';
import type { ToolView } from './types';

const W = 400;
const H = 300;
function view(cells: string[][], style?: Record<string, unknown>): ToolView {
  return { width: W, height: H, anchors: [], candles: [], text: '', cells, times: [], priceToY: () => null, formatPrice: String, style: resolveStyle(table.settings ?? [], style).values, styled: false };
}
const ctx = () => new Proxy({}, { get: () => () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;
const a = { x: 50, y: 60 };

describe('table tool', () => {
  it('is a cell tool in the Text section of Annotations with one anchor, after Anchored text, and not a text tool', () => {
    expect(table.group).toBe('annotations');
    expect(table.section).toBe('Text');
    expect(table.anchors).toBe(1);
    expect(table.cells).toBe(true);
    expect(table.text).toBeUndefined();
    expect(TEXT_TOOLS.has('table')).toBe(false);
    expect(CELL_TOOLS.has('table')).toBe(true);
    expect(ANCHOR_COUNTS.table).toBe(1);
    const ids = TOOLS.map((t) => t.id);
    expect(ids.indexOf('table')).toBe(ids.indexOf('anchoredText') + 1);
  });
  it('has defaults that validate, wrap off, no header and a 1 px border', () => {
    for (const f of table.settings!) expect(validateValue(f, f.default), f.key).toBeDefined();
    expect(view([]).style).toMatchObject({ wrap: false, header: false, borderWidth: 1, size: 12 });
  });
  it('draws and hits with empty, missing and big cells, no size pane, without throwing', () => {
    for (const v of [view([]), view([['']]), view([['a', 'b'], ['c', 'd']]), { ...view([['x']]), width: 0, height: 0 }]) {
      expect(() => table.draw(ctx(), [a], v, { selected: true })).not.toThrow();
      expect(() => table.draw(ctx(), [a], v, { selected: false })).not.toThrow();
      expect(() => table.hit([a], a, v)).not.toThrow();
    }
  });
  it('hits the whole grid and not outside it', () => {
    const v = view([['aaaa', 'b'], ['c', 'd']]);
    const [h] = table.handles([a], v);
    expect(table.hit([a], { x: h.x + 5, y: h.y + 5 }, v, 0)).toBe(true);
    expect(table.hit([a], { x: h.x + 100, y: h.y + 40 }, v, 0)).toBe(true);
    expect(table.hit([a], { x: h.x - 2, y: h.y + 5 }, v, 0)).toBe(false);
    expect(table.hit([a], { x: h.x + 5, y: 290 }, v, 0)).toBe(false);
  });
  it('has its single handle at the top-left and keeps the table inside the pane', () => {
    const v = view([['a', 'b'], ['c', 'd']]);
    expect(table.handles([a], v)).toEqual([a]);
    const [h] = table.handles([{ x: W + 100, y: H + 100 }], v);
    expect(h.x).toBeLessThan(W);
    expect(h.y).toBeLessThan(H);
  });
  it('paints the header row on its own colour and every cell text', () => {
    const fills: string[] = [];
    const texts: string[] = [];
    const c = new Proxy(
      {},
      { get: (_, k) => (k === 'fillText' ? (t: string) => texts.push(t) : k === 'fillRect' ? () => {} : () => {}), set: (_, k, v) => (k === 'fillStyle' && fills.push(String(v)), true) },
    ) as unknown as CanvasRenderingContext2D;
    table.draw(c, [a], view([['h1', 'h2'], ['x', 'y']], { header: true, headerColor: '#ff0000' }), { selected: false });
    expect(texts).toEqual(['h1', 'h2', 'x', 'y']);
    expect(fills.some((f) => f.includes('255, 0, 0') || f.includes('#ff0000'))).toBe(true);
  });
  it('validates stored cells and drops a bad table alone', () => {
    const v = VALIDATORS.table;
    const d = { id: 'a', tool: 'table', anchors: [{ time: 1, price: 1 }] };
    expect(v(d)).toEqual(d);
    expect(v({ ...d, cells: [['a'], ['b', 'c']] })!.cells).toEqual([['a', ''], ['b', 'c']]);
    expect(v({ ...d, cells: 'nope' as never })).toBeNull();
    expect(v({ ...d, cells: [] })).toBeNull();
  });
});
