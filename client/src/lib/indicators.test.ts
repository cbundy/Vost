import { describe, expect, it } from 'vitest';
import { adx, bollinger, crossover, ema, highest, indicatorHelpers, lowest, macd, rsi, sma, stdev, volumeSma, vwap } from './indicators';
import type { Candle } from '../types';

describe('sma', () => {
  it('computes rolling means with null warm-up', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe('ema', () => {
  it('seeds with the SMA and then smooths', () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('reacts faster than SMA to a new price', () => {
    const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 20];
    const e = ema(values, 5)[values.length - 1] as number;
    const s = sma(values, 5)[values.length - 1] as number;
    expect(e).toBeGreaterThan(s);
  });
});

describe('rsi', () => {
  it('is 100 on a straight uptrend', () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(rsi(values, 14)[14]).toBeCloseTo(100, 6);
  });

  it('is 0 on a straight downtrend', () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(values, 14)[14]).toBeCloseTo(0, 6);
  });
});

describe('bollinger', () => {
  it('centres on the SMA with population standard deviation bands', () => {
    const values = [1, 2, 3, 4, 5];
    const { upper, middle, lower } = bollinger(values, 5, 2);
    expect(middle[4]).toBe(3);
    const sd = Math.sqrt(2); // population sd of 1..5
    expect(upper[4]).toBeCloseTo(3 + 2 * sd, 6);
    expect(lower[4]).toBeCloseTo(3 - 2 * sd, 6);
  });
});

describe('macd', () => {
  it('histogram equals macd minus signal where both exist', () => {
    const values = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 7) * 10 + i * 0.1);
    const { macd: line, signal, histogram } = macd(values, 12, 26, 9);
    const i = 100;
    expect(line[i]).not.toBeNull();
    expect(signal[i]).not.toBeNull();
    expect(histogram[i] as number).toBeCloseTo((line[i] as number) - (signal[i] as number), 9);
  });
});

describe('atr / stdev / channel helpers', () => {
  it('highest and lowest track rolling extremes', () => {
    expect(highest([1, 5, 2, 8, 3], 3)).toEqual([null, null, 5, 8, 8]);
    expect(lowest([1, 5, 2, 8, 3], 3)).toEqual([null, null, 1, 2, 2]);
  });

  it('stdev of a constant series is zero', () => {
    expect(stdev([7, 7, 7, 7], 3)[3]).toBe(0);
  });
});

describe('vwap', () => {
  it('equals the typical price when volume is uniform on one bar', () => {
    const candles: Candle[] = [{ time: 0, open: 10, high: 12, low: 8, close: 10, volume: 5 }];
    expect(vwap(candles, true)[0]).toBeCloseTo((12 + 8 + 10) / 3, 9);
  });
});

describe('crossover', () => {
  it('detects an upwards cross only on the crossing bar', () => {
    const a = [1, 2, 4];
    const b = [3, 3, 3];
    expect(crossover(a, b, 1)).toBe(false);
    expect(crossover(a, b, 2)).toBe(true);
  });
});

describe('volumeSma', () => {
  const bar = (volume: number): Candle => ({
    time: 0,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume,
  });
  it('averages bar volume with a null warm-up', () => {
    expect(volumeSma([10, 20, 60, 30].map(bar), 2)).toEqual([null, 15, 40, 45]);
  });
  it('is reachable through indicatorHelpers', () => {
    const candles = [10, 20, 60].map(bar);
    expect(indicatorHelpers(candles, false).volumeSma(2)).toEqual([null, 15, 40]);
  });
});

describe('adx', () => {
  // Hand-computed with Wilder smoothing, period 3.
  const H = [10, 11, 12, 11.5, 12.5, 13, 12.8, 13.5, 14, 13.2];
  const L = [9, 9.8, 10.5, 10.2, 11, 11.6, 11.5, 12, 12.9, 12.1];
  const C = [9.5, 10.8, 11.8, 10.8, 12.2, 12.9, 12.0, 13.4, 13.1, 12.4];
  const candles: Candle[] = C.map((close, i) => ({
    time: i,
    open: close,
    high: H[i],
    low: L[i],
    close,
    volume: 1,
  }));

  it('is null through the warm-up, then matches the hand-computed values', () => {
    const out = adx(candles, 3);
    expect(out.slice(0, 5)).toEqual([null, null, null, null, null]);
    const want = [81.98027622576632, 79.9108413159899, 81.78110972994074, 84.48189363432532, 59.72223138724291];
    want.forEach((v, k) => expect(out[5 + k] as number).toBeCloseTo(v, 9));
  });

  it('is 0 on a flat series and null when there are too few bars', () => {
    const flat: Candle[] = Array.from({ length: 12 }, (_, i) => ({
      time: i,
      open: 5,
      high: 5,
      low: 5,
      close: 5,
      volume: 1,
    }));
    const out = adx(flat, 3);
    expect(out.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(out.slice(5)).toEqual(new Array(7).fill(0));
    expect(adx(candles.slice(0, 5), 3).every((v) => v === null)).toBe(true);
  });

  it('is reachable through indicatorHelpers', () => {
    expect(indicatorHelpers(candles, false).adx(3)).toEqual(adx(candles, 3));
  });
});
