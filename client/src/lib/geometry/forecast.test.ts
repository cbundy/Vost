import { describe, expect, it } from 'vitest';
import type { OhlcBar } from '../drawingGeometry';
import { distToProjectionArc, forecastVerdict, inProjectionWedge, projectionGeometry, projectionWedge } from './forecast';

const bar = (time: number, low: number, high: number): OhlcBar => ({ time, open: low, high, low, close: high } as OhlcBar);
const src = { time: 10, price: 100 };

describe('forecastVerdict', () => {
  const bars = [bar(10, 99, 150), bar(20, 98, 104), bar(30, 97, 106)];
  it('is pending until a bar reaches the target time', () => {
    expect(forecastVerdict(src, { time: 40, price: 105 }, bars)).toBe('pending');
  });
  it('succeeds up when a bar high reaches the target', () => {
    expect(forecastVerdict(src, { time: 30, price: 105 }, bars)).toBe('success');
  });
  it('succeeds down when a bar low reaches the target', () => {
    expect(forecastVerdict(src, { time: 30, price: 97.5 }, bars)).toBe('success');
  });
  it('fails up and down when no bar reaches it', () => {
    expect(forecastVerdict(src, { time: 30, price: 110 }, bars)).toBe('failure');
    expect(forecastVerdict(src, { time: 30, price: 90 }, bars)).toBe('failure');
  });
  it('counts a target touched exactly, and ignores the bar at the source time', () => {
    expect(forecastVerdict(src, { time: 30, price: 106 }, bars)).toBe('success');
    expect(forecastVerdict(src, { time: 30, price: 120 }, bars)).toBe('failure');
  });
  it('ignores bars after the target time', () => {
    expect(forecastVerdict(src, { time: 20, price: 106 }, bars)).toBe('failure');
  });
  it('is pending with no bars or one bar before the target, and never throws', () => {
    expect(forecastVerdict(src, { time: 30, price: 105 }, [])).toBe('pending');
    expect(forecastVerdict(src, { time: 30, price: 105 }, [bar(10, 99, 150)])).toBe('pending');
    expect(forecastVerdict({ time: NaN, price: 1 }, { time: 30, price: 105 }, bars)).toBe('pending');
  });
  it('succeeds at once when flat', () => {
    expect(forecastVerdict(src, { time: 30, price: 100 }, [])).toBe('success');
  });
});

describe('projectionGeometry', () => {
  const a = { x: 0, y: 0 };
  it('works out the radius, angles, sweep and percent', () => {
    const g = projectionGeometry(a, { x: 100, y: 0 }, { x: 0, y: 150 })!;
    expect(g.radius).toBe(100);
    expect(g.legAngle).toBeCloseTo(0);
    expect(g.projAngle).toBeCloseTo(Math.PI / 2);
    expect(g.sweep).toBeCloseTo(Math.PI / 2);
    expect(g.percent).toBeCloseTo(150);
  });
  it('sweeps the other way when point 3 is on the other side of the leg', () => {
    const g = projectionGeometry(a, { x: 100, y: 0 }, { x: 50, y: -50 })!;
    expect(g.sweep).toBeCloseTo(-Math.PI / 4);
    expect(g.percent).toBeCloseTo(70.71, 1);
  });
  it('takes the short way round across the +-PI seam', () => {
    const g = projectionGeometry(a, { x: -100, y: 1 }, { x: -100, y: -1 })!;
    expect(Math.abs(g.sweep)).toBeLessThan(0.1);
  });
  it('is null for equal anchors', () => {
    expect(projectionGeometry(a, a, { x: 5, y: 5 })).toBeNull();
    expect(projectionGeometry(a, { x: 5, y: 5 }, a)).toBeNull();
  });
  it('builds the wedge, tests membership and measures to the arc', () => {
    const g = projectionGeometry(a, { x: 100, y: 0 }, { x: 0, y: 150 })!;
    const w = projectionWedge(a, g);
    expect(w[0]).toEqual(a);
    expect(w[1].x).toBeCloseTo(100);
    expect(w[w.length - 1].y).toBeCloseTo(100);
    expect(inProjectionWedge({ x: 30, y: 30 }, a, g)).toBe(true);
    expect(inProjectionWedge({ x: 30, y: -30 }, a, g)).toBe(false);
    expect(inProjectionWedge({ x: 90, y: 90 }, a, g)).toBe(false);
    expect(distToProjectionArc({ x: 70.71, y: 70.71 }, a, g)).toBeLessThan(0.1);
    expect(distToProjectionArc({ x: 100, y: -10 }, a, g)).toBeCloseTo(10);
    expect(distToProjectionArc({ x: 106, y: 0 }, a, g)).toBeCloseTo(6);
  });
});
