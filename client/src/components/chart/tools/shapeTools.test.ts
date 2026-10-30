import { describe, expect, it } from 'vitest';
import { smoothPath } from '../../../lib/geometry/freehand';
import { resolveStyle } from '../../../lib/drawingStyle';
import { arrow } from './arrow';
import { arrowMarkDown, arrowMarkUp } from './arrowMark';
import { arrowMarker } from './arrowMarker';
import { circle } from './circle';
import { brush, highlighter } from './brush';
import { arc } from './arc';
import { curve, doubleCurve } from './curve';
import { ellipse } from './ellipse';
import { path, polyline } from './path';
import { rotatedRectangle } from './rotatedRectangle';
import { triangle } from './triangle';
import { startDraft, releaseDraft } from '../../../lib/drawingDraft';
import { anchorRange } from '../../../lib/drawings';
import { sideDistance } from '../../../lib/geometry/shapes';
import { CAPTION_TOOLS, TOOLS } from './index';
import type { DrawingTool, ToolView } from './types';

function view(tool: DrawingTool, text = '', style: Record<string, unknown> = {}): ToolView {
  return {
    width: 400,
    height: 300,
    anchors: [],
    text,
    times: [],
    candles: [],
    priceToY: () => null,
    formatPrice: String,
    style: { ...resolveStyle(tool.settings ?? [], undefined, undefined).values, ...style },
    styled: false,
  };
}
const tabsOf = (t: DrawingTool) => new Set((t.settings ?? []).map((f) => f.tab));

describe('registry', () => {
  it('lists the new tools after Rectangle in the Shapes family', () => {
    const shapes = TOOLS.filter((t) => t.group === 'shapes').map((t) => t.id);
    expect(shapes).toEqual(['brush', 'highlighter', 'rectangle', 'circle', 'arrow', 'arrowMarker', 'arrowMarkUp', 'arrowMarkDown', 'path', 'polyline', 'rotatedRectangle', 'ellipse', 'triangle', 'arc', 'curve', 'doubleCurve']);
    expect([...CAPTION_TOOLS].sort()).toEqual(['arrowMarkDown', 'arrowMarkUp', 'arrowMarker']);
    expect(TOOLS.filter((t) => t.barTime).map((t) => t.id)).toEqual(['arrowMarkUp', 'arrowMarkDown']);
  });
});

describe('circle', () => {
  const pts = [{ x: 100, y: 100 }, { x: 150, y: 100 }];
  it('is hit on its border and, with a fill, inside', () => {
    const v = view(circle);
    expect(circle.hit(pts, { x: 100, y: 52 }, v)).toBe(true);
    expect(circle.hit(pts, { x: 100, y: 100 }, v)).toBe(true);
    expect(circle.hit(pts, { x: 100, y: 30 }, v)).toBe(false);
    const bare = view(circle, '', { fillOpacity: 0 });
    expect(circle.hit(pts, { x: 100, y: 100 }, bare)).toBe(false);
    expect(circle.hit(pts, { x: 100, y: 52 }, bare)).toBe(true);
  });
  it('has handles at the centre and the edge point', () => {
    expect(circle.handles(pts, view(circle))).toEqual(pts);
  });
  it('moves with the centre handle and resizes with the edge handle', () => {
    expect(circle.dragHandle!(pts, 0, { x: 120, y: 130 })).toEqual([{ x: 120, y: 130 }, { x: 170, y: 130 }]);
    expect(circle.dragHandle!(pts, 1, { x: 100, y: 160 })).toEqual([pts[0], { x: 100, y: 160 }]);
  });
  it('has the rectangle border and fill settings and no text', () => {
    expect((circle.settings ?? []).map((f) => f.key)).toEqual(['color', 'width', 'lineStyle', 'fillColor', 'fillOpacity']);
    expect(circle.caption).toBeUndefined();
  });
});

describe('arrow', () => {
  const pts = [{ x: 100, y: 200 }, { x: 200, y: 100 }];
  it('turns the arrow head at the end on', () => {
    const s = view(arrow).style;
    expect([s.arrowStart, s.arrowEnd]).toEqual([false, true]);
  });
  it('is hit on its line only and has handles at both ends', () => {
    expect(arrow.hit(pts, { x: 150, y: 150 }, view(arrow))).toBe(true);
    expect(arrow.hit(pts, { x: 150, y: 170 }, view(arrow))).toBe(false);
    expect(arrow.handles(pts, view(arrow))).toEqual(pts);
  });
  it('shows axis labels while selected', () => {
    const a = [{ time: 1, price: 2 }, { time: 3, price: 4 }];
    expect(arrow.axisLabels!(a, {}, true)).toEqual({ price: [2, 4], time: [1, 3] });
    expect(arrow.axisLabels!(a, {}, false)).toEqual({});
  });
});

describe('arrow marker', () => {
  const pts = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  it('is hit on the shape and on its label, not a little away', () => {
    expect(arrowMarker.hit(pts, { x: 150, y: 100 }, view(arrowMarker))).toBe(true);
    expect(arrowMarker.hit(pts, { x: 150, y: 120 }, view(arrowMarker))).toBe(false);
    expect(arrowMarker.hit(pts, { x: 60, y: 100 }, view(arrowMarker))).toBe(false);
    expect(arrowMarker.hit(pts, { x: 60, y: 100 }, view(arrowMarker, 'target'))).toBe(true);
  });
  it('has handles at both ends and a Text tab', () => {
    expect(arrowMarker.handles(pts, view(arrowMarker))).toEqual(pts);
    expect(tabsOf(arrowMarker).has('text')).toBe(true);
    expect((arrowMarker.settings ?? []).filter((f) => f.tab === 'text').map((f) => f.key)).toEqual(['textColor', 'textSize', 'bold', 'italic']);
    expect(arrowMarker.caption).toBe(true);
  });
  it('draws nothing and throws nothing for equal anchors', () => {
    const same = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
    expect(arrowMarker.hit(same, { x: 5, y: 5 }, view(arrowMarker, 'x'))).toBe(false);
  });
});

describe('arrow marks', () => {
  const tip = [{ x: 100, y: 100 }];
  it('are one anchor on a bar time with a Text tab', () => {
    for (const t of [arrowMarkUp, arrowMarkDown]) {
      expect(t.anchors).toBe(1);
      expect(t.barTime).toBe(true);
      expect(t.caption).toBe(true);
      expect(tabsOf(t).has('text')).toBe(true);
      expect(t.handles(tip, view(t))).toEqual(tip);
    }
  });
  it('up sits below the point, down above it', () => {
    expect(arrowMarkUp.hit(tip, { x: 100, y: 115 }, view(arrowMarkUp))).toBe(true);
    expect(arrowMarkUp.hit(tip, { x: 100, y: 85 }, view(arrowMarkUp))).toBe(false);
    expect(arrowMarkDown.hit(tip, { x: 100, y: 85 }, view(arrowMarkDown))).toBe(true);
    expect(arrowMarkDown.hit(tip, { x: 100, y: 115 }, view(arrowMarkDown))).toBe(false);
  });
  it('are hit on their label beyond the tail', () => {
    expect(arrowMarkUp.hit(tip, { x: 100, y: 135 }, view(arrowMarkUp))).toBe(false);
    expect(arrowMarkUp.hit(tip, { x: 100, y: 135 }, view(arrowMarkUp, 'buy'))).toBe(true);
    expect(arrowMarkDown.hit(tip, { x: 100, y: 65 }, view(arrowMarkDown, 'sell'))).toBe(true);
  });
});

describe('path and polyline', () => {
  const pts = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }];
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as CanvasRenderingContext2D;
  it('take a range of points', () => {
    expect(path.anchors).toEqual({ min: 2, max: 100 });
    expect(polyline.anchors).toEqual({ min: 3, max: 100 });
  });
  it('have a handle on every point and move only the dragged one', () => {
    for (const t of [path, polyline]) {
      expect(t.handles(pts, view(t))).toEqual(pts);
      expect(t.dragHandle).toBeUndefined();
    }
  });
  it('hit on every segment and not a little away', () => {
    expect(path.hit(pts, { x: 150, y: 101 }, view(path))).toBe(true);
    expect(path.hit(pts, { x: 201, y: 150 }, view(path))).toBe(true);
    expect(path.hit(pts, { x: 150, y: 120 }, view(path))).toBe(false);
    expect(path.hit(pts, { x: 99, y: 150 }, view(path))).toBe(false);
  });
  it('closes the polyline: its last segment and, with a fill, inside', () => {
    expect(polyline.hit(pts, { x: 99, y: 150 }, view(polyline))).toBe(true);
    expect(polyline.hit(pts, { x: 150, y: 150 }, view(polyline))).toBe(true);
    expect(polyline.hit(pts, { x: 150, y: 150 }, view(polyline, '', { fillOpacity: 0 }))).toBe(false);
    expect(polyline.hit(pts, { x: 300, y: 150 }, view(polyline))).toBe(false);
  });
  it('draw one, two or repeated points without throwing', () => {
    for (const t of [path, polyline]) {
      for (const p of [[], pts.slice(0, 1), pts.slice(0, 2), [pts[0], pts[0], pts[0]], pts]) {
        expect(() => t.draw(ctx, p, view(t), { selected: true })).not.toThrow();
      }
    }
  });
  it('have TradingView defaults: no arrows; a translucent fill', () => {
    const s = view(path).style;
    expect([s.arrowStart, s.arrowEnd]).toEqual([false, false]);
    expect((view(polyline).style.fillOpacity as number) > 0).toBe(true);
    expect((polyline.settings ?? []).map((f) => f.key)).toEqual(['color', 'width', 'lineStyle', 'fillColor', 'fillOpacity']);
  });
  it('label every price and the first and last time while selected', () => {
    const a = [1, 2, 3].map((n) => ({ time: n, price: n * 10 }));
    expect(path.axisLabels!(a, {}, true)).toEqual({ price: [10, 20, 30], time: [1, 3] });
    expect(polyline.axisLabels!(a, {}, false)).toEqual({});
  });
});

describe('brush and highlighter', () => {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as CanvasRenderingContext2D;
  const line = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  const ring = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }, { x: 102, y: 102 }];
  const wave = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i * 2, y: 100 + Math.sin(i / 4) * 30 }));
  it('are freehand tools in a Brushes section with no handles', () => {
    for (const t of [brush, highlighter]) {
      expect(t.freehand).toBe(true);
      expect(t.section).toBe('Brushes');
      expect(t.anchors).toEqual({ min: 2, max: 200 });
      expect(t.handles(line, view(t))).toEqual([]);
    }
  });
  it('hit on the stroke and across its half width, not past it', () => {
    expect(brush.hit(line, { x: 150, y: 100 }, view(brush))).toBe(true);
    expect(brush.hit(line, { x: 150, y: 100 + 1 + 6 }, view(brush))).toBe(true);
    expect(brush.hit(line, { x: 150, y: 110 }, view(brush))).toBe(false);
    expect(highlighter.hit(line, { x: 150, y: 114 }, view(highlighter))).toBe(true);
    expect(highlighter.hit(line, { x: 150, y: 130 }, view(highlighter))).toBe(false);
  });
  it('hit inside a closed brush only with the fill on', () => {
    expect(brush.hit(ring, { x: 150, y: 150 }, view(brush))).toBe(false);
    expect(brush.hit(ring, { x: 150, y: 150 }, view(brush, '', { fill: true }))).toBe(true);
    const open = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }];
    expect(brush.hit(open, { x: 150, y: 150 }, view(brush, '', { fill: true }))).toBe(false);
  });
  it('hits the smoothed curve it draws, not the raw corner', () => {
    const peak = [{ x: 100, y: 100 }, { x: 160, y: 220 }, { x: 220, y: 100 }];
    for (const smoothing of [5, 20]) {
      const curve = smoothPath(peak, smoothing);
      for (let i = 0; i < curve.length - 1; i++) {
        const m = { x: (curve[i].x + curve[i + 1].x) / 2, y: (curve[i].y + curve[i + 1].y) / 2 };
        expect(brush.hit(peak, m, view(brush, '', { smoothing }))).toBe(true);
      }
    }
    const tip = { x: 160, y: 218 };
    expect(brush.hit(peak, tip, view(brush, '', { smoothing: 20 }))).toBe(false);
  });
  it('draw without throwing for any point count and smoothing', () => {
    for (const t of [brush, highlighter]) {
      for (const pts of [[], [line[0]], line, wave(200)]) {
        for (const smoothing of [0, 5, 20]) {
          expect(() => t.draw(ctx, pts, view(t, '', { smoothing, fill: true }), { selected: false })).not.toThrow();
          expect(() => t.draw(ctx, pts, view(t, '', { smoothing }), { selected: true })).not.toThrow();
        }
      }
    }
  });
  it('have the declared defaults', () => {
    expect(view(brush).style).toMatchObject({ width: 2, smoothing: 5, fill: false, fillOpacity: 0.2, opacity: 1 });
    expect(view(highlighter).style).toMatchObject({ color: '#ffeb3b', opacity: 0.35, width: 20 });
  });
});

const pt = (x: number, y: number) => ({ x, y });
const stub = new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as CanvasRenderingContext2D;
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

describe('rotated rectangle', () => {
  // Side (100,100)-(200,100); width 50 downwards (y grows).
  const pts = [pt(100, 100), pt(200, 100), pt(150, 150)];
  it('has five handles: the side ends and the middles of the other three sides', () => {
    const h = rotatedRectangle.handles(pts, view(rotatedRectangle));
    expect(h).toHaveLength(5);
    const want = [pt(100, 100), pt(200, 100), pt(200, 125), pt(150, 150), pt(100, 125)];
    // The normal of a left-to-right side points to +y, so the width side is below.
    h.forEach((q, i) => expect(near(q, want[i])).toBe(true));
  });
  it('is hit on its sides and, filled, inside; not a little away', () => {
    const v = view(rotatedRectangle);
    expect(rotatedRectangle.hit(pts, pt(150, 150), v)).toBe(true);
    expect(rotatedRectangle.hit(pts, pt(150, 125), v)).toBe(true);
    expect(rotatedRectangle.hit(pts, pt(150, 125), view(rotatedRectangle, '', { fillOpacity: 0 }))).toBe(false);
    expect(rotatedRectangle.hit(pts, pt(150, 165), v)).toBe(false);
    expect(rotatedRectangle.hit(pts, pt(150, 80), v)).toBe(false);
  });
  it('stays a rectangle with the same width after an end drag', () => {
    const [a, b, c] = rotatedRectangle.dragHandle!(pts, 1, pt(200, 60));
    const width = Math.abs(((c.x - a.x) * -(b.y - a.y) + (c.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y));
    expect(width).toBeCloseTo(50);
    expect(rotatedRectangle.dragHandle!(pts, 0, pt(100, 60))[1]).toEqual(pts[1]);
  });
  it('changes only the width when a middle handle is dragged', () => {
    const [a, b, c] = rotatedRectangle.dragHandle!(pts, 3, pt(150, 190));
    expect([a, b]).toEqual([pts[0], pts[1]]);
    expect(near(c, pt(100, 190))).toBe(true);
  });
  it('keeps the width on a zero drag of any width handle and follows the pointer', () => {
    const hs = rotatedRectangle.handles(pts, view(rotatedRectangle));
    for (const i of [2, 3, 4]) {
      const [a, b, c] = rotatedRectangle.dragHandle!(pts, i, hs[i]);
      expect([a, b]).toEqual([pts[0], pts[1]]);
      expect(Math.abs(sideDistance(a, b, c))).toBeCloseTo(Math.abs(sideDistance(pts[0], pts[1], pts[2])));
    }
    const moved = rotatedRectangle.dragHandle!(pts, 2, pt(hs[2].x, hs[2].y + 10));
    expect(near(moved[2], pt(100, 170))).toBe(true);
  });
  it('draws the first side with two points and throws nothing for equal or collinear points', () => {
    expect(() => rotatedRectangle.draw(stub, [pt(1, 1), pt(5, 5)], view(rotatedRectangle), { selected: false })).not.toThrow();
    for (const bad of [[pt(5, 5), pt(5, 5), pt(5, 5)], [pt(0, 0), pt(10, 0), pt(20, 0)]]) {
      expect(() => rotatedRectangle.draw(stub, bad, view(rotatedRectangle), { selected: true })).not.toThrow();
      expect(() => rotatedRectangle.dragHandle!(bad, 2, pt(3, 3))).not.toThrow();
      expect(rotatedRectangle.handles(bad, view(rotatedRectangle)).every((q) => Number.isFinite(q.x + q.y))).toBe(true);
    }
    expect(rotatedRectangle.hit([pt(0, 0), pt(10, 0), pt(20, 0)], pt(5, 1), view(rotatedRectangle))).toBe(true);
  });
});

describe('ellipse', () => {
  // Axis (100,100)-(200,100), other semi-axis 30.
  const pts = [pt(100, 100), pt(200, 100), pt(150, 130)];
  it('has handles at the four axis ends', () => {
    const h = ellipse.handles(pts, view(ellipse));
    [pt(100, 100), pt(200, 100), pt(150, 130), pt(150, 70)].forEach((q, i) => expect(near(h[i], q)).toBe(true));
  });
  it('is hit on its border and, filled, inside', () => {
    expect(ellipse.hit(pts, pt(150, 130), view(ellipse))).toBe(true);
    expect(ellipse.hit(pts, pt(150, 100), view(ellipse))).toBe(true);
    expect(ellipse.hit(pts, pt(150, 100), view(ellipse, '', { fillOpacity: 0 }))).toBe(false);
    expect(ellipse.hit(pts, pt(150, 150), view(ellipse))).toBe(false);
  });
  it('keeps the other semi-axis when an axis end is dragged', () => {
    const [a, b, c] = ellipse.dragHandle!(pts, 1, pt(100, 200));
    const d = Math.abs(((c.x - a.x) * -(b.y - a.y) + (c.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y));
    expect(d).toBeCloseTo(30);
  });
  it('is safe with two, equal and collinear points', () => {
    for (const bad of [[pt(1, 1), pt(9, 9)], [pt(5, 5), pt(5, 5), pt(5, 5)], [pt(0, 0), pt(10, 0), pt(20, 0)]]) {
      expect(() => ellipse.draw(stub, bad, view(ellipse), { selected: false })).not.toThrow();
      expect(() => ellipse.hit(bad, pt(3, 3), view(ellipse))).not.toThrow();
    }
  });
});

describe('triangle', () => {
  const pts = [pt(100, 100), pt(200, 100), pt(150, 200)];
  it('has a handle per vertex and moves only that vertex', () => {
    expect(triangle.handles(pts, view(triangle))).toEqual(pts);
    expect(triangle.dragHandle).toBeUndefined();
  });
  it('is hit on its edges and, filled, inside', () => {
    expect(triangle.hit(pts, pt(150, 101), view(triangle))).toBe(true);
    expect(triangle.hit(pts, pt(150, 130), view(triangle))).toBe(true);
    expect(triangle.hit(pts, pt(150, 130), view(triangle, '', { fillOpacity: 0 }))).toBe(false);
    expect(triangle.hit(pts, pt(100, 190), view(triangle))).toBe(false);
  });
  it('is safe with two and equal points', () => {
    expect(() => triangle.draw(stub, [pt(1, 1), pt(4, 4)], view(triangle), { selected: false })).not.toThrow();
    expect(() => triangle.draw(stub, [pt(1, 1), pt(1, 1), pt(1, 1)], view(triangle), { selected: false })).not.toThrow();
  });
});

describe('arc', () => {
  // Ends (100,100) and (200,100), bulge 40 below.
  const pts = [pt(100, 100), pt(200, 100), pt(150, 140)];
  it('has handles at the two ends and the top of the bulge', () => {
    const h = arc.handles(pts, view(arc));
    [pt(100, 100), pt(200, 100), pt(150, 140)].forEach((q, i) => expect(near(h[i], q)).toBe(true));
  });
  it('is hit on the arc only, and inside only when filled', () => {
    expect(arc.hit(pts, pt(150, 140), view(arc))).toBe(true);
    expect(arc.hit(pts, pt(150, 100), view(arc))).toBe(true);
    expect(arc.hit(pts, pt(150, 120), view(arc))).toBe(true);
    expect(arc.hit(pts, pt(150, 120), view(arc, '', { fillOpacity: 0 }))).toBe(false);
    expect(arc.hit(pts, pt(150, 60), view(arc))).toBe(false);
    expect(arc.hit(pts, pt(150, 160), view(arc))).toBe(false);
  });
  it('keeps the bulge when an end is dragged', () => {
    const [a, b, c] = arc.dragHandle!(pts, 0, pt(100, 60));
    const d = ((c.x - a.x) * -(b.y - a.y) + (c.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
    expect(d).toBeCloseTo(40);
  });
  it('is safe with two, equal and collinear points', () => {
    for (const bad of [[pt(1, 1), pt(9, 9)], [pt(5, 5), pt(5, 5), pt(5, 5)], [pt(0, 0), pt(10, 0), pt(20, 0)]]) {
      expect(() => arc.draw(stub, bad, view(arc), { selected: false })).not.toThrow();
      expect(() => arc.hit(bad, pt(3, 3), view(arc))).not.toThrow();
    }
  });
});

describe('curves', () => {
  it('are placed by two points and store the control points', () => {
    expect(anchorRange(curve.placed!).max).toBe(2);
    expect(curve.anchors).toBe(3);
    expect(doubleCurve.anchors).toBe(4);
    expect(curve.settle!([pt(0, 0), pt(100, 0)])).toHaveLength(3);
    expect(doubleCurve.settle!([pt(0, 0), pt(100, 0)])).toHaveLength(4);
    expect(curve.settle!([pt(0, 0), pt(100, 0)]).slice(0, 2)).toEqual([pt(0, 0), pt(100, 0)]);
  });
  it('start with a visible bend, and an S for the double curve', () => {
    const [, , c] = curve.settle!([pt(0, 0), pt(100, 0)]);
    expect(Math.abs(c.y)).toBeGreaterThan(10);
    const [, , c1, c2] = doubleCurve.settle!([pt(0, 0), pt(100, 0)]);
    expect(Math.sign(c1.y)).toBe(-Math.sign(c2.y));
  });
  it('finish their draft on the second placed point', () => {
    const d = startDraft('curve', { time: 1, price: 1 }, pt(0, 0));
    const step = releaseDraft({ ...d, anchors: [d.anchors[0], { time: 2, price: 2 }] }, pt(50, 0), curve.placed!);
    expect(step.done).toHaveLength(2);
    const click = releaseDraft(d, pt(0, 0), curve.placed!);
    expect(click.done).toBeNull();
  });
  it('have a handle on every point, move only the dragged one, and are hit on the curve', () => {
    const q = curve.settle!([pt(0, 100), pt(200, 100)]);
    expect(curve.handles(q, view(curve))).toEqual(q);
    expect(curve.dragHandle).toBeUndefined();
    // The curve's peak is half way to the control point.
    const mid = { x: 100, y: (100 + q[2].y) / 2 };
    expect(curve.hit(q, mid, view(curve))).toBe(true);
    expect(curve.hit(q, pt(100, 100), view(curve))).toBe(false);
    expect(curve.hit(q, pt(100, mid.y + 20), view(curve))).toBe(false);
  });
  it('draw a straight line with two points and throw nothing for equal points', () => {
    for (const t of [curve, doubleCurve]) {
      expect(() => t.draw(stub, [pt(1, 1), pt(9, 9)], view(t), { selected: false })).not.toThrow();
      const same = t.settle!([pt(5, 5), pt(5, 5)]);
      expect(() => t.draw(stub, same, view(t, '', { arrowStart: true, arrowEnd: true }), { selected: true })).not.toThrow();
      expect(() => t.hit(same, pt(5, 5), view(t))).not.toThrow();
      expect(t.hit(t.settle!([pt(0, 0), pt(100, 0)]), pt(50, 0), view(t))).toBe(t === doubleCurve);
    }
  });
  it('take the path line settings', () => {
    expect((curve.settings ?? []).map((f) => f.key)).toEqual(['color', 'opacity', 'width', 'lineStyle', 'arrowStart', 'arrowEnd']);
  });
});
