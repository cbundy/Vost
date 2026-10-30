import { describe, expect, it } from 'vitest';
import { MAX_CYCLES, arcPoints, cycleArcs, cycleXs, sinePoints } from './cycles';

describe('cycleXs', () => {
  it('repeats a positive period both ways inside the pane', () => {
    expect(cycleXs(150, 100, 400, 0)).toEqual([50, 150, 250, 350]);
  });
  it('gives the same lines for a negative period', () => {
    expect(cycleXs(150, -100, 400, 0)).toEqual([50, 150, 250, 350]);
  });
  it('gives none for a zero or NaN period', () => {
    expect(cycleXs(10, 0, 400, 6)).toEqual([]);
    expect(cycleXs(10, NaN, 400, 6)).toEqual([]);
    expect(cycleXs(10, Infinity, 400, 6)).toEqual([]);
  });
  it('fills the pane from a point left or right of it', () => {
    expect(cycleXs(-250, 100, 300, 0)).toEqual([-250 + 300, -250 + 400, -250 + 500, -250 + 600].filter((x) => x <= 300));
    expect(cycleXs(1000, 200, 400, 0)).toEqual([0, 200, 400]);
  });
  it('keeps the margin', () => {
    expect(cycleXs(0, 100, 200, 6)).toEqual([0, 100, 200]);
    expect(cycleXs(-5, 100, 200, 6)).toEqual([-5, 95, 195]);
  });
  it('stays under the cap for a 1 pixel period on a huge pane', () => {
    expect(cycleXs(0, 1, 1e7, 6).length).toBe(MAX_CYCLES);
  });
});

describe('cycleArcs', () => {
  it('spans one period each, the first starting at the pane edge side', () => {
    const arcs = cycleArcs(100, 100, 300, 0);
    expect(arcs).toEqual([{ from: 0, to: 100 }, { from: 100, to: 200 }, { from: 200, to: 300 }, { from: 300, to: 400 }]);
  });
  it('is empty for a zero period and capped for a tiny one', () => {
    expect(cycleArcs(0, 0, 100, 6)).toEqual([]);
    expect(cycleArcs(0, 1, 1e7, 6).length).toBeLessThanOrEqual(MAX_CYCLES + 1);
  });
});

describe('arcPoints', () => {
  it('runs from the left end to the right end and peaks by the height', () => {
    const pts = arcPoints(0, 100, 50, -30, 32);
    expect(pts[0]).toMatchObject({ x: 0 });
    expect(pts[0].y).toBeCloseTo(50);
    expect(pts[32].x).toBeCloseTo(100);
    expect(pts[16].x).toBeCloseTo(50);
    expect(pts[16].y).toBeCloseTo(20);
  });
});

describe('sinePoints', () => {
  const p0 = { x: 100, y: 200 };
  const p1 = { x: 200, y: 100 };
  it('passes through both points and stays within the amplitude', () => {
    const pts = sinePoints(p0, p1, 600, 5);
    expect(pts.find((p) => p.x === 100)!.y).toBeCloseTo(200);
    expect(pts.find((p) => p.x === 200)!.y).toBeCloseTo(100);
    for (const p of pts) {
      expect(p.y).toBeGreaterThanOrEqual(100 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(200 + 1e-9);
    }
    expect(pts[0].x).toBe(0);
    expect(pts[pts.length - 1].x).toBe(600);
  });
  it('repeats with the full period (two half periods)', () => {
    const pts = sinePoints(p0, p1, 600, 5);
    expect(pts.find((p) => p.x === 300)!.y).toBeCloseTo(200);
  });
  it('is empty for a zero distance', () => {
    expect(sinePoints(p0, { x: 100, y: 50 }, 600, 5)).toEqual([]);
  });
});
