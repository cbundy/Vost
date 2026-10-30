import { describe, expect, it } from 'vitest';
import type { OhlcBar } from '../drawingGeometry';
import { barsPatternCopy } from './barsPattern';

const bars: OhlcBar[] = [
  { time: 1, open: 10, high: 12, low: 9, close: 11 },
  { time: 2, open: 11, high: 13, low: 10, close: 12 },
  { time: 3, open: 12, high: 14, low: 11, close: 13 },
  { time: 4, open: 13, high: 15, low: 12, close: 14 },
];
const b = (open: number, high: number, low: number, close: number) => ({ open, high, low, close });

describe('barsPatternCopy', () => {
  it('copies the run shifted so the first open is the start price', () => {
    expect(barsPatternCopy(bars, 1, 3, 20)).toEqual([b(20, 22, 19, 21), b(21, 23, 20, 22), b(22, 24, 21, 23)]);
  });
  it('mirrors: reversed in time with open and close swapped, so the run is continuous', () => {
    const copy = barsPatternCopy(bars, 1, 3, 20, { mirrored: true });
    expect(copy).toEqual([b(20, 21, 18, 19), b(19, 20, 17, 18), b(18, 19, 16, 17)]);
    expect(copy[1].open).toBe(copy[0].close);
  });
  it('flips around the first open, high and low swapping', () => {
    expect(barsPatternCopy(bars, 1, 3, 20, { flipped: true })).toEqual([b(20, 21, 18, 19), b(19, 20, 17, 18), b(18, 19, 16, 17)]);
    expect(barsPatternCopy(bars, 1, 3, 10, { flipped: true })[0]).toEqual(b(10, 11, 8, 9));
  });
  it('mirrored and flipped together', () => {
    // Mirrored from 13: (13,14,11,12) (12,13,10,11) (11,12,9,10); flipped around 13, then start 20.
    expect(barsPatternCopy(bars, 1, 3, 20, { mirrored: true, flipped: true })).toEqual([b(20, 22, 19, 21), b(21, 23, 20, 22), b(22, 24, 21, 23)]);
  });
  it('gives the same copy for the source anchors in either order', () => {
    expect(barsPatternCopy(bars, 3, 1, 20, { mirrored: true })).toEqual(barsPatternCopy(bars, 1, 3, 20, { mirrored: true }));
  });
  it('is empty with no loaded bar in the run or no bars, and copies one bar', () => {
    expect(barsPatternCopy(bars, 10, 20, 5)).toEqual([]);
    expect(barsPatternCopy([], 1, 3, 5)).toEqual([]);
    expect(barsPatternCopy(bars, Number.NaN, 3, 5)).toEqual([]);
    expect(barsPatternCopy(bars, 2, 2, 50)).toEqual([b(50, 52, 49, 51)]);
  });
});
