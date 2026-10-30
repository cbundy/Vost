import { describe, expect, it } from 'vitest';
import { ghostFeedBars } from './ghostFeed';

const slotOf = (t: number) => t / 10;
const opts = { avgHeight: 2, variance: 50 };
const pts = (...v: [number, number][]) => v.map(([time, price]) => ({ time, price }));

describe('ghostFeedBars', () => {
  it('draws one bar per whole slot between the points, none for a segment of zero slots', () => {
    expect(ghostFeedBars(pts([0, 100], [30, 110], [50, 100]), slotOf, opts).map((b) => b.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(ghostFeedBars(pts([20, 100], [20, 130]), slotOf, opts)).toEqual([]);
    expect(ghostFeedBars(pts([20, 100], [20, 100]), slotOf, opts)).toEqual([]);
    expect(ghostFeedBars(pts([50, 100], [20, 130]), slotOf, opts).map((b) => b.slot)).toEqual([4, 3, 2]);
  });
  it('steps the closes along the line, each open the previous close', () => {
    const bars = ghostFeedBars(pts([0, 100], [40, 120]), slotOf, opts);
    expect(bars.map((b) => b.close)).toEqual([105, 110, 115, 120]);
    expect(bars.map((b) => b.open)).toEqual([100, 105, 110, 115]);
    bars.forEach((b) => {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
    });
  });
  it('gives deep-equal bars on repeated calls', () => {
    const a = pts([0, 100], [40, 120], [70, 90]);
    expect(ghostFeedBars(a, slotOf, opts)).toEqual(ghostFeedBars(a, slotOf, opts));
  });
  it('moving the last point leaves the first segment unchanged and changes the second', () => {
    const before = ghostFeedBars(pts([0, 100], [40, 120], [70, 90]), slotOf, opts);
    const after = ghostFeedBars(pts([0, 100], [40, 120], [70, 95]), slotOf, opts);
    expect(after.slice(0, 4)).toEqual(before.slice(0, 4));
    expect(after.slice(4)).not.toEqual(before.slice(4));
  });
  it('gives bars of exactly the average height at variance 0', () => {
    for (const b of ghostFeedBars(pts([0, 100], [50, 100.5]), slotOf, { avgHeight: 3, variance: 0 })) expect(b.high - b.low).toBeCloseTo(3, 9);
  });
  it('varies the height within the variance', () => {
    const heights = ghostFeedBars(pts([0, 100], [300, 100]), slotOf, opts).map((b) => b.high - b.low);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(Math.max(...heights)).toBeLessThanOrEqual(3 + 1e-9);
    expect(new Set(heights.map((h) => h.toFixed(6))).size).toBeGreaterThan(1);
  });
  it('scales with the height it is given (ticks times tick size) and survives one point and bad input', () => {
    const small = ghostFeedBars(pts([0, 100], [20, 100]), slotOf, { avgHeight: 1, variance: 0 });
    const big = ghostFeedBars(pts([0, 100], [20, 100]), slotOf, { avgHeight: 0.05 * 20, variance: 0 });
    expect(big[0].high - big[0].low).toBeCloseTo(1, 9);
    expect(small[0].high - small[0].low).toBeCloseTo(1, 9);
    expect(ghostFeedBars(pts([0, 100]), slotOf, opts)).toEqual([]);
    expect(ghostFeedBars([], slotOf, opts)).toEqual([]);
    expect(ghostFeedBars(pts([0, 100], [20, Number.NaN]), slotOf, opts)).toEqual([]);
  });
});
