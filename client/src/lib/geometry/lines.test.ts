import { describe, expect, it } from 'vitest';
import { angleArc, arcRadius, lineAngleDeg, lineDistance, referenceEnd } from './lines';

describe('line maths', () => {
  it('measures the angle counter-clockwise on screen', () => {
    expect(lineAngleDeg({ x: 0, y: 10 }, { x: 10, y: 0 })).toBeCloseTo(45);
    expect(lineAngleDeg({ x: 0, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(-45);
    expect(lineAngleDeg({ x: 5, y: 5 }, { x: 15, y: 5 })).toBe(0);
    expect(lineAngleDeg({ x: 5, y: 5 }, { x: 5, y: -5 })).toBeCloseTo(90);
    expect(lineAngleDeg({ x: 5, y: 5 }, { x: -5, y: 5 })).toBeCloseTo(180);
    expect(lineAngleDeg({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });
  it('measures the distance', () => {
    expect(lineDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(lineDistance({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
  it('sweeps the arc from the horizontal to the line', () => {
    const up = angleArc({ x: 0, y: 10 }, { x: 10, y: 0 });
    expect(up.start).toBe(0);
    expect(up.end).toBeCloseTo(-Math.PI / 4);
    expect(up.anticlockwise).toBe(true);
    const down = angleArc({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(down.end).toBeCloseTo(Math.PI / 4);
    expect(down.anticlockwise).toBe(false);
    expect(angleArc({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({ start: 0, end: -0, anticlockwise: false });
  });
  it('keeps the arc radius between 12 and 48', () => {
    expect(arcRadius({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(12);
    expect(arcRadius({ x: 0, y: 0 }, { x: 90, y: 0 })).toBe(30);
    expect(arcRadius({ x: 0, y: 0 }, { x: 900, y: 0 })).toBe(48);
  });
  it('ends the reference line within the pane', () => {
    expect(referenceEnd({ x: 10, y: 20 }, { x: 110, y: 0 }, 500)).toEqual({ x: 110, y: 20 });
    expect(referenceEnd({ x: 10, y: 20 }, { x: 12, y: 0 }, 500)).toEqual({ x: 58, y: 20 });
    expect(referenceEnd({ x: 480, y: 20 }, { x: 100, y: 0 }, 500)).toEqual({ x: 500, y: 20 });
  });
});
