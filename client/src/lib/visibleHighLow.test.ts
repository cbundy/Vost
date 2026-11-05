import { describe, expect, it } from 'vitest';
import { visibleHighLow } from './visibleHighLow';

const bars = [5, 9, 3, 7, 12, 4, 2, 8, 6, 10].map((h, i) => ({ high: h + 10, low: h - (i === 6 ? 0 : 1) }));

describe('visibleHighLow', () => {
  it('covers the whole range', () => {
    expect(visibleHighLow(bars, { from: 0, to: 9 })).toEqual({ high: 22, highIndex: 4, low: 2, lowIndex: 2 });
  });
  it('returns the visible extremes, not the loaded ones', () => {
    expect(visibleHighLow(bars, { from: 7, to: 9 })).toEqual({ high: 20, highIndex: 9, low: 5, lowIndex: 8 });
  });
  it('counts a bar when its centre is on screen (fractional edges)', () => {
    const r = visibleHighLow(bars, { from: 2.4, to: 7.6 })!;
    expect(r.highIndex).toBe(4);
    expect(visibleHighLow(bars, { from: 4.2, to: 5.9 })!.highIndex).toBe(5);
    expect(visibleHighLow(bars, { from: 4.2, to: 5.9 })!.lowIndex).toBe(5);
    expect(visibleHighLow(bars, { from: 2.4, to: 2.6 })).toBeNull();
  });
  it('clamps a range past the ends', () => {
    expect(visibleHighLow(bars, { from: -5, to: 30 })).toEqual(visibleHighLow(bars, { from: 0, to: 9 }));
  });
  it('is null entirely before or after the data', () => {
    expect(visibleHighLow(bars, { from: -10, to: -1 })).toBeNull();
    expect(visibleHighLow(bars, { from: 10, to: 20 })).toBeNull();
  });
  it('is null for no range or no bars', () => {
    expect(visibleHighLow(bars, null)).toBeNull();
    expect(visibleHighLow([], { from: 0, to: 5 })).toBeNull();
  });
  it('takes the first index on ties', () => {
    const t = [{ high: 5, low: 1 }, { high: 5, low: 1 }];
    expect(visibleHighLow(t, { from: 0, to: 1 })).toEqual({ high: 5, highIndex: 0, low: 1, lowIndex: 0 });
  });
});
