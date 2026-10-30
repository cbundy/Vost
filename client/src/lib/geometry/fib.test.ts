import { describe, expect, it } from 'vitest';
import {
  FIB_LEVELS,
  FIB_TIME_ZONE_LEVELS,
  GOLDEN,
  arcRadius,
  circleRadius,
  distToArc,
  distToCircle,
  distToSpiral,
  fanValue,
  fibLevelPrices,
  fibSequence,
  fibTimeLogical,
  fibTimeX,
  onArcSide,
  spiralPoints,
} from './fib';

describe('fibLevelPrices with custom and reversed levels', () => {
  it('prices a custom level list', () => {
    expect(fibLevelPrices(200, 100, [0, 0.5, 1, 1.618])).toEqual([100, 150, 200, 261.8]);
    expect(fibLevelPrices(200, 100, [])).toEqual([]);
    expect(fibLevelPrices(200, 100)).toEqual(fibLevelPrices(200, 100, FIB_LEVELS, false));
  });
  it('measures a reversed list from the start anchor', () => {
    expect(fibLevelPrices(200, 100, [0, 0.5, 1], true)).toEqual([200, 150, 100]);
    expect(fibLevelPrices(100, 300, [0, 0.25, 1], true)).toEqual([100, 150, 300]);
  });
  it('puts 0 at the end, 1 at the start and 0.5 at the midpoint, up and down', () => {
    for (const [start, end] of [[100, 200], [200, 100]]) {
      const p = fibLevelPrices(start, end);
      expect(p).toHaveLength(FIB_LEVELS.length);
      expect(p[0]).toBe(end);
      expect(p[p.length - 1]).toBe(start);
      expect(p[FIB_LEVELS.indexOf(0.5)]).toBe(150);
    }
  });
});

describe('time zone', () => {
  it('counts bars by the Fibonacci sequence', () => {
    expect(fibSequence(11)).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
    expect(fibSequence(11)).toEqual([...FIB_TIME_ZONE_LEVELS]);
    expect(fibSequence(0)).toEqual([]);
    expect(fibSequence(2)).toEqual([0, 1]);
  });
  it('places level n n units from the first point', () => {
    expect(fibTimeX(100, 110, 0)).toBe(100);
    expect(fibTimeX(100, 110, 5)).toBe(150);
    expect(fibTimeX(100, 90, 3)).toBe(70);
    expect(fibTimeX(100, 100, 8)).toBe(100);
    expect(fibTimeLogical(10, 12, 13)).toBe(36);
  });
});

describe('fan', () => {
  it('runs from the first corner to the second', () => {
    expect(fanValue(100, 200, 0)).toBe(100);
    expect(fanValue(100, 200, 0.5)).toBe(150);
    expect(fanValue(100, 200, 1)).toBe(200);
    expect(fanValue(100, 200, 0.25, true)).toBe(175);
  });
});

describe('circles and arcs', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 6, y: 8 };
  it('sizes a circle by half the distance and an arc by the distance', () => {
    expect(circleRadius(a, b, 1)).toBe(5);
    expect(circleRadius(a, b, 0.5)).toBe(2.5);
    expect(arcRadius(a, b, 1)).toBe(10);
    expect(arcRadius(a, b, 1.618)).toBeCloseTo(16.18);
    expect(circleRadius(a, a, 2)).toBe(0);
  });
  it('measures the distance to a circle', () => {
    expect(distToCircle({ x: 5, y: 0 }, a, 5)).toBe(0);
    expect(distToCircle({ x: 0, y: 7 }, a, 5)).toBe(2);
    expect(distToCircle({ x: 0, y: 1 }, a, 5)).toBe(4);
  });
  it('measures the distance to a half circle, by its ends past them', () => {
    const dir = { x: 1, y: 0 };
    expect(distToArc({ x: 5, y: 0 }, a, 5, dir)).toBe(0);
    expect(distToArc({ x: -5, y: 0 }, a, 5, dir)).toBeCloseTo(Math.hypot(5, 5));
    expect(distToArc({ x: 0, y: 5 }, a, 5, dir)).toBe(0);
    expect(distToArc({ x: -5, y: 0 }, a, 5, dir, true)).toBe(0);
    expect(distToArc({ x: -5, y: 0 }, a, 5, { x: 0, y: 0 })).toBe(0);
  });
  it('says which side of the centre the half is on', () => {
    expect(onArcSide({ x: 1, y: 3 }, a, { x: 1, y: 0 })).toBe(true);
    expect(onArcSide({ x: -1, y: 3 }, a, { x: 1, y: 0 })).toBe(false);
    expect(onArcSide({ x: -1, y: 3 }, a, { x: 1, y: 0 }, true)).toBe(true);
  });
});

describe('spiral', () => {
  const c = { x: 100, y: 100 };
  it('passes through the second point', () => {
    const through = { x: 140, y: 100 };
    const pts = spiralPoints(c, through, false, 500);
    expect(Math.min(...pts.map((p) => Math.hypot(p.x - through.x, p.y - through.y)))).toBeLessThan(1e-6);
  });
  it('grows by the golden ratio each quarter turn', () => {
    const through = { x: 140, y: 100 };
    const pts = spiralPoints(c, through, false, 500);
    const i = pts.findIndex((p) => Math.hypot(p.x - through.x, p.y - through.y) < 1e-6);
    const r = (p: { x: number; y: number }) => Math.hypot(p.x - c.x, p.y - c.y);
    // 18 steps of 5 degrees are a quarter turn
    expect(r(pts[i + 18]) / r(pts[i])).toBeCloseTo(GOLDEN, 3);
    expect(r(pts[i + 36]) / r(pts[i])).toBeCloseTo(GOLDEN * GOLDEN, 3);
  });
  it('turns clockwise on screen, or counter-clockwise when asked', () => {
    const through = { x: 140, y: 100 };
    const cw = spiralPoints(c, through, false, 500);
    const ccw = spiralPoints(c, through, true, 500);
    const next = (pts: { x: number; y: number }[]) => pts[pts.findIndex((p) => Math.abs(p.x - 140) < 1e-6 && Math.abs(p.y - 100) < 1e-6) + 1];
    expect(next(cw).y).toBeGreaterThan(100);
    expect(next(ccw).y).toBeLessThan(100);
  });
  it('reaches the maximum radius and is empty for equal points', () => {
    const pts = spiralPoints(c, { x: 140, y: 100 }, false, 500);
    const last = pts[pts.length - 1];
    expect(Math.hypot(last.x - c.x, last.y - c.y)).toBeGreaterThanOrEqual(500 - 1e-6);
    expect(spiralPoints(c, c, false, 500)).toEqual([]);
    expect(spiralPoints(c, { x: 1, y: 1 }, false, NaN)).toEqual([]);
  });
  it('measures the distance to the curve', () => {
    const through = { x: 140, y: 100 };
    expect(distToSpiral(through, c, through, false)).toBeLessThan(1e-6);
    expect(distToSpiral({ x: 100, y: 100 }, c, through, false)).toBeGreaterThan(0.4);
    expect(distToSpiral(c, c, c, false)).toBe(Infinity);
  });
});
