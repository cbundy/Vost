import { describe, expect, it } from 'vitest';
import { simplify, smoothPath, strokeHit, thinToCap } from './freehand';

const circle = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 200 + 100 * Math.cos((i / n) * Math.PI * 2), y: 200 + 100 * Math.sin((i / n) * Math.PI * 2) }));
const distSeg = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

describe('freehand maths', () => {
  it('thins a dense circle under the cap, within the final tolerance of every sample', () => {
    const pts = circle(2000);
    const out = thinToCap(pts, 200, 1);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    // The result is an RDP of the input at some tolerance; every sample stays within a few px of it.
    for (const p of pts) {
      const d = Math.min(...out.slice(1).map((b, i) => distSeg(p, out[i], b)));
      expect(d).toBeLessThan(3);
    }
  });
  it('thins a straight line to its ends', () => {
    const line = Array.from({ length: 500 }, (_, i) => ({ x: i, y: i * 0.5 }));
    expect(simplify(line, 1)).toEqual([line[0], line[499]]);
  });
  it('passes 0, 1 and 2 points through', () => {
    expect(simplify([], 1)).toEqual([]);
    expect(simplify([{ x: 1, y: 1 }], 1)).toEqual([{ x: 1, y: 1 }]);
    const two = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    expect(simplify(two, 1)).toEqual(two);
    expect(thinToCap(two, 200, 1)).toEqual(two);
  });
  it('handles a very long stroke without overflowing', () => {
    const pts = Array.from({ length: 20000 }, (_, i) => ({ x: i, y: Math.sin(i / 3) * 50 }));
    expect(thinToCap(pts, 200, 1).length).toBeLessThanOrEqual(200);
  });
  it('smoothPath keeps ends, returns the input at 0 and survives short input', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 10 }];
    expect(smoothPath(pts, 0)).toEqual(pts);
    for (const s of [1, 5, 20]) {
      const out = smoothPath(pts, s);
      expect(out[0]).toEqual(pts[0]);
      expect(out[out.length - 1]).toEqual(pts[3]);
      expect(out.length).toBeGreaterThan(pts.length);
    }
    expect(smoothPath([], 20)).toEqual([]);
    expect(smoothPath([pts[0]], 20)).toEqual([pts[0]]);
    expect(smoothPath(pts.slice(0, 2), 20)).toEqual(pts.slice(0, 2));
  });
  it('strokeHit reaches halfWidth plus tolerance and no further', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(strokeHit(pts, { x: 50, y: 0 }, 10, 6)).toBe(true);
    expect(strokeHit(pts, { x: 50, y: 16 }, 10, 6)).toBe(true);
    expect(strokeHit(pts, { x: 50, y: 16.5 }, 10, 6)).toBe(false);
  });
});
