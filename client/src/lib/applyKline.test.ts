import { describe, expect, it } from 'vitest';
import { applyKline, mergeCandles } from './applyKline';
import type { Candle } from '../types';

const c = (time: number, close: number): Candle => ({ time, open: 1, high: 2, low: 0.5, close, volume: 1 });

describe('applyKline', () => {
  it('updates the last bar when the open time matches', () => {
    const out = applyKline([c(60, 1), c(120, 2)], c(120, 5));
    expect(out).toHaveLength(2);
    expect(out[1].close).toBe(5);
  });
  it('appends a newer bar', () => {
    const out = applyKline([c(60, 1)], c(120, 2));
    expect(out.map((x) => x.time)).toEqual([60, 120]);
  });
  it('starts the series when it is empty', () => {
    expect(applyKline([], c(60, 1))).toHaveLength(1);
  });
  it('ignores an older bar', () => {
    const cs = [c(60, 1), c(120, 2)];
    expect(applyKline(cs, c(30, 9))).toBe(cs);
  });
});

describe('mergeCandles', () => {
  it('replaces a bar with the same time, appends newer ones and keeps the order', () => {
    const out = mergeCandles([c(60, 1), c(120, 2)], [c(120, 9), c(180, 3), c(240, 4)]);
    expect(out.map((x) => [x.time, x.close])).toEqual([[60, 1], [120, 9], [180, 3], [240, 4]]);
  });
  it('fills a gap between the loaded bars and the new ones', () => {
    const out = mergeCandles([c(60, 1)], [c(180, 3), c(120, 2)]);
    expect(out.map((x) => x.time)).toEqual([60, 120, 180]);
  });
});
