import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import type { OhlcBar } from '../../../lib/drawingGeometry';
import type { Drawing } from '../../../lib/drawings';
import { forecast } from './forecast';
import { projection } from './projection';
import { TOOLS } from './index';
import type { DrawingTool, ToolView } from './types';

const W = 600;
const H = 400;
const bar = (time: number, low: number, high: number): OhlcBar => ({ time, open: low, high, low, close: high } as OhlcBar);
function view(tool: DrawingTool, a: { time: number; price: number }[], extra: Partial<ToolView> = {}): ToolView {
  return { width: W, height: H, anchors: a, candles: [], text: '', times: [], priceToY: (p) => H - p, formatPrice: (p) => p.toFixed(2), style: resolveStyle(tool.settings ?? [], undefined).values, styled: false, cells: [], glyph: '', ...extra };
}
function recorder() {
  const texts: string[] = [];
  const strokes: unknown[] = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (k === 'fillText' ? (t: string) => texts.push(t) : k === 'measureText' ? (t: string) => ({ width: t.length * 6 }) : () => undefined),
    set: (_, k, v) => { if (k === 'strokeStyle') strokes.push(v); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, strokes };
}
const opts = { selected: false };

describe('registration', () => {
  it('sits in Forecasting right after the short position and before the measure', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(ids.indexOf('forecast')).toBe(ids.indexOf('shortPosition') + 1);
    expect(ids.indexOf('projection')).toBe(ids.indexOf('shortPosition') + 2);
    expect(ids.indexOf('projection')).toBeLessThan(ids.indexOf('measure'));
    expect([forecast, projection].map((t) => [t.id, t.label, t.group, t.section, t.anchors])).toEqual([
      ['forecast', 'Forecast', 'forecast-measure', 'Forecasting', 2],
      ['projection', 'Projection', 'forecast-measure', 'Forecasting', 3],
    ]);
  });
});

describe('forecast', () => {
  const pts = [{ x: 100, y: 300 }, { x: 300, y: 200 }];
  const anchors = [{ time: 10, price: 100 }, { time: 30, price: 200 }];
  it('hits on the line and not a little away; handles are the two points', () => {
    const v = view(forecast, anchors);
    expect(forecast.hit(pts, { x: 200, y: 250 }, v)).toBe(true);
    expect(forecast.hit(pts, { x: 200, y: 270 }, v)).toBe(false);
    expect(forecast.handles(pts, v)).toEqual(pts);
  });
  it('labels the source and target prices and the time while selected only', () => {
    const style = resolveStyle(forecast.settings ?? [], undefined).values;
    expect(forecast.axisLabels!(anchors, style, true)).toEqual({ price: [100, 200], time: [30] });
    expect(forecast.axisLabels!(anchors, style, false)).toEqual({});
  });
  it('validates the anchor count and finiteness', () => {
    const d = { id: 'x', tool: 'forecast', anchors } as Drawing;
    expect(forecast.validate!(d)).toBe(d);
    expect(forecast.validate!({ ...d, anchors: [anchors[0]] })).toBeNull();
    expect(forecast.validate!({ ...d, anchors: [anchors[0], { time: 3, price: NaN }] })).toBeNull();
  });
  it('draws Success, Failure or nothing by the bars, and never throws on partial points or few bars', () => {
    const times = [10, 20, 30];
    const bars = [bar(10, 99, 101), bar(20, 98, 150), bar(30, 97, 120)];
    const run = (a: typeof anchors, candles: OhlcBar[], p = pts) => {
      const r = recorder();
      forecast.draw(r.ctx, p, view(forecast, a, { candles, times: candles.map((c) => c.time) }), opts);
      return r.texts;
    };
    expect(run(anchors, bars)).not.toContain('Success');
    expect(run([anchors[0], { time: 30, price: 140 }], bars)).toContain('Success');
    expect(run(anchors, bars)).toContain('Failure');
    expect(run(anchors, [bars[0]])).not.toContain('Failure');
    expect(run([anchors[0], { time: 40, price: 140 }], bars)).not.toContain('Failure');
    expect(() => run(anchors, [])).not.toThrow();
    expect(() => run([], [], [pts[0]])).not.toThrow();
    expect(() => run([anchors[0]], bars)).not.toThrow();
    expect(times).toHaveLength(3);
  });
  it('shows the failure in the failure colour and success in the success colour', () => {
    const bars = [bar(10, 99, 101), bar(20, 98, 150), bar(30, 97, 120)];
    const colorOf = (price: number) => {
      const r = recorder();
      forecast.draw(r.ctx, pts, view(forecast, [anchors[0], { time: 30, price }], { candles: bars, times: [10, 20, 30] }), opts);
      return r.strokes[0];
    };
    expect(colorOf(140)).toBe('#22c55e');
    expect(colorOf(200)).toBe('#ef4444');
  });
});

describe('projection', () => {
  const pts = [{ x: 100, y: 300 }, { x: 300, y: 300 }, { x: 100, y: 100 }];
  const anchors = [{ time: 10, price: 100 }, { time: 30, price: 100 }, { time: 10, price: 300 }];
  const v = view(projection, anchors);
  it('hits on both lines, the arc and the fill, and not a little away', () => {
    expect(projection.hit(pts, { x: 200, y: 300 }, v)).toBe(true);
    expect(projection.hit(pts, { x: 100, y: 200 }, v)).toBe(true);
    // the arc: radius 200 around (100, 300), at 45 degrees up
    expect(projection.hit(pts, { x: 100 + 200 * Math.SQRT1_2, y: 300 - 200 * Math.SQRT1_2 }, v)).toBe(true);
    expect(projection.hit(pts, { x: 150, y: 250 }, v)).toBe(true);
    expect(projection.hit(pts, { x: 100 + 200 * Math.SQRT1_2 + 20, y: 300 - 200 * Math.SQRT1_2 - 20 }, v)).toBe(false);
    expect(projection.hit(pts, { x: 50, y: 350 }, v)).toBe(false);
    expect(projection.hit([pts[0], pts[1]], { x: 200, y: 300 }, v)).toBe(true);
  });
  it('has a handle at each point, labels while selected only and validates', () => {
    expect(projection.handles(pts, v)).toEqual(pts);
    const style = v.style;
    expect(projection.axisLabels!(anchors, style, true)).toEqual({ price: [100, 100, 300], time: [10, 30, 10] });
    expect(projection.axisLabels!(anchors, style, false)).toEqual({});
    const d = { id: 'x', tool: 'projection', anchors } as Drawing;
    expect(projection.validate!(d)).toBe(d);
    expect(projection.validate!({ ...d, anchors: anchors.slice(0, 2) })).toBeNull();
    expect(projection.validate!({ ...d, anchors: [anchors[0], anchors[1], { time: NaN, price: 1 }] })).toBeNull();
  });
  it('labels the projection as a percent of the leg and never throws on partial or equal points', () => {
    const r = recorder();
    projection.draw(r.ctx, pts, v, opts);
    expect(r.texts).toEqual(['100.00%']);
    const p = { x: 5, y: 5 };
    expect(() => projection.draw(recorder().ctx, [p, p, p], v, opts)).not.toThrow();
    expect(() => projection.draw(recorder().ctx, [p, pts[1]], v, opts)).not.toThrow();
    expect(() => projection.draw(recorder().ctx, [p], v, opts)).not.toThrow();
    expect(projection.hit([p, p, p], p, v)).toBe(true);
    expect(() => projection.hit([p, p, p], { x: 9, y: 9 }, v)).not.toThrow();
  });
});
