import { describe, expect, it } from 'vitest';
import { fillPolygons, type FillBar } from './fillGeometry';

const bar = (x: number, y1: number | null, y2: number | null, color = 'red'): FillBar => ({ x, y1, y2, color });

describe('fillPolygons', () => {
  it('one polygon for a simple pair', () => {
    const p = fillPolygons([bar(0, 10, 20), bar(5, 12, 22)]);
    expect(p).toEqual([{ color: 'red', points: [{ x: 0, y: 10 }, { x: 5, y: 12 }, { x: 5, y: 22 }, { x: 0, y: 20 }] }]);
  });

  it('a flat band for two constants', () => {
    const p = fillPolygons([bar(0, 10, 50), bar(5, 10, 50), bar(10, 10, 50)]);
    expect(p).toHaveLength(1);
    expect(p[0].points).toEqual([
      { x: 0, y: 10 }, { x: 5, y: 10 }, { x: 10, y: 10 },
      { x: 10, y: 50 }, { x: 5, y: 50 }, { x: 0, y: 50 },
    ]);
  });

  it('leaves a gap where either side is na at either end of a segment', () => {
    const p = fillPolygons([bar(0, 1, 2), bar(1, 1, 2), bar(2, null, 2), bar(3, 1, 2), bar(4, 1, 2), bar(5, 1, null), bar(6, 1, 2), bar(7, 1, 2)]);
    expect(p.map((q) => q.points[0].x)).toEqual([0, 3, 6]);
    expect(p.map((q) => q.points.length)).toEqual([4, 4, 4]);
  });

  it('a colour change splits the polygon; the segment takes its starting bar colour', () => {
    const p = fillPolygons([bar(0, 1, 2, 'red'), bar(1, 1, 2, 'red'), bar(2, 1, 2, 'green'), bar(3, 1, 2, 'green')]);
    expect(p.map((q) => [q.color, q.points[0].x, q.points[q.points.length / 2 - 1].x])).toEqual([
      ['red', 0, 2],
      ['green', 2, 3],
    ]);
  });

  it('skips bars with no x and draws nothing for fewer than two bars', () => {
    expect(fillPolygons([bar(0, 1, 2)])).toEqual([]);
    expect(fillPolygons([bar(0, 1, 2), { x: null, y1: 1, y2: 2, color: 'red' }])).toEqual([]);
  });
});
