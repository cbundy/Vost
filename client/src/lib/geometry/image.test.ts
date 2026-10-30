import { describe, expect, it } from 'vitest';
import { boxFromCorners, dragCorner, fitToHalfPane, naturalEnd, ratioOf } from './image';

describe('fitToHalfPane', () => {
  it('keeps a small picture at its natural size and never upscales', () => {
    expect(fitToHalfPane(100, 50, 800, 600)).toEqual({ w: 100, h: 50 });
  });
  it('scales a big picture down to fit within half the pane, keeping the ratio', () => {
    const s = fitToHalfPane(2000, 1000, 800, 600);
    expect(s).toEqual({ w: 400, h: 200 });
    const tall = fitToHalfPane(1000, 2000, 800, 600);
    expect(tall).toEqual({ w: 150, h: 300 });
  });
  it('never returns a zero size', () => {
    expect(fitToHalfPane(1, 1, 0, 0)).toEqual({ w: 1, h: 1 });
    expect(fitToHalfPane(16384, 1, 10, 10)).toEqual({ w: 5, h: 1 });
  });
});

describe('boxFromCorners', () => {
  it('normalises two corners given in any order and is never smaller than a pixel', () => {
    expect(boxFromCorners({ x: 30, y: 40 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 20, h: 20 });
    expect(boxFromCorners({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, w: 1, h: 1 });
  });
});

describe('dragCorner', () => {
  const o = { x: 100, y: 100 };
  it('keeps the ratio from each of the four corners', () => {
    const ratio = 2;
    for (const q of [{ x: 200, y: 110 }, { x: 0, y: 110 }, { x: 0, y: 90 }, { x: 200, y: 90 }]) {
      const c = dragCorner(o, q, ratio, false);
      expect(Math.abs(c.x - o.x) / Math.abs(c.y - o.y)).toBeCloseTo(ratio);
      expect(Math.sign(c.x - o.x)).toBe(Math.sign(q.x - o.x));
      expect(Math.sign(c.y - o.y)).toBe(Math.sign(q.y - o.y));
    }
  });
  it('is as large as the pointer asks on the longer axis', () => {
    expect(dragCorner(o, { x: 110, y: 200 }, 2, false)).toEqual({ x: 300, y: 200 });
  });
  it('is the pointer itself when free, but never a zero-size box', () => {
    expect(dragCorner(o, { x: 150, y: 120 }, 2, true)).toEqual({ x: 150, y: 120 });
    expect(dragCorner(o, o, 2, true)).toEqual({ x: 101, y: 101 });
    const c = dragCorner(o, o, 2, false);
    expect(c.x).not.toBe(o.x);
    expect(c.y).not.toBe(o.y);
  });
  it('treats a bad ratio as square', () => {
    expect(dragCorner(o, { x: 150, y: 120 }, 0, false)).toEqual({ x: 150, y: 150 });
  });
});

describe('ratioOf and naturalEnd', () => {
  it('gives width over height, or 1 for an empty box', () => {
    expect(ratioOf({ x: 0, y: 0 }, { x: 40, y: 20 })).toBe(2);
    expect(ratioOf({ x: 0, y: 0 }, { x: 40, y: 0 })).toBe(1);
  });
  it('puts the far corner a size away from the click', () => {
    expect(naturalEnd({ x: 10, y: 20 }, { w: 30, h: 40 })).toEqual({ x: 40, y: 60 });
  });
});
