import { describe, expect, it } from 'vitest';
import type { OhlcBar } from '../../../lib/drawingGeometry';
import { resolveStyle } from '../../../lib/drawingStyle';
import type { Drawing } from '../../../lib/drawings';
import { barsPattern } from './barsPattern';
import { ghostFeed } from './ghostFeed';
import { TOOLS } from './index';
import type { DrawingTool, ToolView } from './types';

const W = 600;
const H = 400;
const times = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
const candles: OhlcBar[] = [
  { time: 10, open: 100, high: 112, low: 99, close: 110 },
  { time: 20, open: 110, high: 120, low: 108, close: 118 },
  { time: 30, open: 118, high: 125, low: 115, close: 116 },
];
// Bar i sits at x = 100 + 20 i; price p at y = 400 - p.
const indexToX = (i: number) => 100 + 20 * i;
function view(tool: DrawingTool, a: { time: number; price: number }[], extra: Partial<ToolView> = {}, style?: Record<string, unknown>): ToolView {
  return { width: W, height: H, anchors: a, candles, text: '', times, indexToX, priceToY: (p) => H - p, formatPrice: (p) => p.toFixed(2), style: resolveStyle(tool.settings ?? [], style).values, styled: false, cells: [], glyph: '', ...extra };
}
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? (t: string) => ({ width: t.length * 6 }) : (...a: unknown[]) => calls.push(`${String(k)}${a.length}`)), set: () => true }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
const opts = { selected: false };

describe('registration', () => {
  it('sits in Forecasting right after the projection and before the volume tools', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(ids.indexOf('barsPattern')).toBe(ids.indexOf('projection') + 1);
    expect(ids.indexOf('ghostFeed')).toBe(ids.indexOf('projection') + 2);
    expect(ids.indexOf('ghostFeed')).toBeLessThan(ids.indexOf('anchoredVwap'));
    expect([barsPattern, ghostFeed].map((t) => [t.id, t.label, t.group, t.section, t.barTime])).toEqual([
      ['barsPattern', 'Bars pattern', 'forecast-measure', 'Forecasting', true],
      ['ghostFeed', 'Ghost feed', 'forecast-measure', 'Forecasting', true],
    ]);
    expect(barsPattern.anchors).toBe(3);
    expect(barsPattern.placed).toBe(2);
    expect(ghostFeed.anchors).toEqual({ min: 2, max: 100 });
  });
  it('adds no text setting', () => {
    for (const t of [barsPattern, ghostFeed]) expect((t.settings ?? []).some((s) => s.tab === 'text')).toBe(false);
  });
});

describe('barsPattern', () => {
  // Source run bars at x 120..160, y of its high 275 (125) and low 301 (99); copy from x = 180, first open 100.
  const anchors = [{ time: 10, price: 100 }, { time: 30, price: 118 }, { time: 40, price: 100 }];
  const pts = [{ x: 120, y: 300 }, { x: 160, y: 282 }, { x: 180, y: 300 }];
  it('hits on a drawn copy bar and on the frame edge, not a little away', () => {
    const v = view(barsPattern, anchors);
    expect(barsPattern.hit(pts, { x: 180, y: 295 }, v)).toBe(true); // first copy bar: high 112 -> y 288 .. low 99 -> y 301
    expect(barsPattern.hit(pts, { x: 140, y: 275 }, v)).toBe(true); // frame top edge
    expect(barsPattern.hit(pts, { x: 120, y: 290 }, v)).toBe(true); // frame left edge
    expect(barsPattern.hit(pts, { x: 140, y: 275 - 12 }, v)).toBe(false);
    expect(barsPattern.hit(pts, { x: 175 - 14, y: 330 }, v)).toBe(false);
    expect(barsPattern.hit(pts, { x: 300, y: 100 }, v)).toBe(false);
  });
  it('has a handle at each of its three anchors', () => {
    expect(barsPattern.handles(pts, view(barsPattern, anchors))).toEqual(pts);
  });
  it('settle adds the third anchor one slot after the later source anchor at the first bar open', () => {
    const placed = [{ x: 160, y: 282 }, { x: 120, y: 300 }];
    const v = view(barsPattern, [{ time: 30, price: 118 }, { time: 10, price: 100 }]);
    const out = barsPattern.settle!(placed, v);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ x: 180, y: 300 });
  });
  it('settle falls back to the first anchor price with no loaded bar in the run', () => {
    const v = view(barsPattern, [{ time: 50, price: 90 }, { time: 60, price: 95 }], { candles: [] });
    const out = barsPattern.settle!([{ x: 200, y: 310 }, { x: 220, y: 305 }], v);
    expect(out[2]).toEqual({ x: 240, y: 310 });
  });
  it('draws, in every display mode and both transforms, without throwing, also with no or one bar', () => {
    for (const mode of ['hl', 'oc', 'open', 'high', 'low', 'close']) {
      for (const [mirrored, flipped] of [[false, false], [true, true]]) {
        const { ctx, calls } = recorder();
        barsPattern.draw(ctx, pts, view(barsPattern, anchors, {}, { mode, mirrored, flipped }), opts);
        expect(calls.length).toBeGreaterThan(0);
      }
    }
    for (const c of [[], [candles[0]]]) {
      const { ctx } = recorder();
      expect(() => barsPattern.draw(ctx, pts, view(barsPattern, anchors, { candles: c }), { selected: true })).not.toThrow();
      expect(() => barsPattern.draw(ctx, pts.slice(0, 2), view(barsPattern, anchors.slice(0, 2), { candles: c }), opts)).not.toThrow();
      expect(() => barsPattern.hit(pts, { x: 0, y: 0 }, view(barsPattern, anchors, { candles: c }))).not.toThrow();
    }
    expect(() => barsPattern.draw(recorder().ctx, [pts[0]], view(barsPattern, [anchors[0]]), opts)).not.toThrow();
  });
  it('draws only the frame (one rectangle, no bar lines) with no loaded bar in the run', () => {
    const { ctx, calls } = recorder();
    barsPattern.draw(ctx, pts, view(barsPattern, anchors, { candles: [] }), opts);
    expect(calls.filter((c) => c.startsWith('lineTo'))).toEqual([]);
  });
  it('validates the anchor count and finiteness', () => {
    const d = { id: 'x', tool: 'barsPattern', anchors } as Drawing;
    expect(barsPattern.validate!(d)).toBe(d);
    expect(barsPattern.validate!({ ...d, anchors: anchors.slice(0, 2) })).toBeNull();
    expect(barsPattern.validate!({ ...d, anchors: [...anchors.slice(0, 2), { time: 1, price: NaN }] })).toBeNull();
  });
});

describe('ghostFeed', () => {
  const anchors = [{ time: 10, price: 100 }, { time: 40, price: 130 }, { time: 60, price: 120 }];
  const pts = [{ x: 120, y: 300 }, { x: 180, y: 270 }, { x: 220, y: 280 }];
  it('hits on the path and on a drawn bar, not a few pixels beyond the tolerance', () => {
    const v = view(ghostFeed, anchors);
    expect(ghostFeed.hit(pts, { x: 150, y: 285 }, v)).toBe(true);
    expect(ghostFeed.hit(pts, { x: 150, y: 285 - 40 }, v)).toBe(false);
    expect(ghostFeed.hit(pts, { x: 500, y: 20 }, v)).toBe(false);
  });
  it('has a handle at every anchor', () => {
    expect(ghostFeed.handles(pts, view(ghostFeed, anchors))).toEqual(pts);
  });
  it('draws the same calls on every paint and does not throw with two points, equal points or no bars', () => {
    const run = () => {
      const { ctx, calls } = recorder();
      ghostFeed.draw(ctx, pts, view(ghostFeed, anchors), opts);
      return calls;
    };
    expect(run()).toEqual(run());
    expect(run().length).toBeGreaterThan(10);
    expect(() => ghostFeed.draw(recorder().ctx, pts.slice(0, 2), view(ghostFeed, anchors.slice(0, 2)), opts)).not.toThrow();
    expect(() => ghostFeed.draw(recorder().ctx, [pts[0], pts[0]], view(ghostFeed, [anchors[0], anchors[0]]), opts)).not.toThrow();
    expect(() => ghostFeed.draw(recorder().ctx, pts, view(ghostFeed, anchors, { candles: [], times: [], indexToX: undefined }), opts)).not.toThrow();
  });
  it('reads the average height in ticks times the tick size', () => {
    // A flat segment at variance 0: each bar's wick runs the whole average height, so its pixel length is ticks x tick size.
    const wickLength = (tickSize?: number) => {
      const from: number[] = [];
      const to: number[] = [];
      const ctx = new Proxy({}, { get: (_, k) => (k === 'moveTo' ? (_x: number, y: number) => from.push(y) : k === 'lineTo' ? (_x: number, y: number) => to.push(y) : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
      const flat = [{ time: 10, price: 100 }, { time: 40, price: 100 }];
      ghostFeed.draw(ctx, [{ x: 120, y: 300 }, { x: 180, y: 300 }], view(ghostFeed, flat, { tickSize }, { variance: 0, avgHeight: 20 }), opts);
      return to[0] - from[0];
    };
    expect(wickLength(0.5)).toBeCloseTo(10, 6);
    expect(wickLength(1)).toBeCloseTo(20, 6);
    expect(wickLength(undefined)).toBeCloseTo(20, 6);
  });
  it('validates the anchor range and finiteness', () => {
    const d = { id: 'x', tool: 'ghostFeed', anchors } as Drawing;
    expect(ghostFeed.validate!(d)).toBe(d);
    expect(ghostFeed.validate!({ ...d, anchors: anchors.slice(0, 1) })).toBeNull();
    expect(ghostFeed.validate!({ ...d, anchors: [anchors[0], { time: NaN, price: 1 }] })).toBeNull();
  });
});
