import { describe, expect, it } from 'vitest';
import { clipSegment, headAndShouldersShape, lineIntersection, necklineEnds, triangleApex, triangleShape } from './patternShapes';

const P = (x: number, y: number) => ({ x, y });

describe('necklineEnds', () => {
  it('ends a horizontal neckline where it crosses the outer legs', () => {
    const e = necklineEnds(P(0, 250), P(80, 100), P(140, 180), P(260, 180), P(320, 100), P(400, 250));
    expect(e.left.y).toBeCloseTo(180);
    expect(e.left.x).toBeCloseTo(80 * (70 / 150));
    expect(e.right.x).toBeCloseTo(400 - 80 * (70 / 150));
    expect(e.right.y).toBeCloseTo(180);
  });
  it('follows a sloped neckline', () => {
    const e = necklineEnds(P(0, 250), P(80, 100), P(140, 180), P(260, 160), P(320, 100), P(400, 250));
    expect(e.left.y).toBeGreaterThan(e.right.y - 1e-9 - 100);
    expect(e.left.x).toBeGreaterThan(0);
    expect(e.right.x).toBeLessThan(400);
  });
  it('falls back to the outer points x when a leg does not cross it', () => {
    const e = necklineEnds(P(0, 100), P(80, 50), P(140, 180), P(260, 180), P(320, 50), P(400, 100));
    expect(e.left).toEqual(P(0, 180));
    expect(e.right).toEqual(P(400, 180));
  });
  it('never gives NaN for a vertical neckline', () => {
    const e = necklineEnds(P(0, 0), P(10, 0), P(50, 0), P(50, 100), P(90, 0), P(100, 0));
    expect([e.left.x, e.left.y, e.right.x, e.right.y].every(Number.isFinite)).toBe(true);
  });
});

describe('headAndShouldersShape', () => {
  const pts = [P(10, 250), P(80, 120), P(140, 180), P(200, 60), P(260, 180), P(320, 120), P(390, 250)];
  it('draws the neckline from P4 and the fills as their points exist', () => {
    expect(headAndShouldersShape(pts.slice(0, 4), 400, 300)).toEqual({ lines: [], fills: [] });
    expect(headAndShouldersShape(pts.slice(0, 5), 400, 300).lines).toHaveLength(1);
    expect(headAndShouldersShape(pts.slice(0, 5), 400, 300).fills).toHaveLength(2);
    expect(headAndShouldersShape(pts, 400, 300).fills).toHaveLength(3);
  });
  it('clips the neckline to the pane', () => {
    const [a, b] = headAndShouldersShape(pts, 200, 300).lines[0];
    expect(Math.max(a.x, b.x)).toBeLessThanOrEqual(200);
  });
  it('gives nothing for equal neck points', () => {
    expect(headAndShouldersShape(pts.map(() => P(1, 1)), 400, 300)).toEqual({ lines: [], fills: [] });
  });
});

describe('clipSegment', () => {
  it('clips and drops', () => {
    expect(clipSegment(P(-10, 5), P(110, 5), 100, 50)).toEqual([P(0, 5), P(100, 5)]);
    expect(clipSegment(P(-10, 60), P(110, 60), 100, 50)).toBeNull();
  });
});

describe('the triangle', () => {
  const A = P(0, 0);
  const B = P(0, 100);
  const C = P(100, 20);
  const D = P(110, 80);
  it('finds the apex of converging lines inside the pane', () => {
    const q = triangleApex(A, B, C, D, 1000, 1000)!;
    expect(q.x).toBeGreaterThan(110);
    expect(q.y).toBeCloseTo(q.x * 0.2);
    expect(triangleShape([A, B, C, D], 1000, 1000).fills[0]).toHaveLength(3);
  });
  it('has no apex for parallel lines, a left apex or one outside the pane, and falls back to the quadrilateral', () => {
    expect(triangleApex(A, P(0, 100), P(100, 0), P(100, 100), 1000, 1000)).toBeNull();
    expect(triangleApex(A, B, P(100, 80), P(110, 20), 1000, 1000)).toBeNull();
    expect(triangleApex(A, B, C, D, 120, 1000)).toBeNull();
    const s = triangleShape([A, B, C, D], 120, 1000);
    expect(s.lines).toEqual([[A, C], [B, D]]);
    expect(s.fills).toEqual([[A, C, D, B]]);
  });
  it('never divides by zero for equal points', () => {
    expect(lineIntersection(A, A, B, B)).toBeNull();
    expect(triangleShape([A, A, A, A], 100, 100).fills).toEqual([[A, A, A, A]]);
  });
  it('draws only the lines whose points exist', () => {
    expect(triangleShape([A, B], 100, 100)).toEqual({ lines: [], fills: [] });
    expect(triangleShape([A, B, C], 100, 100).lines).toEqual([[A, C]]);
  });
});
