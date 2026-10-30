import { describe, expect, it } from 'vitest';
import { entryDisabled, entryTitle } from '../../DrawingRail';
import { allEntries } from '../../../lib/drawingRail';
import { resolveStyle, validateValue } from '../../../lib/drawingStyle';
import { ANCHOR_COUNTS, TEXT_TOOLS, TOOLS, VALIDATORS } from './index';
import { image } from './image';
import type { ToolView } from './types';

const KEY = 'a'.repeat(64);
const W = 400;
const H = 300;
function view(style?: Record<string, unknown>, withImage = true): ToolView {
  return { width: W, height: H, anchors: [], candles: [], text: '', cells: [], image: withImage ? { key: KEY, w: 40, h: 30 } : undefined, times: [], priceToY: () => null, formatPrice: String, style: resolveStyle(image.settings ?? [], style).values, styled: false };
}
type Call = [string, unknown[]];
function recorder() {
  const calls: Call[] = [];
  const ctx = new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => void calls.push([name, args]), set: () => true }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
const a = { x: 50, y: 60 };
const b = { x: 150, y: 110 };

describe('image tool', () => {
  it('is in Annotations, section Content, after Flag mark, with two anchors and no Text tab', () => {
    expect(image.group).toBe('annotations');
    expect(image.section).toBe('Content');
    expect(image.anchors).toBe(2);
    expect(ANCHOR_COUNTS.image).toBe(2);
    expect(image.text).toBeUndefined();
    expect(image.caption).toBeUndefined();
    expect(TEXT_TOOLS.has('image')).toBe(false);
    expect(image.settings!.every((f) => f.tab === 'style')).toBe(true);
    const ids = TOOLS.map((t) => t.id);
    expect(ids.indexOf('image')).toBe(ids.indexOf('flagMark') + 1);
  });

  it('has the TradingView defaults: full opacity, no border, keep ratio on', () => {
    for (const f of image.settings!) expect(validateValue(f, f.default), f.key).toBeDefined();
    expect(view().style).toMatchObject({ opacity: 1, borderWidth: 0, keepRatio: true });
    const width = image.settings!.find((f) => f.key === 'borderWidth')!;
    expect(validateValue(width, 5)).toBe(5);
    expect(validateValue(width, 0)).toBe(0);
    expect(validateValue(width, 6)).not.toBe(6);
  });

  it('hits anywhere inside the box and not outside it, and has four corner handles', () => {
    expect(image.hit([a, b], { x: 100, y: 80 }, view())).toBe(true);
    expect(image.hit([a, b], { x: 51, y: 61 }, view())).toBe(true);
    expect(image.hit([a, b], { x: 300, y: 80 }, view())).toBe(false);
    expect(image.hit([b, a], { x: 100, y: 80 }, view())).toBe(true);
    expect(image.handles([a, b], view())).toEqual([{ x: 50, y: 60 }, { x: 150, y: 60 }, { x: 150, y: 110 }, { x: 50, y: 110 }]);
  });

  it('validates a stored image and drops a malformed one', () => {
    const good = { id: 'i', tool: 'image', anchors: [{ time: 1, price: 1 }, { time: 2, price: 2 }], image: { key: KEY, w: 40, h: 30, extra: 1 } };
    expect(VALIDATORS.image(good as never)).toMatchObject({ image: { key: KEY, w: 40, h: 30 } });
    expect((VALIDATORS.image(good as never) as { image: object }).image).not.toHaveProperty('extra');
    const bad = (img: unknown) => VALIDATORS.image({ ...good, image: img } as never);
    for (const img of [undefined, null, 'x', {}, { key: 'A'.repeat(64), w: 1, h: 1 }, { key: 'a'.repeat(63), w: 1, h: 1 }, { key: KEY, w: 0, h: 1 }, { key: KEY, w: 1.5, h: 1 }, { key: KEY, w: 16385, h: 1 }, { key: KEY, w: 1, h: '2' }]) {
      expect(bad(img), JSON.stringify(img)).toBeNull();
    }
  });

  it('does not throw while a picture is loading (the first draw) and draws the placeholder once the store has none', async () => {
    const first = recorder();
    expect(() => image.draw(first.ctx, [a, b], view(), { selected: true })).not.toThrow();
    expect(first.calls.some(([n]) => n === 'fillText')).toBe(false);
    await new Promise((r) => setTimeout(r, 20)); // the load ends: node has no store, so the picture is missing
    const later = recorder();
    image.draw(later.ctx, [a, b], view(), { selected: true });
    expect(later.calls.find(([n]) => n === 'setLineDash')?.[1]).toEqual([[5, 4]]);
    expect(later.calls.find(([n]) => n === 'fillText')?.[1][0]).toBe('Picture missing');
  });

  it('draws the placeholder for a drawing without a picture', () => {
    const { ctx, calls } = recorder();
    image.draw(ctx, [a, b], view(undefined, false), { selected: false });
    expect(calls.find(([n]) => n === 'fillText')?.[1][0]).toBe('Picture missing');
  });

  it('draws nothing for a zero-size or one-point draft', () => {
    const { ctx, calls } = recorder();
    expect(() => image.draw(ctx, [a], view(), { selected: false })).not.toThrow();
    expect(() => image.draw(ctx, [a, a], view(), { selected: false })).not.toThrow();
    expect(calls.length).toBe(0);
  });

  it('keeps the ratio of the current box on a corner drag, and frees it with Shift or keep ratio off', () => {
    // a 100 x 50 box: dragging the bottom-right corner far right keeps 2:1
    const [opp, moved] = image.dragHandle!([a, b], 2, { x: 350, y: 120 }, { shift: false, style: view().style });
    expect(opp).toEqual({ x: 50, y: 60 });
    expect((moved.x - opp.x) / (moved.y - opp.y)).toBeCloseTo(2);
    expect(image.dragHandle!([a, b], 2, { x: 350, y: 120 }, { shift: true })[1]).toEqual({ x: 350, y: 120 });
    expect(image.dragHandle!([a, b], 2, { x: 350, y: 120 }, { shift: false, style: { keepRatio: false } })[1]).toEqual({ x: 350, y: 120 });
    // from the top-left corner the opposite one stays
    const [opp0, moved0] = image.dragHandle!([a, b], 0, { x: 10, y: 10 }, { shift: false });
    expect(opp0).toEqual({ x: 150, y: 110 });
    expect((opp0.x - moved0.x) / (opp0.y - moved0.y)).toBeCloseTo(2);
  });

  it('is disabled in the rail, titled with why, only when pictures cannot be stored', () => {
    const entries = allEntries();
    const e = entries.find((x) => x.key === 'image')!;
    const flag = entries.find((x) => x.key === 'flagMark')!;
    expect(e.section).toBe('Content');
    expect(entryDisabled(e, { disabled: false, hidden: false })).toBe(false);
    expect(entryDisabled(e, { disabled: false, hidden: false, imagesOff: true })).toBe(true);
    expect(entryDisabled(flag, { disabled: false, hidden: false, imagesOff: true })).toBe(false);
    expect(entryTitle(e, { imagesOff: true })).toBe("Pictures can't be stored in this browser.");
    expect(entryTitle(e, {})).toBe('Image');
  });
});
