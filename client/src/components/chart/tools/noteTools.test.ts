import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import { anchoredNote, note } from './note';
import { callout } from './callout';
import { comment } from './comment';
import type { DrawingTool, ToolView } from './types';

const W = 400;
const H = 300;
function view(tool: DrawingTool, t: string, style?: Record<string, unknown>): ToolView {
  return { width: W, height: H, anchors: [], candles: [], text: t, times: [], priceToY: () => null, formatPrice: String, style: resolveStyle(tool.settings ?? [], style).values, styled: false, cells: [] };
}
const ctx = () => new Proxy({}, { get: () => () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;

describe.each([note, anchoredNote, callout, comment])('$id', (tool) => {
  const pts = tool.anchors === 2 ? [{ x: 100, y: 100 }, { x: 250, y: 160 }] : [{ x: 100, y: 100 }];
  it('is a text tool in the Notes section of Annotations with its handles at its points', () => {
    expect(tool.text).toBe(true);
    expect(tool.group).toBe('annotations');
    expect(tool.section).toBe('Notes');
    expect(tool.handles(pts, view(tool, 'x'))).toEqual(pts);
  });
  it('draws and pops up with empty text, a pane of no size, one point and equal points without throwing', () => {
    for (const v of [view(tool, ''), { ...view(tool, 'hi'), width: 0, height: 0 }, { ...view(tool, 'a long text that wraps '.repeat(10)), width: 30, height: 20 }]) {
      expect(() => tool.draw(ctx(), pts, v, { selected: true })).not.toThrow();
      expect(() => tool.draw(ctx(), pts.slice(0, 1), v, { selected: false })).not.toThrow();
      expect(() => tool.draw(ctx(), [pts[0], pts[0]], v, { selected: false })).not.toThrow();
      expect(() => tool.hit(pts, pts[0], v)).not.toThrow();
      expect(() => tool.popup?.(ctx(), pts, v)).not.toThrow();
      expect(() => tool.popupHit?.(pts, pts[0], v)).not.toThrow();
    }
  });
  it('has TradingView-like defaults: white text on blue, 14 px', () => {
    const v = view(tool, 'x').style;
    expect(v).toMatchObject({ color: '#ffffff', size: 14, backgroundColor: '#2962ff', borderColor: '#2962ff', wrap: true });
  });
});

describe('note', () => {
  const tip = { x: 100, y: 100 };
  it('is hit on the pin and not a little away; its popup only while asked', () => {
    const v = view(note, 'hello');
    expect(note.hit([tip], { x: 100, y: 82 }, v, 0)).toBe(true);
    expect(note.hit([tip], { x: 160, y: 82 }, v, 0)).toBe(false);
    expect(note.hit([tip], { x: 100, y: 140 }, v, 0)).toBe(false);
  });
  it('paints its text only in the popup, kept inside the pane', () => {
    const texts: { t: string; x: number }[] = [];
    const rec = new Proxy({}, { get: (_, k) => (k === 'fillText' ? (t: string, x: number) => texts.push({ t, x }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;
    const v = view(note, 'hello');
    note.draw(rec, [tip], v, { selected: false });
    expect(texts).toEqual([]);
    note.popup!(rec, [{ x: 395, y: 100 }], v);
    expect(texts.map((x) => x.t)).toEqual(['hello']);
    expect(texts[0].x).toBeLessThan(W);
  });
  it('presses its popup', () => {
    const v = view(note, 'hello');
    const [h] = [{ x: 100 + 8 + 6 + 10, y: 80 }];
    expect(note.popupHit!([tip], h, v, 0)).toBe(true);
    expect(note.popupHit!([tip], { x: 300, y: 250 }, v, 0)).toBe(false);
  });
  it('markerColor is a Style setting and the popup settings are the shared ones', () => {
    const keys = note.settings!.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['markerColor', 'backgroundColor', 'backgroundOpacity', 'borderColor', 'wrapWidth']));
  });
});

describe('pane anchoring', () => {
  it('only Anchored note is pane-anchored', () => {
    expect(anchoredNote.paneAnchored).toBe(true);
    for (const t of [note, callout, comment]) expect(t.paneAnchored).toBeUndefined();
  });
});

describe('callout', () => {
  const at = { x: 50, y: 60 };
  const target = { x: 300, y: 200 };
  it('has two handles, the box corner and the target, and does not remap a drag', () => {
    expect(callout.anchors).toBe(2);
    expect(callout.handles([at, target], view(callout, 'x'))).toEqual([at, target]);
    expect(callout.dragHandle).toBeUndefined();
  });
  it('is hit on the box and the pointer and not away from them', () => {
    const v = view(callout, 'hello');
    expect(callout.hit([at, target], { x: 60, y: 70 }, v, 0)).toBe(true);
    expect(callout.hit([at, target], { x: 200, y: 140 }, v, 3)).toBe(true);
    expect(callout.hit([at, target], { x: 300, y: 80 }, v, 3)).toBe(false);
    expect(callout.hit([at, target], { x: 20, y: 20 }, v, 3)).toBe(false);
  });
  it('has no pointer when the target is inside the box', () => {
    const v = view(callout, 'hello');
    expect(callout.hit([at, { x: 55, y: 65 }], { x: 200, y: 140 }, v, 3)).toBe(false);
  });
});

describe('comment', () => {
  const tip = { x: 100, y: 200 };
  it('is hit on the bubble and the tail and not a little away', () => {
    const v = view(comment, 'hello world');
    expect(comment.hit([tip], { x: 110, y: 170 }, v, 0)).toBe(true);
    expect(comment.hit([tip], { x: 103, y: 196 }, v, 0)).toBe(true);
    expect(comment.hit([tip], { x: 60, y: 200 }, v, 2)).toBe(false);
    expect(comment.hit([tip], { x: 100, y: 260 }, v, 2)).toBe(false);
  });
  it('wraps by default and keeps its bubble in the pane', () => {
    expect(view(comment, 'x').style.wrap).toBe(true);
    const rects: number[][] = [];
    const rec = new Proxy({}, { get: (_, k) => (k === 'roundRect' ? (...a: number[]) => rects.push(a) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;
    comment.draw(rec, [{ x: 399, y: 2 }], view(comment, 'edge'), { selected: false });
    const [x, y, w, h] = rects[0];
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(W);
    expect(y + h).toBeLessThanOrEqual(H);
  });
});
