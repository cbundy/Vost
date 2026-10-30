import { describe, expect, it } from 'vitest';
import { GANN_BOX_LEVELS, GANN_FAN_LEVELS, boxCoord, fanBands, fanEnd, farPoint, fixedSquareCorner, ratioLabel, squareArc } from './gann';

const A = { x: 100, y: 300 };
const B = { x: 200, y: 200 };

describe('gann maths', () => {
  it('lists the default levels', () => {
    expect(GANN_BOX_LEVELS).toEqual([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]);
    expect(GANN_FAN_LEVELS).toEqual([0.125, 0.25, 0.333, 0.5, 1, 2, 3, 4, 8]);
  });
  it('places box levels, reversed from the other side', () => {
    expect(boxCoord(100, 200, 0.25)).toBe(125);
    expect(boxCoord(100, 200, 0.25, true)).toBe(175);
    expect(boxCoord(300, 200, 0.5)).toBe(250);
  });
  it('labels fan ratios', () => {
    expect(GANN_FAN_LEVELS.map(ratioLabel)).toEqual(['1x8', '1x4', '1x3', '1x2', '1x1', '2x1', '3x1', '4x1', '8x1']);
  });
  it('ends 1x1 at point 2, 2x1 and 1x2 at half the box, 8x1 and 1x8 at an eighth', () => {
    expect(fanEnd(A, B, 1)).toEqual(B);
    expect(fanEnd(A, B, 2)).toEqual({ x: 150, y: 200 });
    expect(fanEnd(A, B, 0.5)).toEqual({ x: 200, y: 250 });
    expect(fanEnd(A, B, 8)).toEqual({ x: 112.5, y: 200 });
    expect(fanEnd(A, B, 0.125)).toEqual({ x: 200, y: 287.5 });
    expect(fanEnd(A, B, 0)).toBeNull();
    expect(fanEnd(A, B, NaN)).toBeNull();
  });
  it('extends a ray and refuses equal points', () => {
    expect(farPoint(A, B, 100 * Math.SQRT2)).toEqual({ x: expect.closeTo(200), y: expect.closeTo(200) });
    expect(farPoint(A, A, 100)).toBeNull();
    expect(fanEnd(A, A, 2)).toEqual(A);
  });
  it('holds the fixed square square, in the direction of point 2', () => {
    expect(fixedSquareCorner(A, { x: 150, y: 100 })).toEqual({ x: 300, y: 100 });
    expect(fixedSquareCorner(A, { x: 40, y: 290 })).toEqual({ x: 40, y: 240 });
    expect(fixedSquareCorner(A, A)).toEqual(A);
  });
  it('draws a quarter arc from the x axis to the y axis of the box', () => {
    const arc = squareArc(A, B, 0.5, 4);
    expect(arc).toHaveLength(5);
    expect(arc[0]).toEqual({ x: 150, y: 300 });
    expect(arc[4].x).toBeCloseTo(100);
    expect(arc[4].y).toBeCloseTo(250);
    expect(squareArc(A, A, 1).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
  it('bands neighbouring ends, through the corner where they straddle it', () => {
    const ends = [0.5, 1, 2].map((v) => ({ v, end: fanEnd(A, B, v)! }));
    const bands = fanBands(A, B, ends);
    expect(bands).toHaveLength(2);
    expect(fanBands(A, B, [{ v: 0.5, end: ends[0].end }, { v: 2, end: ends[2].end }])[0]).toHaveLength(4);
    expect(fanBands(A, B, [])).toEqual([]);
  });
});
