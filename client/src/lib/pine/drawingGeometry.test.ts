import { describe, expect, it } from 'vitest';
import { boxRect, boxTextLines, linefillPolygon, lineSpan, polylinePoints, wrapText } from './drawingGeometry';

const W = 400;
const H = 200;

describe('lineSpan', () => {
  const a = { x: 100, y: 100 };
  const b = { x: 200, y: 100 };
  it('keeps the ends without extend', () => {
    expect(lineSpan(a, b, 'none', W, H)).toEqual([a, b]);
  });
  it('extends to the right pane edge', () => {
    const [s, e] = lineSpan(a, b, 'r', W, H);
    expect(s).toEqual(a);
    expect(e.x).toBe(W);
  });
  it('extends to the left pane edge', () => {
    const [s, e] = lineSpan(a, b, 'l', W, H);
    expect(s.x).toBe(0);
    expect(e).toEqual(b);
  });
  it('extends both ways', () => {
    const [s, e] = lineSpan(a, b, 'b', W, H);
    expect([s.x, e.x]).toEqual([0, W]);
  });
});

describe('boxRect', () => {
  const a = { x: 150, y: 80 };
  const b = { x: 50, y: 20 };
  it('orders the corners', () => {
    expect(boxRect(a, b, 'none', W)).toEqual({ x0: 50, x1: 150, y0: 20, y1: 80 });
  });
  it('runs to the pane edge on an extended side', () => {
    expect(boxRect(a, b, 'l', W)).toMatchObject({ x0: 0, x1: 150 });
    expect(boxRect(a, b, 'r', W)).toMatchObject({ x0: 50, x1: W });
    expect(boxRect(a, b, 'b', W)).toMatchObject({ x0: 0, x1: W });
  });
});

describe('box text', () => {
  const measure = (s: string) => s.length * 10;
  const rect = { x0: 0, x1: 100, y0: 0, y1: 100 };
  it('wraps to the box width and keeps newlines', () => {
    expect(wrapText('aa bb cc dd', 49, measure)).toEqual(['aa', 'bb', 'cc', 'dd']);
    expect(wrapText('aa bb cc', 79, measure)).toEqual(['aa bb', 'cc']);
    expect(wrapText('aa bb\ncc', null, measure)).toEqual(['aa bb', 'cc']);
    expect(wrapText('longword', 20, measure)).toEqual(['longword']);
  });
  it('places each alignment', () => {
    const at = (h: 'left' | 'center' | 'right', v: 'top' | 'center' | 'bottom') => boxTextLines(rect, 'hi', 10, h, v, false, measure)[0];
    expect(at('left', 'top').x).toBe(4);
    expect(at('center', 'top').x).toBe(50);
    expect(at('right', 'top').x).toBe(96);
    const top = at('left', 'top').y;
    const mid = at('left', 'center').y;
    const bottom = at('left', 'bottom').y;
    expect(top).toBeLessThan(mid);
    expect(mid).toBe(50);
    expect(bottom).toBeGreaterThan(mid);
    expect(bottom).toBeLessThanOrEqual(96);
  });
  it('wraps only when asked', () => {
    const text = 'aaa bbb ccc ddd';
    expect(boxTextLines(rect, text, 10, 'left', 'top', false, measure)).toHaveLength(1);
    const wrapped = boxTextLines(rect, text, 10, 'left', 'top', true, measure);
    expect(wrapped.map((l) => l.text)).toEqual(['aaa bbb', 'ccc ddd']);
    expect(wrapped[1].y).toBeGreaterThan(wrapped[0].y);
  });
  it('has no lines for no text', () => {
    expect(boxTextLines(rect, '', 10, 'left', 'top', true, measure)).toEqual([]);
  });
});

describe('polylinePoints', () => {
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }, { x: 150, y: 30 }];
  it('keeps straight points', () => {
    expect(polylinePoints(pts, false, false)).toEqual(pts);
  });
  it('curves through every point', () => {
    const open = polylinePoints(pts, true, false);
    expect(open.length).toBeGreaterThan(pts.length);
    for (const p of pts) expect(open.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)).toBe(true);
    const closed = polylinePoints(pts, true, true);
    for (const p of pts) expect(closed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)).toBe(true);
    expect(closed[closed.length - 1]).toEqual(pts[0]);
  });
});

describe('linefillPolygon', () => {
  it('uses the extended spans', () => {
    const s1 = lineSpan({ x: 100, y: 20 }, { x: 200, y: 20 }, 'r', W, H);
    const s2 = lineSpan({ x: 100, y: 60 }, { x: 200, y: 60 }, 'none', W, H);
    const poly = linefillPolygon(s1, s2);
    expect(poly).toHaveLength(4);
    expect(poly[1].x).toBe(W);
    expect(poly[2].x).toBe(200);
  });
});
