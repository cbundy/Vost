import { describe, expect, it } from 'vitest';
import type { Candle } from '../../../shared/market.ts';
import { cardStats, dueKeys, quoteFromBars } from './quotes';

const DAY = 86_400;
const bar = (i: number, close: number, volume = 100, t0 = 1_700_000_000): Candle => ({
  time: t0 + i * DAY, open: close, high: close + 1, low: close - 1, close, volume,
});

describe('quoteFromBars', () => {
  it('computes change and percent up and down', () => {
    expect(quoteFromBars([bar(0, 100), bar(1, 110)])).toEqual({ last: 110, chg: 10, chgPct: 10 });
    const down = quoteFromBars([bar(0, 200), bar(1, 150)])!;
    expect(down.chg).toBe(-50);
    expect(down.chgPct).toBe(-25);
  });
  it('is zero when unchanged', () => {
    expect(quoteFromBars([bar(0, 5), bar(1, 5)])).toEqual({ last: 5, chg: 0, chgPct: 0 });
  });
  it('is null with a zero previous close or fewer than 2 bars', () => {
    expect(quoteFromBars([bar(0, 0), bar(1, 5)])).toBeNull();
    expect(quoteFromBars([bar(0, 5)])).toBeNull();
    expect(quoteFromBars([])).toBeNull();
    expect(quoteFromBars(null)).toBeNull();
  });
});

describe('dueKeys', () => {
  it('skips quotes younger than the minimum age and re-includes them after', () => {
    const last = { a: 1000, b: 500 };
    expect(dueKeys(['a', 'b', 'c'], last, 1500, 1000)).toEqual(['b', 'c']);
    expect(dueKeys(['a'], last, 2000, 1000)).toEqual(['a']);
    expect(dueKeys(['a'], last, 1999, 1000)).toEqual([]);
  });
});

describe('cardStats', () => {
  const series = (n: number, volume = 100): Candle[] => Array.from({ length: n }, (_, i) => bar(i, 100 + i, volume));
  const nowOf = (bars: Candle[]) => bars[bars.length - 1].time;

  it('gives the day range and quote', () => {
    const bars = series(40);
    const s = cardStats(bars, nowOf(bars))!;
    expect(s.last).toBe(139);
    expect(s.dayLow).toBe(138);
    expect(s.dayHigh).toBe(140);
    expect(s.chg).toBe(1);
  });
  it('shows 52 weeks only when the bars span at least 360 days', () => {
    const short = series(300);
    expect(cardStats(short, nowOf(short))!.high52).toBeNull();
    const long = series(365);
    const s = cardStats(long, nowOf(long))!;
    expect(s.high52).toBe(100 + 364 + 1);
    expect(s.low52).toBe(99);
  });
  it('compares the last volume with the 30 bars before it', () => {
    const bars = series(40);
    bars[39] = { ...bars[39], volume: 140 };
    expect(cardStats(bars, nowOf(bars))!.volRatio).toBeCloseTo(1.4);
  });
  it('omits the volume line without enough volume', () => {
    expect(cardStats(series(40, 0), 0)!.volRatio).toBeNull();
    expect(cardStats(series(30), 0)!.volRatio).toBeNull();
    const gap = series(40);
    gap[20] = { ...gap[20], volume: 0 };
    expect(cardStats(gap, 0)!.volRatio).toBeNull();
  });
  it('is null without a quote', () => {
    expect(cardStats([bar(0, 1)], 0)).toBeNull();
  });
});
