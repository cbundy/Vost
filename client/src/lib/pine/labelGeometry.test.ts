import { describe, expect, it } from 'vitest';
import { LABEL_GAP, LABEL_PAD, LABEL_POINTER, labelAnchor, labelHit, labelLayout } from './labelGeometry';
import type { PineLabel } from './types';

const label = (o: Partial<PineLabel> = {}): PineLabel => ({
  pane: 'price', time: 1, price: 10, yloc: 'price', text: 'Hello', style: 'label_down', color: '#FF0000', textColor: '#FFFFFF',
  textSize: 10, textAlign: 'center', tooltip: '', bold: false, italic: false, monospace: false, ...o,
});
const measure = (s: string) => 6 * s.length;
const at = { x: 200, y: 100 };

describe('labelLayout bubbles', () => {
  it('puts a label_down bubble above the anchor with the pointer at the bottom middle', () => {
    const l = labelLayout(label(), at, measure);
    expect(l.kind).toBe('bubble');
    expect(l.rect!.y1).toBe(at.y - LABEL_POINTER);
    expect((l.rect!.x0 + l.rect!.x1) / 2).toBe(at.x);
    expect(l.rect!.x1 - l.rect!.x0).toBe(30 + 2 * LABEL_PAD);
    expect(l.pointer[0]).toEqual(at);
    expect(l.pointer.slice(1).map((p) => p.y)).toEqual([l.rect!.y1, l.rect!.y1]);
  });

  it('puts label_up below, label_left and label_right beside the anchor', () => {
    const up = labelLayout(label({ style: 'label_up' }), at, measure);
    expect(up.rect!.y0).toBe(at.y + LABEL_POINTER);
    const left = labelLayout(label({ style: 'label_left' }), at, measure);
    expect(left.rect!.x0).toBe(at.x + LABEL_POINTER);
    expect(left.pointer[0]).toEqual(at);
    const right = labelLayout(label({ style: 'label_right' }), at, measure);
    expect(right.rect!.x1).toBe(at.x - LABEL_POINTER);
    expect((right.rect!.y0 + right.rect!.y1) / 2).toBe(at.y);
  });

  it('centres label_center on the anchor and offsets a corner style to its corner', () => {
    const c = labelLayout(label({ style: 'label_center' }), at, measure);
    expect(c.pointer).toEqual([]);
    expect([(c.rect!.x0 + c.rect!.x1) / 2, (c.rect!.y0 + c.rect!.y1) / 2]).toEqual([at.x, at.y]);
    const ul = labelLayout(label({ style: 'label_upper_left' }), at, measure);
    expect([ul.rect!.x0, ul.rect!.y0]).toEqual([at.x, at.y]);
    const lr = labelLayout(label({ style: 'label_lower_right' }), at, measure);
    expect([lr.rect!.x1, lr.rect!.y1]).toEqual([at.x, at.y]);
  });

  it('lays multi-line text out line by line and aligns it', () => {
    const left = labelLayout(label({ text: 'a\nlonger', textAlign: 'left' }), at, measure);
    expect(left.lines.map((q) => q.text)).toEqual(['a', 'longer']);
    expect(left.lines[0].x).toBe(left.rect!.x0 + LABEL_PAD);
    expect(left.lines[1].y - left.lines[0].y).toBe(12.5);
    const right = labelLayout(label({ text: 'a\nlonger', textAlign: 'right' }), at, measure);
    expect(right.lines[0].x).toBe(right.rect!.x1 - LABEL_PAD);
  });
});

describe('labelAnchor', () => {
  it('moves the anchor a gap above the high and below the low', () => {
    expect(labelAnchor({ yloc: 'abovebar' }, at)).toEqual({ x: 200, y: 100 - LABEL_GAP });
    expect(labelAnchor({ yloc: 'belowbar' }, at)).toEqual({ x: 200, y: 100 + LABEL_GAP });
    expect(labelAnchor({ yloc: 'price' }, at)).toEqual(at);
  });
});

describe('labelLayout shapes and text', () => {
  it('sizes a shape by the text size and puts the text above a down shape, below an up one', () => {
    const down = labelLayout(label({ style: 'triangledown', textSize: 20 }), at, measure);
    expect(down.kind).toBe('shape');
    expect(down.shape).toEqual({ type: 'triangledown', cx: 200, cy: 100, size: 24 });
    expect(down.lines[0].y).toBeLessThan(at.y);
    const up = labelLayout(label({ style: 'arrowup', textSize: 20 }), at, measure);
    expect(up.lines[0].y).toBeGreaterThan(at.y);
    const above = labelLayout(label({ style: 'circle', yloc: 'abovebar' }), at, measure);
    expect(above.lines[0].y).toBeLessThan(at.y);
  });

  it('draws style_none as text alone and style_text_outline as outlined text', () => {
    const none = labelLayout(label({ style: 'none' }), at, measure);
    expect([none.kind, none.rect, none.shape, none.outline]).toEqual(['text', null, null, false]);
    expect(none.lines[0].x).toBe(at.x);
    expect(labelLayout(label({ style: 'text_outline' }), at, measure).outline).toBe(true);
  });
});

describe('labelHit', () => {
  it('is true inside the bubble and its pointer and false outside', () => {
    const l = labelLayout(label(), at, measure);
    expect(labelHit(l, { x: 200, y: 80 })).toBe(true);
    expect(labelHit(l, { x: 200, y: 100 })).toBe(true);
    expect(labelHit(l, { x: 200, y: 110 })).toBe(false);
    expect(labelHit(l, { x: 400, y: 80 })).toBe(false);
  });
});
