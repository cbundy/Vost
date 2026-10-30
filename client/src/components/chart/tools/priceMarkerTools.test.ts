import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import { flagMark } from './flagMark';
import { priceLabel } from './priceLabel';
import { priceNote } from './priceNote';
import { signpost } from './signpost';
import { TOOLS } from './index';
import type { DrawingTool, ToolView } from './types';

const W = 400;
const H = 300;
const fmt = (p: number) => p.toFixed(5);
function view(tool: DrawingTool, text = '', style?: Record<string, unknown>, anchors = [{ time: 1, price: 1.23456 }, { time: 2, price: 2 }]): ToolView {
  return { width: W, height: H, anchors, candles: [], text, times: [], priceToY: () => null, formatPrice: fmt, style: resolveStyle(tool.settings ?? [], style).values, styled: false };
}
function recorder() {
  const texts: string[] = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'fillText' ? (t: string) => texts.push(t) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

const one = [{ x: 100, y: 150 }];
const two = [{ x: 100, y: 150 }, { x: 250, y: 100 }];
const tools = [priceNote, priceLabel, signpost, flagMark];

describe.each(tools)('$id', (tool) => {
  const pts = tool.anchors === 2 ? two : one;
  it('is in the Notes section of Annotations with handles at its points', () => {
    expect(tool.group).toBe('annotations');
    expect(tool.section).toBe('Notes');
    expect(tool.handles(pts, view(tool))).toEqual(pts);
  });
  it('is registered in rail order after the note tools', () => {
    const ids = TOOLS.filter((t) => t.section === 'Notes' && t.group === 'annotations').map((t) => t.id);
    expect(ids).toEqual(['note', 'anchoredNote', 'priceNote', 'callout', 'comment', 'priceLabel', 'signpost', 'flagMark']);
  });
  it('labels the axes only while selected', () => {
    const anchors = [{ time: 1, price: 5 }, { time: 2, price: 6 }].slice(0, tool.anchors as number);
    expect(tool.axisLabels!(anchors, {}, false)).toEqual({});
    const sel = tool.axisLabels!(anchors, {}, true);
    expect(sel.price?.[0]).toBe(5);
    expect(sel.time?.[0]).toBe(1);
  });
  it('is hit on the marker and not 15 px away from it', () => {
    const v = view(tool, 'x');
    const on = tool === flagMark || tool === signpost ? { x: 100, y: 140 } : tool === priceLabel ? { x: 120, y: 150 } : { x: 100, y: 150 };
    expect(tool.hit(pts, on, v, 0)).toBe(true);
    expect(tool.hit(pts, { x: 100, y: 600 }, v, 0)).toBe(false);
    expect(tool.hit(pts, { x: -300, y: 150 }, v, 0)).toBe(false);
  });
  it('draws with no bars, one bar, a pane of no size, one point and non-finite points without throwing', () => {
    const vs = [view(tool, ''), { ...view(tool, 'hi'), width: 0, height: 0 }, view(tool, 'hi', undefined, []), view(tool, 'hi', undefined, [{ time: 1, price: 1 }])];
    for (const v of vs) {
      expect(() => tool.draw(recorder().ctx, pts, v, { selected: true })).not.toThrow();
      expect(() => tool.draw(recorder().ctx, pts.slice(0, 1), v, { selected: false })).not.toThrow();
      expect(() => tool.draw(recorder().ctx, pts.map(() => ({ x: NaN, y: Infinity })), v, { selected: false })).not.toThrow();
      expect(() => tool.hit(pts, pts[0], v)).not.toThrow();
      expect(() => tool.hit(pts.slice(0, 1), pts[0], v)).not.toThrow();
    }
  });
});

describe('price note', () => {
  it('has a dot hit, a connector hit and a box hit', () => {
    const v = view(priceNote);
    expect(priceNote.hit(two, { x: 100, y: 150 }, v, 0)).toBe(true);
    expect(priceNote.hit(two, { x: 175, y: 125 }, v, 0)).toBe(true);
    expect(priceNote.hit(two, { x: 250, y: 100 }, v, 0)).toBe(true);
    expect(priceNote.hit(two, { x: 175, y: 160 }, v, 0)).toBe(false);
  });
  it('shows the anchor price in the chart format, then the label, and follows a changed price', () => {
    const a = recorder();
    priceNote.draw(a.ctx, two, view(priceNote, 'target'), { selected: false });
    expect(a.texts).toEqual(['1.23456', 'target']);
    const b = recorder();
    priceNote.draw(b.ctx, two, view(priceNote, '', undefined, [{ time: 1, price: 9.87654 }, { time: 2, price: 2 }]), { selected: false });
    expect(b.texts).toEqual(['9.87654']);
  });
  it('carries a label on its Text tab', () => {
    expect(priceNote.caption).toBe(true);
    expect(priceNote.settings!.some((f) => f.tab === 'text')).toBe(true);
  });
});

describe('price label', () => {
  it('shows the anchor price in the chart format and has no text settings', () => {
    const r = recorder();
    priceLabel.draw(r.ctx, one, view(priceLabel), { selected: false });
    expect(r.texts).toEqual(['1.23456']);
    expect(priceLabel.settings!.some((f) => f.tab === 'text')).toBe(false);
    expect(priceLabel.caption).toBeUndefined();
  });
});

describe('signpost', () => {
  it('shows the caption, or the emoji when one is chosen', () => {
    const a = recorder();
    signpost.draw(a.ctx, one, view(signpost, 'look'), { selected: false });
    expect(a.texts).toEqual(['look']);
    const b = recorder();
    signpost.draw(b.ctx, one, view(signpost, 'look', { emoji: '🚀' }), { selected: false });
    expect(b.texts).toEqual(['🚀']);
  });
  it('puts the plate on the chosen side: hit above only when above', () => {
    const above = view(signpost, '', { position: 'above' });
    const below = view(signpost, '', { position: 'below' });
    expect(signpost.hit(one, { x: 100, y: 100 }, above, 0)).toBe(true);
    expect(signpost.hit(one, { x: 100, y: 100 }, below, 0)).toBe(false);
    expect(signpost.hit(one, { x: 100, y: 200 }, below, 0)).toBe(true);
  });
});

describe('flag mark', () => {
  it('defaults to TradingView blue', () => {
    expect(view(flagMark).style.color).toBe('#2962ff');
  });
});
