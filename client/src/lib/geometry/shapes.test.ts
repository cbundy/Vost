import { describe, expect, it } from 'vitest';
import { MARK, arrowMarkLabelRect, arrowMarkOutline, arrowMarkerLabelRect, arrowMarkerOutline, circleHit, circleRadius, inRect, pointInPolygon, polylineHit } from './shapes';

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
