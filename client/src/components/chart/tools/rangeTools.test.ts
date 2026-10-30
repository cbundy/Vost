import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import type { OhlcBar } from '../../../lib/drawingGeometry';
import type { Drawing } from '../../../lib/drawings';
import { dateRange } from './dateRange';
import { datePriceRange } from './datePriceRange';
import { priceRange } from './priceRange';
import { measure } from './measure';
import { TOOLS } from './index';
import type { DrawingTool, ToolView } from './types';

const W = 600;
const H = 400;
const bars: OhlcBar[] = [10, 20, 30, 40].map((time) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: time }));
function view(tool: DrawingTool, a: { time: number; price: number }[], extra: Partial<ToolView> = {}, over: Record<string, unknown> = {}): ToolView {
  const style = { ...resolveStyle(tool.settings ?? [], undefined).values, ...over };
  return { width: W, height: H, anchors: a, candles: bars, text: '', times: bars.map((b) => b.time), priceToY: (p) => H - p, formatPrice: (p) => p.toFixed(2), tickSize: 0.01, style, styled: false, cells: [], glyph: '', ...extra };
}
function recorder() {
  const texts: string[] = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (k === 'fillText' ? (t: string) => texts.push(t) : k === 'measureText' ? (t: string) => ({ width: t.length * 6 }) : () => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}
const opts = { selected: false };
const anchors = [{ time: 10, price: 100 }, { time: 30, price: 200 }];
// Pixel box: x 100..300, y 300..200 (the first anchor is lower).
const pts = [{ x: 100, y: 300 }, { x: 300, y: 200 }];
const all = [priceRange, dateRange, datePriceRange];

describe('registration', () => {
  it('sits in Measurers right before the measure, stored, with two anchors', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(ids.indexOf('priceRange')).toBe(ids.indexOf('measure') - 3);
    expect(ids.slice(ids.indexOf('measure') - 3, ids.indexOf('measure'))).toEqual(['priceRange', 'dateRange', 'datePriceRange']);
    expect(all.map((t) => [t.id, t.label, t.group, t.section, t.anchors, !!t.transient])).toEqual([
      ['priceRange', 'Price range', 'forecast-measure', 'Measurers', 2, false],
      ['dateRange', 'Date range', 'forecast-measure', 'Measurers', 2, false],
      ['datePriceRange', 'Date and price range', 'forecast-measure', 'Measurers', 2, false],
    ]);
    expect(measure.transient).toBe(true);
  });
  it('has TradingView defaults, extension settings only on the price and date range', () => {
    const keys = (t: DrawingTool) => (t.settings ?? []).map((f) => f.key);
    expect(keys(priceRange)).toContain('extendLeft');
    expect(keys(dateRange)).toContain('extendTop');
    expect(keys(datePriceRange).some((k) => k.startsWith('extend'))).toBe(false);
    const v = resolveStyle(priceRange.settings ?? [], undefined).values;
    expect([v.textSize, v.fill, v.labelFill, v.extendLeft, v.extendRight]).toEqual([12, true, true, false, false]);
  });
});

describe.each(all)('$id', (tool) => {
  it('hits inside the box and not 10 px outside; handles are the two points', () => {
    const v = view(tool, anchors);
    expect(tool.hit(pts, { x: 150, y: 270 }, v)).toBe(true);
    expect(tool.hit(pts, { x: 90 - 10, y: 250 }, v)).toBe(false);
    expect(tool.hit(pts, { x: 200, y: 310 }, v)).toBe(false);
    expect(tool.handles(pts, v)).toEqual(pts);
  });
  it('with the fill off hits an edge but not the middle', () => {
    const v = view(tool, anchors, {}, { fill: false });
    expect(tool.hit(pts, { x: 100, y: 230 }, v)).toBe(true);
    expect(tool.hit(pts, { x: 140, y: 280 }, v)).toBe(false);
  });
  it('validates the anchor count and finiteness', () => {
    const d = { id: 'x', tool: tool.id, anchors } as Drawing;
    expect(tool.validate!(d)).toBe(d);
    expect(tool.validate!({ ...d, anchors: [anchors[0]] })).toBeNull();
    expect(tool.validate!({ ...d, anchors: [anchors[0], { time: 3, price: NaN }] })).toBeNull();
  });
  it('draws without throwing on one point, no candles, no tick size, equal and reversed anchors', () => {
    const { ctx } = recorder();
    expect(() => tool.draw(ctx, [pts[0]], view(tool, [anchors[0]]), opts)).not.toThrow();
    expect(() => tool.draw(ctx, pts, view(tool, anchors, { candles: [], times: [] }), opts)).not.toThrow();
    expect(() => tool.draw(ctx, pts, view(tool, anchors, { tickSize: undefined }), opts)).not.toThrow();
    expect(() => tool.draw(ctx, [pts[0], pts[0]], view(tool, [anchors[0], anchors[0]]), opts)).not.toThrow();
    expect(() => tool.draw(ctx, [pts[1], pts[0]], view(tool, [anchors[1], anchors[0]]), opts)).not.toThrow();
  });
});

describe('arrows and hit on the arrow', () => {
  it('the price range arrow is vertical at the centre, the date range arrow horizontal', () => {
    const thin = [{ x: 100, y: 300 }, { x: 300, y: 200 }];
    const nofill = { fill: false };
    expect(priceRange.hit(thin, { x: 200, y: 250 }, view(priceRange, anchors, {}, nofill))).toBe(true);
    expect(priceRange.hit(thin, { x: 150, y: 250 }, view(priceRange, anchors, {}, nofill))).toBe(false);
    expect(dateRange.hit(thin, { x: 150, y: 250 }, view(dateRange, anchors, {}, nofill))).toBe(true);
    expect(dateRange.hit(thin, { x: 200, y: 280 }, view(dateRange, anchors, {}, nofill))).toBe(false);
  });
});

describe('extension', () => {
  function boxOf(tool: DrawingTool, over: Record<string, unknown>) {
    const rects: number[][] = [];
    const ctx = new Proxy({}, {
      get: (_, k) => (k === 'strokeRect' ? (...a: number[]) => rects.push(a) : k === 'measureText' ? (t: string) => ({ width: t.length * 6 }) : () => undefined),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    tool.draw(ctx, pts, view(tool, anchors, {}, over), opts);
    return rects[0];
  }
  it('the price range reaches the pane edges only on an extended side', () => {
    expect(boxOf(priceRange, {})).toEqual([100, 200, 200, 100]);
    expect(boxOf(priceRange, { extendLeft: true })).toEqual([0, 200, 300, 100]);
    expect(boxOf(priceRange, { extendRight: true })).toEqual([100, 200, W - 100, 100]);
    expect(boxOf(priceRange, { extendLeft: true, extendRight: true })).toEqual([0, 200, W, 100]);
  });
  it('the date range reaches the pane edges only on an extended side', () => {
    expect(boxOf(dateRange, { extendTop: true })).toEqual([100, 0, 200, 300]);
    expect(boxOf(dateRange, { extendBottom: true })).toEqual([100, 200, 200, H - 200]);
    expect(boxOf(dateRange, { extendTop: true, extendBottom: true })).toEqual([100, 0, 200, H]);
  });
  it('a hit lands in the extended part', () => {
    expect(priceRange.hit(pts, { x: 30, y: 250 }, view(priceRange, anchors))).toBe(false);
    expect(priceRange.hit(pts, { x: 30, y: 250 }, view(priceRange, anchors, {}, { extendLeft: true }))).toBe(true);
  });
});

describe('axis labels', () => {
  const style = {};
  it('label the prices, the times, or both while selected only', () => {
    expect(priceRange.axisLabels!(anchors, style, true)).toEqual({ price: [100, 200] });
    expect(dateRange.axisLabels!(anchors, style, true)).toEqual({ time: [10, 30] });
    expect(datePriceRange.axisLabels!(anchors, style, true)).toEqual({ price: [100, 200], time: [10, 30] });
    for (const t of all) expect(t.axisLabels!(anchors, style, false)).toEqual({});
  });
});

describe('labels', () => {
  it('the price range shows change, percent and ticks', () => {
    const { ctx, texts } = recorder();
    priceRange.draw(ctx, pts, view(priceRange, anchors), opts);
    expect(texts).toEqual(['+100.00 (+100.00%) 10000 ticks']);
  });
  it('leaves ticks out without a tick size', () => {
    const { ctx, texts } = recorder();
    priceRange.draw(ctx, pts, view(priceRange, anchors, { tickSize: undefined }), opts);
    expect(texts).toEqual(['+100.00 (+100.00%)']);
  });
  it('the date range shows bars, elapsed time and the inclusive volume, negative bars when reversed', () => {
    const { ctx, texts } = recorder();
    dateRange.draw(ctx, pts, view(dateRange, anchors), opts);
    expect(texts).toEqual(['2 bars, 20s', 'Vol 60.00']);
    const r = recorder();
    dateRange.draw(r.ctx, pts, view(dateRange, [anchors[1], anchors[0]]), opts);
    expect(r.texts[0]).toBe('-2 bars, 20s');
  });
  it('the date and price range shows all three lines', () => {
    const { ctx, texts } = recorder();
    datePriceRange.draw(ctx, pts, view(datePriceRange, anchors), opts);
    expect(texts).toEqual(['+100.00 (+100.00%) 10000 ticks', '2 bars, 20s', 'Vol 60.00']);
  });
  it('shows a dash for the percent of a zero start price', () => {
    const { ctx, texts } = recorder();
    priceRange.draw(ctx, pts, view(priceRange, [{ time: 10, price: 0 }, anchors[1]]), opts);
    expect(texts[0]).toContain('(-)');
  });
});
