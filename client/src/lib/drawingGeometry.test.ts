import { describe, expect, it } from 'vitest';
import { distToSegment, extendSegment, hitsHandle, logicalToTime, medianInterval, pointInRect, rayEnd, rectCornerDrag, rectCorners, measureSummary, snapToBar, timeToLogical, wrapText } from './drawingGeometry';

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

describe('snapToBar', () => {
  const bars = hourly.map((time, i) => ({ time, open: 100 + i, high: 110 + i, low: 90 + i, close: 102 + i }));
  it('snaps to the bar time and the nearest of open, high, low, close', () => {
    const near = { time: hourly[3] + 0.4 * H, price: 112 };
    expect(snapToBar(bars, near)).toEqual({ time: hourly[3], price: 113 });
    expect(snapToBar(bars, { time: hourly[3] - 0.49 * H, price: 91 })).toEqual({ time: hourly[3], price: 93 });
    expect(snapToBar(bars, { time: hourly[2] + 0.6 * H, price: 100 })).toEqual({ time: hourly[3], price: 103 });
    expect(snapToBar(bars, { time: hourly[1], price: 101.2 })).toEqual({ time: hourly[1], price: 101 });
    expect(snapToBar(bars, { time: hourly[1], price: 103.2 })).toEqual({ time: hourly[1], price: 103 });
  });
  it('timeOnly takes the bar time and keeps the anchor price', () => {
    expect(snapToBar(bars, { time: hourly[3] + 0.4 * H, price: 112 }, { timeOnly: true })).toEqual({ time: hourly[3], price: 112 });
    const off = { time: hourly[0] - 0.6 * H, price: 105 };
    expect(snapToBar(bars, off, { timeOnly: true })).toBe(off);
  });
  it('leaves an anchor outside every bar unchanged', () => {
    const left = { time: hourly[0] - 0.6 * H, price: 105 };
    const right = { time: hourly[7] + 0.6 * H, price: 105 };
    expect(snapToBar(bars, left)).toBe(left);
    expect(snapToBar(bars, right)).toBe(right);
    expect(snapToBar(bars, { time: hourly[7] + 0.4 * H, price: 105 }).time).toBe(hourly[7]);
  });
  it('keeps the time with priceOnly', () => {
    const a = { time: hourly[3] + 0.2 * H, price: 112 };
    expect(snapToBar(bars, a, { priceOnly: true })).toEqual({ time: a.time, price: 113 });
  });
  it('returns the anchor for empty candles', () => {
    const a = { time: 5, price: 6 };
    expect(snapToBar([], a)).toBe(a);
  });
});

describe('extendSegment', () => {
  const a = { x: 100, y: 100 };
  const b = { x: 200, y: 100 };
  it('keeps the segment when neither side extends', () => {
    expect(extendSegment(a, b, 500, 300, false, false)).toEqual([a, b]);
  });
  it('continues to the pane edge on the extended side only', () => {
    expect(extendSegment(a, b, 500, 300, false, true)).toEqual([a, { x: 500, y: 100 }]);
    expect(extendSegment(a, b, 500, 300, true, false)).toEqual([{ x: 0, y: 100 }, b]);
    expect(extendSegment(a, b, 500, 300, true, true)).toEqual([{ x: 0, y: 100 }, { x: 500, y: 100 }]);
  });
  it('follows a slanted line and keeps an end that is already off the pane', () => {
    const [from, to] = extendSegment({ x: 0, y: 0 }, { x: 100, y: 100 }, 500, 300, false, true);
    expect(from).toEqual({ x: 0, y: 0 });
    expect(to).toEqual({ x: 300, y: 300 });
    const far = { x: 900, y: 100 };
    expect(extendSegment(a, far, 500, 300, false, true)[1]).toEqual(far);
  });
});

describe('ray and rectangle geometry', () => {
  it('rayEnd ends on the pane edge, on the line through a and b', () => {
    const W = 200;
    const H = 100;
    expect(rayEnd({ x: 10, y: 50 }, { x: 20, y: 40 }, W, H)).toEqual({ x: 60, y: 0 });
    expect(rayEnd({ x: 10, y: 50 }, { x: 20, y: 60 }, W, H)).toEqual({ x: 60, y: H });
    expect(rayEnd({ x: 10, y: 50 }, { x: 20, y: 50 }, W, H)).toEqual({ x: W, y: 50 });
    expect(rayEnd({ x: 100, y: 50 }, { x: 40, y: 50 }, W, H)).toEqual({ x: 0, y: 50 });
    expect(rayEnd({ x: 30, y: 50 }, { x: 30, y: 70 }, W, H)).toEqual({ x: 30, y: H });
    expect(rayEnd({ x: 30, y: 50 }, { x: 30, y: 10 }, W, H)).toEqual({ x: 30, y: 0 });
    expect(rayEnd({ x: 30, y: 50 }, { x: 30, y: 50 }, W, H)).toEqual({ x: 30, y: 50 });
  });

  it('pointInRect covers inside, border, near-outside and outside, with corners in either order', () => {
    const a = { x: 10, y: 10 };
    const b = { x: 50, y: 40 };
    for (const [c, d] of [[a, b], [b, a], [{ x: 10, y: 40 }, { x: 50, y: 10 }]]) {
      expect(pointInRect({ x: 30, y: 25 }, c, d, 6)).toBe(true);
      expect(pointInRect({ x: 10, y: 25 }, c, d, 6)).toBe(true);
      expect(pointInRect({ x: 54, y: 25 }, c, d, 6)).toBe(true);
      expect(pointInRect({ x: 60, y: 25 }, c, d, 6)).toBe(false);
      expect(pointInRect({ x: 30, y: 0 }, c, d, 6)).toBe(false);
    }
  });

  it('rectCornerDrag keeps the opposite corner, also when dragged past it', () => {
    const a = { x: 10, y: 40 };
    const b = { x: 50, y: 10 };
    const corners = rectCorners(a, b);
    expect(corners).toEqual([{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 40 }, { x: 10, y: 40 }]);
    for (let i = 0; i < 4; i++) {
      for (const q of [{ x: 70, y: 5 }, { x: -20, y: 90 }]) {
        const [n1, n2] = rectCornerDrag(a, b, i, q);
        expect(n1).toEqual(corners[(i + 2) % 4]);
        expect(n2).toEqual(q);
        const after = rectCorners(n1, n2);
        expect(after.some((c) => c.x === q.x && c.y === q.y)).toBe(true);
        expect(after.some((c) => c.x === n1.x && c.y === n1.y)).toBe(true);
      }
    }
  });
});

describe('wrapText', () => {
  const m = (s: string) => s.length * 7;
  it('breaks at words', () => {
    expect(wrapText('aaa bbb ccc', 7 * 7, m)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('short', 100, m)).toEqual(['short']);
  });
  it('breaks a single long word by characters', () => {
    expect(wrapText('abcdefghij', 4 * 7, m)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('always returns a line', () => {
    expect(wrapText('', 100, m)).toEqual(['']);
  });
});

describe('measureSummary', () => {
  // Hourly bars with a weekend-style gap of 40 hours between bar 3 and bar 4.
  const times = [0, 1, 2, 3].map((i) => i * H).concat([4, 5, 6].map((i) => 3 * H + 40 * H + (i - 4) * H));
  it('measures an up move across the gap', () => {
    const s = measureSummary({ time: times[1], price: 100 }, { time: times[5], price: 110 }, times);
    expect(s).toEqual({ change: 10, pct: 10, bars: 4, seconds: times[5] - times[1], direction: 'up' });
  });
  it('measures a down move backwards in time with absolute bars and seconds', () => {
    const s = measureSummary({ time: times[5], price: 200 }, { time: times[2], price: 150 }, times);
    expect(s.change).toBe(-50);
    expect(s.pct).toBe(-25);
    expect(s.bars).toBe(3);
    expect(s.seconds).toBe(times[5] - times[2]);
    expect(s.direction).toBe('down');
  });
  it('is flat when price is unchanged and has no percent from a zero start', () => {
    expect(measureSummary({ time: 0, price: 5 }, { time: H, price: 5 }, times).direction).toBe('flat');
    expect(measureSummary({ time: 0, price: 0 }, { time: H, price: 3 }, times).pct).toBeNull();
  });
});
