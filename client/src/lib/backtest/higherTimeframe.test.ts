import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { barSeconds, higherTimeframe, multipleInterval } from './higherTimeframe';

const H = 3600;
const DAY0 = 1_600_041_600; // 00:00 UTC on a day boundary
const bar = (time: number, close = 100): Candle => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 });
const hours = (from: number, to: number): Candle[] => Array.from({ length: to - from }, (_, i) => bar(DAY0 + (from + i) * H, 100 + i));

describe('barSeconds', () => {
  it('is the smallest gap, with a day as the fallback', () => {
    expect(barSeconds(hours(0, 10))).toBe(H);
    expect(barSeconds([bar(DAY0)])).toBe(86400);
  });
});

describe('multipleInterval', () => {
  it('builds the multiple in the largest dividing unit', () => {
    expect(multipleInterval(3600, 4)).toBe('4h');
    expect(multipleInterval(3600, 24)).toBe('1d');
    expect(multipleInterval(900, 6)).toBe('90m');
    expect(multipleInterval(86400, 4)).toBe('4d');
    expect(multipleInterval(14400, 24)).toBe('4d');
  });
  it('is null when invalid', () => {
    expect(multipleInterval(86400, 400)).toBeNull();
    expect(multipleInterval(30, 3)).toBeNull();
  });
});

describe('higherTimeframe closed rule', () => {
  it('steps up exactly on the last hour of each 4h block', () => {
    const { lastClosed, bars } = higherTimeframe(hours(0, 12), '4h');
    expect(bars.length).toBe(3);
    expect(Array.from(lastClosed)).toEqual([-1, -1, -1, 0, 0, 0, 0, 1, 1, 1, 1, 2]);
  });
  it('drops a partial first bucket', () => {
    const { lastClosed, bars } = higherTimeframe(hours(1, 13), '4h');
    expect(bars[0].time).toBe(DAY0 + 4 * H);
    expect(Array.from(lastClosed)).toEqual([-1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 1, 1]);
  });
  it('shows a bucket with a missing last hour only on the next bucket', () => {
    const c = hours(0, 8).filter((x) => x.time !== DAY0 + 3 * H);
    const { lastClosed } = higherTimeframe(c, '4h');
    // bars at hours 0,1,2,4,5,6,7
    expect(Array.from(lastClosed)).toEqual([-1, -1, -1, 0, 0, 0, 1]);
  });
  it('shows a stock-like day only from the next day', () => {
    const c: Candle[] = [];
    for (let d = 0; d < 3; d++) for (let h = 13; h < 20; h++) c.push(bar(DAY0 + d * 86400 + h * H, 100 + d));
    const { lastClosed, bars } = higherTimeframe(c, '1d');
    expect(bars.length).toBe(2);
    // the first day starts at 13:00, so its bucket is partial and dropped
    expect(Array.from(lastClosed).slice(0, 7)).toEqual([-1, -1, -1, -1, -1, -1, -1]);
    expect(lastClosed[6]).toBe(-1); // the last bar of day 0 closes a dropped partial bucket
    expect(lastClosed[7]).toBe(-1); // first bar of day 1: day 0 was dropped
    expect(lastClosed[13]).toBe(-1); // the last bar of day 1 ends at 20:00, not at midnight
    expect(lastClosed[14]).toBe(0); // first bar of day 2 sees day 1
  });
});
