import { describe, expect, it } from 'vitest';
import { distToSegment, hitsHandle, logicalToTime, medianInterval, timeToLogical } from './drawingGeometry';

const H = 3600;
const hourly = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 1_000_000 + i * H);

describe('timeToLogical / logicalToTime', () => {
  it('maps a bar time to its index', () => {
    expect(timeToLogical(hourly, hourly[3])).toBe(3);
    expect(logicalToTime(hourly, 3)).toBe(hourly[3]);
  });
  it('interpolates between bars', () => {
    expect(timeToLogical(hourly, hourly[3] + H / 2)).toBeCloseTo(3.5);
    expect(logicalToTime(hourly, 3.5)).toBeCloseTo(hourly[3] + H / 2);
  });
  it('interpolates across a gap between uneven bars', () => {
    const t = [0, 100, 1100];
    expect(timeToLogical(t, 600)).toBeCloseTo(1.5);
    expect(logicalToTime(t, 1.5)).toBeCloseTo(600);
  });
  it('extrapolates before the first and after the last bar by the median interval', () => {
    expect(timeToLogical(hourly, hourly[0] - 2 * H)).toBeCloseTo(-2);
    expect(timeToLogical(hourly, hourly[7] + 5 * H)).toBeCloseTo(12);
    expect(logicalToTime(hourly, -2)).toBeCloseTo(hourly[0] - 2 * H);
    expect(logicalToTime(hourly, 12)).toBeCloseTo(hourly[7] + 5 * H);
  });
  it('round trips everywhere', () => {
    for (const t of [hourly[0] - 9999, hourly[2] + 17, hourly[7], hourly[7] + 123456]) {
      expect(logicalToTime(hourly, timeToLogical(hourly, t))).toBeCloseTo(t);
    }
  });
  it('keeps the same time across a change from 1h to 4h bars (new index)', () => {
    const fourH = [0, 1, 2, 3].map((i) => 1_000_000 + i * 4 * H);
    const t = fourH[1] + 2 * H;
    expect(timeToLogical(hourly, t)).toBeCloseTo(6);
    expect(timeToLogical(fourH, t)).toBeCloseTo(1.5);
    expect(logicalToTime(fourH, timeToLogical(fourH, t))).toBeCloseTo(t);
  });
  it('uses the median interval, ignoring one long gap', () => {
    expect(medianInterval([0, 10, 20, 30, 1000])).toBe(10);
    expect(medianInterval([5])).toBe(60);
  });
  it('handles no bars', () => {
    expect(timeToLogical([], 5)).toBe(0);
    expect(logicalToTime([], 5)).toBe(0);
  });
});

describe('segment distance and handle hit', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  it('measures the perpendicular distance inside the segment', () => {
    expect(distToSegment({ x: 5, y: 3 }, a, b)).toBe(3);
  });
  it('measures to the nearest end beyond the segment', () => {
    expect(distToSegment({ x: 13, y: 4 }, a, b)).toBe(5);
  });
  it('handles a zero length segment', () => {
    expect(distToSegment({ x: 3, y: 4 }, a, a)).toBe(5);
  });
  it('hits a handle within its radius only', () => {
    expect(hitsHandle({ x: 5, y: 5 }, { x: 8, y: 9 }, 5)).toBe(true);
    expect(hitsHandle({ x: 5, y: 5 }, { x: 8, y: 10 }, 5)).toBe(false);
  });
});
