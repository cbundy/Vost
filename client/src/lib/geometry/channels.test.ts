import { describe, expect, it } from 'vitest';
import {
  disjointEdge,
  extendAcross,
  flatEdge,
  lineYAt,
  parallelEdge,
  parallelOffset,
  pointInPolygon,
  regression,
  regressionAt,
  sourceValue,
  SOURCES,
} from './channels';

const bar = (time: number, close: number, o = close, h = close, l = close) => ({ time, open: o, high: h, low: l, close });

describe('sourceValue', () => {
  const b = { time: 1, open: 10, high: 14, low: 8, close: 12 };
  it('reads each source', () => {
    expect(SOURCES.map((s) => sourceValue(b, s))).toEqual([12, 10, 14, 8, 11, (14 + 8 + 12) / 3, 11]);
  });
  it('falls back on the close', () => {
    expect(sourceValue(b, 'nope')).toBe(12);
  });
});

describe('regression', () => {
  // closes 1, 3, 2, 5, 4 on bars at t = 10..50: mean x 2, mean y 3, sxy = 8, sxx = 10
  const bars = [1, 3, 2, 5, 4].map((c, i) => bar((i + 1) * 10, c));
  it('fits slope, intercept and deviation by hand', () => {
    const r = regression(bars, 10, 50, 'close')!;
    expect(r.n).toBe(5);
    expect(r.firstIndex).toBe(0);
    expect(r.slope).toBeCloseTo(0.8, 12);
    expect(r.intercept).toBeCloseTo(3 - 0.8 * 2, 12);
    // fitted 1.4, 2.2, 3.0, 3.8, 4.6 -> residuals -0.4, 0.8, -1, 1.2, -0.6; sum of squares 3.6
    expect(r.stdev).toBeCloseTo(Math.sqrt(3.6 / 5), 12);
    expect(regressionAt(r, 4)).toBeCloseTo(4.6, 12);
  });
  it('uses the bars between the anchors, inclusive, in either order', () => {
    const r = regression(bars, 45, 20, 'close')!;
    expect(r.n).toBe(3);
    expect(r.firstIndex).toBe(1);
    expect(r.slope).toBeCloseTo(1, 12); // 3, 2, 5: sxy = 2, sxx = 2
    expect(regression(bars, 20, 45, 'close')).toEqual(r);
  });
  it('reads the chosen source', () => {
    const b = [bar(1, 0, 1, 5, 0), bar(2, 0, 2, 7, 0), bar(3, 0, 3, 9, 0)];
    expect(regression(b, 1, 3, 'open')!.slope).toBeCloseTo(1, 12);
    expect(regression(b, 1, 3, 'high')!.slope).toBeCloseTo(2, 12);
    expect(regression(b, 1, 3, 'high')!.stdev).toBeCloseTo(0, 12);
    expect(regression(b, 1, 3, 'close')!.slope).toBe(0);
  });
  it('is null with fewer than two bars in range or no bars', () => {
    expect(regression(bars, 11, 19, 'close')).toBeNull();
    expect(regression(bars, 10, 10, 'close')).toBeNull();
    expect(regression(bars, 10, 14, 'close')).toBeNull();
    expect(regression([bar(10, 1)], 0, 100, 'close')).toBeNull();
    expect(regression([], 0, 100, 'close')).toBeNull();
    expect(regression(bars, 100, 200, 'close')).toBeNull();
  });
  it('fits two bars exactly', () => {
    const r = regression(bars, 10, 20, 'close')!;
    expect(r.slope).toBe(2);
    expect(r.intercept).toBe(1);
    expect(r.stdev).toBe(0);
  });
});

describe('parallel channel', () => {
  const a = { x: 0, y: 100 };
  const b = { x: 100, y: 50 };
  it('reads the offset of the third point from the line', () => {
    expect(lineYAt(a, b, 50)).toBe(75);
    expect(parallelOffset(a, b, { x: 50, y: 95 })).toBe(20);
    expect(parallelOffset(a, b, { x: 50, y: 60 })).toBe(-15);
  });
  it('moves the edge vertically', () => {
    expect(parallelEdge(a, b, 20)).toEqual([{ x: 0, y: 120 }, { x: 100, y: 70 }]);
  });
  it('has a zero offset for a point on the line and copes with a vertical line', () => {
    expect(parallelOffset(a, b, { x: 20, y: 90 })).toBe(0);
    expect(parallelOffset({ x: 5, y: 10 }, { x: 5, y: 40 }, { x: 9, y: 25 })).toBe(15);
  });
});

describe('extendAcross', () => {
  it('continues a line to the pane edges, left to right', () => {
    expect(extendAcross({ x: 100, y: 50 }, { x: 200, y: 100 }, 400, true, true)).toEqual([{ x: 0, y: 0 }, { x: 400, y: 200 }]);
    expect(extendAcross({ x: 200, y: 100 }, { x: 100, y: 50 }, 400, false, true)).toEqual([{ x: 100, y: 50 }, { x: 400, y: 200 }]);
  });
  it('keeps an end already past the edge and a vertical line', () => {
    expect(extendAcross({ x: -10, y: 0 }, { x: 500, y: 10 }, 400, true, true)).toEqual([{ x: -10, y: 0 }, { x: 500, y: 10 }]);
    expect(extendAcross({ x: 5, y: 0 }, { x: 5, y: 10 }, 400, true, true)).toEqual([{ x: 5, y: 0 }, { x: 5, y: 10 }]);
  });
});

describe('flat and disjoint edges', () => {
  const a = { x: 10, y: 80 };
  const b = { x: 110, y: 30 };
  it('the flat edge runs under the sloped one at the third price', () => {
    expect(flatEdge(a, b, { x: 60, y: 120 })).toEqual([{ x: 10, y: 120 }, { x: 110, y: 120 }]);
  });
  it('the disjoint edge starts at the third point and mirrors the rise', () => {
    expect(disjointEdge(a, b, { x: 20, y: 150 })).toEqual([{ x: 20, y: 150 }, { x: 120, y: 200 }]);
  });
  it('equal anchors give degenerate edges, not errors', () => {
    expect(flatEdge(a, a, a)).toEqual([a, a]);
    expect(disjointEdge(a, a, a)).toEqual([a, a]);
    expect(parallelEdge(a, a, 0)).toEqual([a, a]);
  });
});

describe('pointInPolygon', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it('tells inside from outside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 5 }, [])).toBe(false);
  });
});
