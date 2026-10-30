import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import { anchoredText } from './anchoredText';
import { text } from './text';
import type { DrawingTool, ToolView } from './types';

const W = 400;
const H = 300;
function view(tool: DrawingTool, t: string, style?: Record<string, unknown>): ToolView {
  return { width: W, height: H, anchors: [], candles: [], text: t, times: [], priceToY: () => null, formatPrice: String, style: resolveStyle(tool.settings ?? [], style).values, styled: false, cells: [] };
}

/** A recording context: the fillText calls and the rect. */
function rec() {
  const calls: { t: string; x: number; y: number }[] = [];
  const rect: number[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_, k) => (k === 'fillText' ? (t: string, x: number, y: number) => calls.push({ t, x, y }) : k === 'roundRect' ? (...a: number[]) => rect.push(...a) : () => {}),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, rect };
}

describe.each([text, anchoredText])('$id', (tool) => {
  const a = { x: 50, y: 60 };
  it('hits inside the box and not just outside it', () => {
    const v = view(tool, 'hello\nworld');
    expect(tool.hit([a], { x: 55, y: 65 }, v, 0)).toBe(true);
    expect(tool.hit([a], { x: 49, y: 59 }, v, 0)).toBe(false);
    expect(tool.hit([a], { x: 50, y: 400 }, v, 0)).toBe(false);
  });
  it('has its handle at the anchor', () => {
    expect(tool.handles([a], view(tool, 'x'))).toEqual([a]);
  });
  it('does not throw for a pane of no size or empty text', () => {
    const v = { ...view(tool, ''), width: 0, height: 0 };
    const { ctx } = rec();
    expect(() => tool.draw(ctx, [a], v, { selected: true })).not.toThrow();
    expect(() => tool.hit([a], a, v)).not.toThrow();
  });
  it('moves the lines by alignment', () => {
    const left = rec();
    tool.draw(left.ctx, [a], view(tool, 'aaaaaaaa\nb', { align: 'left' }), { selected: false });
    const right = rec();
    tool.draw(right.ctx, [a], view(tool, 'aaaaaaaa\nb', { align: 'right' }), { selected: false });
    expect(left.calls[1].x).toBe(a.x + 6);
    expect(right.calls[1].x).toBeGreaterThan(left.calls[1].x);
    expect(Math.abs(right.calls[0].x - left.calls[0].x)).toBeLessThan(1);
  });
});

describe('anchored text', () => {
  it('keeps a box that would leave the pane inside it', () => {
    const v = view(anchoredText, 'hello');
    const [h] = anchoredText.handles([{ x: W + 100, y: H + 100 }], v);
    expect(h.x).toBeLessThan(W);
    expect(h.y).toBeLessThan(H);
    const { ctx, rect } = rec();
    anchoredText.draw(ctx, [{ x: W + 100, y: H + 100 }], v, { selected: false });
    expect(rect[0] + rect[2]).toBeLessThanOrEqual(W);
    expect(rect[1] + rect[3]).toBeLessThanOrEqual(H);
  });
  it('is flagged pane-anchored and text does not wrap by default', () => {
    expect(anchoredText.paneAnchored).toBe(true);
    expect(text.paneAnchored).toBeUndefined();
  });
});
