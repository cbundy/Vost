import { describe, expect, it } from 'vitest';
import { MARK, arrowMarkLabelRect, arrowMarkOutline, arrowMarkerLabelRect, arrowMarkerOutline, circleHit, circleRadius, inRect, pointInPolygon, polylineHit, arcPoints, cubicPoints, curvePoints, defaultCurveControl, ellipseFrom3, quadraticPoints, rotatedRectCorners, sideDistance } from './shapes';

describe('circle', () => {
  const c = { x: 100, y: 100 };
  const e = { x: 130, y: 140 };
  it('has the distance between the points as radius', () => {
    expect(circleRadius(c, e)).toBe(50);
    expect(circleRadius(c, c)).toBe(0);
  });
  it('hits on the border', () => {
    expect(circleHit(c, e, { x: 150, y: 100 }, false, 4)).toBe(true);
    expect(circleHit(c, e, { x: 100, y: 50 }, true, 4)).toBe(true);
  });
  it('hits inside only with a fill', () => {
    expect(circleHit(c, e, c, false, 4)).toBe(false);
    expect(circleHit(c, e, c, true, 4)).toBe(true);
  });
  it('misses a little outside', () => {
    expect(circleHit(c, e, { x: 160, y: 100 }, false, 4)).toBe(false);
    expect(circleHit(c, e, { x: 160, y: 100 }, true, 4)).toBe(false);
  });
});

describe('arrow marker outline', () => {
  it('is empty for equal anchors and never throws', () => {
    expect(arrowMarkerOutline({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual([]);
    expect(arrowMarkerLabelRect({ x: 5, y: 5 }, { x: 5, y: 5 }, 10, 10)).toBeNull();
    expect(pointInPolygon({ x: 5, y: 5 }, [])).toBe(false);
  });
  it('matches a hand-worked horizontal arrow of length 100', () => {
    // shaft 10 wide (half 5), head 25 wide (half 12.5) and 33.33 long
    const o = arrowMarkerOutline({ x: 0, y: 0 }, { x: 100, y: 0 });
    const third = 100 - 100 / 3;
    const want = [[0, -5], [third, -5], [third, -12.5], [100, 0], [third, 12.5], [third, 5], [0, 5]];
    expect(o).toHaveLength(7);
    o.forEach((q, i) => {
      expect(q.x).toBeCloseTo(want[i][0]);
      expect(Math.abs(q.y)).toBeCloseTo(Math.abs(want[i][1]));
    });
    expect(o[3]).toEqual({ x: 100, y: 0 });
  });
  it('clamps the sizes of a short and a long arrow', () => {
    const short = arrowMarkerOutline({ x: 0, y: 0 }, { x: 5, y: 0 });
    expect(Math.abs(short[1].y)).toBeCloseTo(1.5); // shaft at least 3 wide
    expect(short[1].x).toBeCloseTo(0); // head no longer than the arrow
    const long = arrowMarkerOutline({ x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(Math.abs(long[1].y)).toBeCloseTo(6); // shaft at most 12 wide
    expect(long[1].x).toBeCloseTo(960); // head at most 40 long
  });
  it('tests points in the polygon', () => {
    const o = arrowMarkerOutline({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(pointInPolygon({ x: 30, y: 0 }, o)).toBe(true);
    expect(pointInPolygon({ x: 30, y: 20 }, o)).toBe(false);
    expect(pointInPolygon({ x: 30, y: 7 }, o)).toBe(false);
    expect(pointInPolygon({ x: 30, y: 7 }, o, 3)).toBe(true);
  });
  it('puts the label beyond the tail', () => {
    const r = arrowMarkerLabelRect({ x: 0, y: 0 }, { x: 100, y: 0 }, 20, 10)!;
    expect(r.x + r.w).toBeLessThan(0);
    expect(r.y + r.h / 2).toBeCloseTo(0);
  });
});

describe('arrow mark', () => {
  const tip = { x: 50, y: 60 };
  it('points up from below the tip', () => {
    const o = arrowMarkOutline(tip, 'up');
    expect(o[0]).toEqual(tip);
    expect(Math.min(...o.map((q) => q.y))).toBe(60);
    expect(Math.max(...o.map((q) => q.y))).toBe(60 + MARK.LENGTH);
    expect(Math.max(...o.map((q) => q.x)) - Math.min(...o.map((q) => q.x))).toBe(MARK.HEAD_W);
  });
  it('points down from above the tip', () => {
    const o = arrowMarkOutline(tip, 'down');
    expect(o[0]).toEqual(tip);
    expect(Math.max(...o.map((q) => q.y))).toBe(60);
    expect(Math.min(...o.map((q) => q.y))).toBe(60 - MARK.LENGTH);
  });
  it('puts the label beyond the tail', () => {
    const up = arrowMarkLabelRect(tip, 'up', 30, 14);
    expect(up.y).toBeGreaterThan(60 + MARK.LENGTH);
    expect(up.x + up.w / 2).toBe(50);
    const down = arrowMarkLabelRect(tip, 'down', 30, 14);
    expect(down.y + down.h).toBeLessThan(60 - MARK.LENGTH);
  });
  it('tests a box', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(inRect(r, { x: 5, y: 5 })).toBe(true);
    expect(inRect(r, { x: 12, y: 5 })).toBe(false);
    expect(inRect(r, { x: 12, y: 5 }, 3)).toBe(true);
    expect(inRect(null, { x: 0, y: 0 })).toBe(false);
  });
});

describe('polyline hit', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  it('hits on each segment and misses a little away', () => {
    expect(polylineHit(pts, { x: 50, y: 2 }, false, 4)).toBe(true);
    expect(polylineHit(pts, { x: 98, y: 50 }, false, 4)).toBe(true);
    expect(polylineHit(pts, { x: 50, y: 10 }, false, 4)).toBe(false);
    expect(polylineHit(pts, { x: 106, y: 50 }, false, 4)).toBe(false);
  });
  it('hits the closing segment only when closed', () => {
    expect(polylineHit(pts, { x: 50, y: 52 }, false, 4)).toBe(false);
    expect(polylineHit(pts, { x: 50, y: 52 }, true, 4)).toBe(true);
  });
  it('is safe for no points, one point and repeated points', () => {
    expect(polylineHit([], { x: 0, y: 0 }, true, 4)).toBe(false);
    expect(polylineHit([{ x: 3, y: 3 }], { x: 4, y: 3 }, true, 4)).toBe(true);
    const same = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
    expect(polylineHit(same, { x: 5, y: 6 }, true, 4)).toBe(true);
    expect(polylineHit(same, { x: 50, y: 6 }, true, 4)).toBe(false);
  });
});

describe('rotated rectangle', () => {
  it('has the corners of a side and a width', () => {
    expect(rotatedRectCorners({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 5 })).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }]);
    const slanted = rotatedRectCorners({ x: 0, y: 0 }, { x: 3, y: 4 }, { x: -2, y: 5 });
    // Width: the signed distance of (-2, 5) from the line, along the normal (-0.8, 0.6): 1.6 + 3 = 4.6.
    expect(sideDistance({ x: 0, y: 0 }, { x: 3, y: 4 }, { x: -2, y: 5 })).toBeCloseTo(4.6);
    expect(slanted[2].x).toBeCloseTo(3 - 0.8 * 4.6);
    expect(slanted[2].y).toBeCloseTo(4 + 0.6 * 4.6);
  });
  it('is safe with equal and collinear points', () => {
    for (const c of [rotatedRectCorners({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }), rotatedRectCorners({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 9, y: 0 })]) {
      expect(c.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true);
    }
  });
});

describe('ellipse and arc', () => {
  it('finds the centre, semi-axes and rotation', () => {
    const e = ellipseFrom3({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 });
    expect(e).toEqual({ cx: 5, cy: 0, rx: 5, ry: 3, rot: 0 });
    const r = ellipseFrom3({ x: 0, y: 0 }, { x: 0, y: 8 }, { x: 2, y: 4 });
    expect(r.rot).toBeCloseTo(Math.PI / 2);
    expect(r.rx).toBe(4);
    expect(r.ry).toBeCloseTo(2);
  });
  it('is safe for equal points', () => {
    const e = ellipseFrom3({ x: 2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 2 });
    expect(Object.values(e).every(Number.isFinite)).toBe(true);
  });
  it('runs the arc from the first end to the second through the bulge on the third point side', () => {
    const pts = arcPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 }, 64);
    expect(pts[0].x).toBeCloseTo(0);
    expect(pts[64].x).toBeCloseTo(10);
    expect(pts[32].x).toBeCloseTo(5);
    expect(pts[32].y).toBeCloseTo(3);
    expect(arcPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -3 }, 64)[32].y).toBeCloseTo(-3);
    expect(arcPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }).every((q) => Number.isFinite(q.x + q.y))).toBe(true);
  });
});

describe('curves', () => {
  it('samples a quadratic Bezier by hand', () => {
    const q = quadraticPoints({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, 4);
    expect(q[0]).toEqual({ x: 0, y: 0 });
    expect(q[2]).toEqual({ x: 50, y: 50 });
    expect(q[4]).toEqual({ x: 100, y: 0 });
  });
  it('samples a cubic Bezier by hand', () => {
    const c = cubicPoints({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }, 2);
    expect(c[1]).toEqual({ x: 50, y: 75 });
    expect(c[2]).toEqual({ x: 100, y: 0 });
  });
  it('picks the curve by the points it is given', () => {
    const p = (x: number, y: number) => ({ x, y });
    expect(curvePoints([p(0, 0), p(1, 1)])).toEqual([p(0, 0), p(1, 1)]);
    expect(curvePoints([p(0, 0), p(10, 0), p(5, 5)])).toHaveLength(49);
    expect(curvePoints([p(0, 0), p(10, 0), p(2, 5), p(8, -5)])).toHaveLength(65);
    expect(curvePoints([])).toEqual([]);
  });
  it('bends a new curve to one side by a fixed fraction of its length', () => {
    const c = defaultCurveControl({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(c).toEqual({ x: 50, y: 30 });
    expect(defaultCurveControl({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({ x: 3, y: 3 });
  });
});
