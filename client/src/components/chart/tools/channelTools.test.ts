import { describe, expect, it } from 'vitest';
import type { Pt } from '../../../lib/drawingGeometry';
import { resolveStyle } from '../../../lib/drawingStyle';
import { lineYAt, parallelOffset } from '../../../lib/geometry/channels';
import { disjointChannel } from './disjointChannel';
import { flatTopBottom } from './flatTopBottom';
import { parallelChannel } from './parallelChannel';
import { regressionTrend } from './regressionTrend';
import type { DrawingTool, ToolView } from './types';

const W = 400;
const H = 300;
const bars = [10, 12, 11, 15, 14, 18].map((c, i) => ({ time: (i + 1) * 60, open: c, high: c + 1, low: c - 1, close: c }));

function view(tool: DrawingTool, anchors: ToolView['anchors'] = [], style?: Record<string, unknown>, candles = bars): ToolView {
  return {
    width: W,
    height: H,
    anchors,
    text: '',
    times: candles.map((c) => c.time),
    candles,
    priceToY: (p) => H - p * 10,
    formatPrice: String,
    style: resolveStyle(tool.settings ?? [], style, undefined).values,
    styled: false,
    glyph: '',
    cells: [],
  };
}

/** A canvas context that records the calls made on it. */
function stubCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => void calls.push(`${k}(${a.map((x) => (typeof x === 'number' ? Math.round(x) : '')).join(',')})`)),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const A = { time: 60, price: 10 };
const B = { time: 360, price: 18 };
const C = { time: 200, price: 5 };
const tools = [parallelChannel, regressionTrend, flatTopBottom, disjointChannel];

describe('the registry entries', () => {
  it('sit in the Lines group, section Channels, with the right anchor counts', () => {
    expect(tools.map((t) => [t.id, t.group, t.section, t.anchors])).toEqual([
      ['parallelChannel', 'lines', 'Channels', 3],
      ['regressionTrend', 'lines', 'Channels', 2],
      ['flatTopBottom', 'lines', 'Channels', 3],
      ['disjointChannel', 'lines', 'Channels', 3],
    ]);
  });
  it('declare settings with TradingView-like defaults', () => {
    expect(view(parallelChannel).style).toMatchObject({ extendLeft: false, extendRight: false, showMiddle: true, fillOpacity: 0.1 });
    expect(view(regressionTrend).style).toMatchObject({ source: 'close', deviation: 2, extendLeft: false });
    expect(view(flatTopBottom).style.fillOpacity).toBe(0.1);
  });
});

describe('a partial draft', () => {
  it('draws without throwing for every number of points', () => {
    const pts: Pt[] = [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }];
    for (const t of tools) {
      for (let n = 0; n <= 3; n++) {
        const { ctx } = stubCtx();
        expect(() => t.draw(ctx, pts.slice(0, n), view(t, [A, B, C].slice(0, n)), { selected: false }), `${t.id} ${n}`).not.toThrow();
        expect(() => t.hit(pts.slice(0, n), { x: 10, y: 10 }, view(t, [A, B, C].slice(0, n))), `${t.id} hit ${n}`).not.toThrow();
        expect(() => t.handles(pts.slice(0, n), view(t, [A, B, C].slice(0, n))), `${t.id} handles ${n}`).not.toThrow();
      }
    }
  });
  it('shows the first edge of a two-point three-anchor draft', () => {
    for (const t of [parallelChannel, flatTopBottom, disjointChannel]) {
      const { ctx, calls } = stubCtx();
      t.draw(ctx, [{ x: 10, y: 100 }, { x: 110, y: 50 }], view(t), { selected: false });
      expect(calls, t.id).toContain('moveTo(10,100)');
      expect(calls, t.id).toContain('lineTo(110,50)');
      expect(calls.filter((c) => c === 'fill()'), t.id).toHaveLength(0);
    }
  });
  it('draws nothing for a regression with fewer than two bars, one bar or none', () => {
    const pts = [{ x: 50, y: 100 }, { x: 150, y: 100 }];
    for (const candles of [[], bars.slice(0, 1)]) {
      const v = view(regressionTrend, [A, B], undefined, candles);
      const { ctx, calls } = stubCtx();
      regressionTrend.draw(ctx, pts, v, { selected: true });
      expect(calls).toEqual([]);
      expect(regressionTrend.hit(pts, { x: 100, y: 100 }, v)).toBe(false);
      expect(regressionTrend.handles(pts, v)).toEqual(pts);
    }
    const v = view(regressionTrend, [{ time: 61, price: 1 }, { time: 119, price: 1 }]);
    const { ctx, calls } = stubCtx();
    regressionTrend.draw(ctx, pts, v, { selected: false });
    expect(calls).toEqual([]);
  });
});

describe('parallel channel', () => {
  const pts = [{ x: 50, y: 200 }, { x: 250, y: 100 }, { x: 150, y: 190 }];
  const v = () => view(parallelChannel, [A, B, C]);
  it('is hit on both edges and between them, not away from them', () => {
    // edge 1 at x = 150 is y 150; the offset is 190 - 150 = 40, so edge 2 is at y 190
    expect(parallelChannel.hit(pts, { x: 150, y: 150 }, v())).toBe(true);
    expect(parallelChannel.hit(pts, { x: 150, y: 190 }, v())).toBe(true);
    expect(parallelChannel.hit(pts, { x: 150, y: 170 }, v())).toBe(true);
    expect(parallelChannel.hit(pts, { x: 150, y: 150 - 4 }, v(), 6)).toBe(true);
    expect(parallelChannel.hit(pts, { x: 150, y: 150 - 12 }, v(), 6)).toBe(false);
    expect(parallelChannel.hit(pts, { x: 150, y: 190 + 12 }, v(), 6)).toBe(false);
    expect(parallelChannel.hit(pts, { x: 350, y: 100 }, v())).toBe(false);
  });
  it('is hit beyond its anchors only when extended', () => {
    const p = { x: 330, y: 60 + 40 };
    expect(parallelChannel.hit(pts, p, v())).toBe(false);
    expect(parallelChannel.hit(pts, p, view(parallelChannel, [A, B, C], { extendRight: true }))).toBe(true);
  });
  it('has three handles: both ends and the middle of the second edge', () => {
    expect(parallelChannel.handles(pts, v())).toEqual([pts[0], pts[1], { x: 150, y: 190 }]);
  });
  it('keeps the channel parallel when an end is dragged', () => {
    const next = parallelChannel.dragHandle!(pts, 1, { x: 250, y: 60 });
    expect(next[0]).toEqual(pts[0]);
    expect(next[1]).toEqual({ x: 250, y: 60 });
    expect(parallelOffset(next[0], next[1], next[2])).toBeCloseTo(parallelOffset(pts[0], pts[1], pts[2]), 9);
    const first = parallelChannel.dragHandle!(pts, 0, { x: 20, y: 250 });
    expect(parallelOffset(first[0], first[1], first[2])).toBeCloseTo(40, 9);
  });
  it('sets the offset from the third handle and leaves the first edge alone', () => {
    const next = parallelChannel.dragHandle!(pts, 2, { x: 150, y: 240 });
    expect(next[0]).toEqual(pts[0]);
    expect(next[1]).toEqual(pts[1]);
    expect(parallelOffset(next[0], next[1], next[2])).toBeCloseTo(90, 9);
    expect(lineYAt(next[0], next[1], 150) + 90).toBeCloseTo(240, 9);
  });
  it('labels the anchors of a selected drawing only', () => {
    expect(parallelChannel.axisLabels!([A, B, C], {}, true)).toEqual({ price: [10, 18, 5], time: [60, 360, 200] });
    expect(parallelChannel.axisLabels!([A, B, C], {}, false)).toEqual({});
  });
  it('draws the fill, both edges and a dashed middle line', () => {
    const { ctx, calls } = stubCtx();
    parallelChannel.draw(ctx, pts, v(), { selected: false });
    expect(calls.filter((c) => c === 'fill()')).toHaveLength(1);
    expect(calls.filter((c) => c === 'stroke()')).toHaveLength(3);
    expect(calls.filter((c) => c.startsWith('setLineDash')).length).toBeGreaterThanOrEqual(3);
  });
  it('copes with equal anchors', () => {
    const same = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
    expect(() => parallelChannel.draw(stubCtx().ctx, same, v(), { selected: true })).not.toThrow();
    expect(parallelChannel.hit(same, { x: 5, y: 5 }, v())).toBe(true);
  });
});

describe('flat top/bottom', () => {
  const pts = [{ x: 50, y: 200 }, { x: 250, y: 100 }, { x: 150, y: 250 }];
  it('is hit on the sloped edge, the flat edge and between, not outside', () => {
    const v = view(flatTopBottom, [A, B, C]);
    expect(flatTopBottom.hit(pts, { x: 150, y: 150 }, v)).toBe(true);
    expect(flatTopBottom.hit(pts, { x: 100, y: 250 }, v)).toBe(true);
    expect(flatTopBottom.hit(pts, { x: 200, y: 220 }, v)).toBe(true);
    expect(flatTopBottom.hit(pts, { x: 150, y: 120 }, v)).toBe(false);
    expect(flatTopBottom.hit(pts, { x: 300, y: 250 }, v)).toBe(false);
    expect(flatTopBottom.hit(pts, { x: 100, y: 275 }, v)).toBe(false);
  });
  it('has its third handle halfway along the flat edge', () => {
    expect(flatTopBottom.handles(pts, view(flatTopBottom, [A, B, C]))).toEqual([pts[0], pts[1], { x: 150, y: 250 }]);
  });
  it('draws the fill and two edges', () => {
    const { ctx, calls } = stubCtx();
    flatTopBottom.draw(ctx, pts, view(flatTopBottom, [A, B, C]), { selected: false });
    expect(calls.filter((c) => c === 'fill()')).toHaveLength(1);
    expect(calls).toContain('moveTo(50,250)');
    expect(calls).toContain('lineTo(250,250)');
  });
});

describe('disjoint channel', () => {
  const pts = [{ x: 50, y: 200 }, { x: 150, y: 150 }, { x: 60, y: 100 }];
  const v = () => view(disjointChannel, [A, B, C]);
  it('draws the second edge mirrored from the third point', () => {
    const { ctx, calls } = stubCtx();
    disjointChannel.draw(ctx, pts, v(), { selected: false });
    expect(calls).toContain('moveTo(60,100)');
    expect(calls).toContain('lineTo(160,150)');
    expect(calls.filter((c) => c === 'fill()')).toHaveLength(1);
  });
  it('is hit on both edges and between them, not outside', () => {
    expect(disjointChannel.hit(pts, { x: 100, y: 175 }, v())).toBe(true);
    expect(disjointChannel.hit(pts, { x: 110, y: 125 }, v())).toBe(true);
    expect(disjointChannel.hit(pts, { x: 105, y: 150 }, v())).toBe(true);
    expect(disjointChannel.hit(pts, { x: 105, y: 215 }, v())).toBe(false);
    expect(disjointChannel.hit(pts, { x: 105, y: 80 }, v())).toBe(false);
  });
  it('has a handle on each anchor', () => {
    expect(disjointChannel.handles(pts, v())).toEqual(pts);
  });
});

describe('regression trend', () => {
  // The bars are at logical 0..5; the anchors sit on bars 1 and 4 (t = 120 and 300).
  const a = { time: 120, price: 12 };
  const b = { time: 300, price: 14 };
  const pts = [{ x: 100, y: 0 }, { x: 250, y: 0 }];
  const v = (style?: Record<string, unknown>, candles = bars) => view(regressionTrend, [a, b], style, candles);
  const strokes = (calls: string[]) => calls.filter((c) => c === 'stroke()').length;

  it('draws the fill and the base, upper and lower lines at the regression prices', () => {
    const { ctx, calls } = stubCtx();
    regressionTrend.draw(ctx, pts, v(), { selected: false });
    expect(calls.filter((c) => c === 'fill()')).toHaveLength(1);
    expect(strokes(calls)).toBe(3);
    // closes 12, 11, 15, 14 on bars 1..4: slope 1, mean 13, intercept 13 - 1.5 = 11.5, y = 300 - price * 10
    const base0 = Math.round(300 - 11.5 * 10);
    expect(calls).toContain(`moveTo(100,${base0})`);
    expect(calls).toContain(`lineTo(250,${Math.round(300 - (11.5 + 3) * 10)})`);
  });
  it('lets the deviation widen the band', () => {
    const narrow = regressionTrend.hit(pts, { x: 175, y: 300 - 14.5 * 10 + 30 }, v({ deviation: 0 }));
    const wide = regressionTrend.hit(pts, { x: 175, y: 300 - 14.5 * 10 + 30 }, v({ deviation: 4 }));
    expect(narrow).toBe(false);
    expect(wide).toBe(true);
  });
  it('follows the loaded bars', () => {
    const more = [...bars, { time: 420, open: 30, high: 31, low: 29, close: 30 }];
    const { calls: before } = (() => {
      const s = stubCtx();
      regressionTrend.draw(s.ctx, pts, v(), { selected: false });
      return s;
    })();
    const s = stubCtx();
    regressionTrend.draw(s.ctx, pts, v(undefined, more), { selected: false });
    expect(s.calls).toEqual(before);
    const wide = view(regressionTrend, [a, { time: 420, price: 1 }], undefined, more);
    const w = stubCtx();
    regressionTrend.draw(w.ctx, [pts[0], { x: 300, y: 0 }], wide, { selected: false });
    expect(w.calls).not.toEqual(before);
  });
  it('reads the chosen source', () => {
    const close = stubCtx();
    regressionTrend.draw(close.ctx, pts, v(), { selected: false });
    const high = stubCtx();
    regressionTrend.draw(high.ctx, pts, v({ source: 'high' }), { selected: false });
    expect(high.calls).not.toEqual(close.calls);
    expect(high.calls).toContain(`moveTo(100,${Math.round(300 - 12.5 * 10)})`);
  });
  it('extends to the pane edges when asked', () => {
    const { ctx, calls } = stubCtx();
    regressionTrend.draw(ctx, pts, v({ extendLeft: true, extendRight: true }), { selected: false });
    expect(calls.some((c) => c.startsWith('moveTo(0,'))).toBe(true);
    expect(calls.some((c) => c.startsWith('lineTo(400,'))).toBe(true);
  });
  it('gives anchors in either order the same lines', () => {
    const swapped = view(regressionTrend, [b, a]);
    const one = stubCtx();
    regressionTrend.draw(one.ctx, [pts[1], pts[0]], swapped, { selected: false });
    expect(strokes(one.calls)).toBe(3);
  });
  it('has handles on the regression line at both anchors and is hit on its lines', () => {
    const hs = regressionTrend.handles(pts, v());
    expect(hs.map((h) => h.x)).toEqual([100, 250]);
    expect(Math.round(hs[0].y)).toBe(Math.round(300 - 11.5 * 10));
    expect(regressionTrend.hit(pts, { x: 175, y: (hs[0].y + hs[1].y) / 2 }, v())).toBe(true);
    expect(regressionTrend.hit(pts, { x: 175, y: 5 }, v())).toBe(false);
    expect(regressionTrend.hit(pts, { x: 350, y: hs[1].y }, v())).toBe(false);
  });
  it('labels only the times of a selected drawing', () => {
    expect(regressionTrend.axisLabels!([a, b], {}, true)).toEqual({ time: [120, 300] });
    expect(regressionTrend.axisLabels!([a, b], {}, false)).toEqual({});
  });
});
