import { describe, expect, it } from 'vitest';
import type { OhlcBar } from '../drawingGeometry';
import { rangeSummary } from './ranges';

const bar = (time: number, volume?: number): OhlcBar => ({ time, open: 1, high: 1, low: 1, close: 1, volume });
const times = [10, 20, 30, 40, 50];
const candles = [bar(10, 1), bar(20, 2), bar(30, 4), bar(40, 8), bar(50, 16)];

describe('rangeSummary', () => {
  it('gives change, percent, bars and seconds as the measure does', () => {
    const s = rangeSummary({ time: 10, price: 100 }, { time: 40, price: 110 }, times, candles, 0.01);
    expect(s).toMatchObject({ change: 10, pct: 10, bars: 3, seconds: 30, direction: 'up', ticks: 1000 });
  });
  it('counts ticks without float drift and is null without a tick size', () => {
    expect(rangeSummary({ time: 10, price: 1.2345 }, { time: 20, price: 1.235 }, times, candles, 0.00001).ticks).toBe(50);
    expect(rangeSummary({ time: 10, price: 1 }, { time: 20, price: 2 }, times, candles).ticks).toBeNull();
    expect(rangeSummary({ time: 10, price: 1 }, { time: 20, price: 2 }, times, candles, 0).ticks).toBeNull();
  });
  it('sums the volume inclusively at both ends', () => {
    expect(rangeSummary({ time: 20, price: 1 }, { time: 40, price: 1 }, times, candles).volume).toBe(14);
  });
  it('counts missing, NaN and negative volume as 0', () => {
    const odd = [bar(10), bar(20, NaN), bar(30, -5), bar(40, 3)];
    expect(rangeSummary({ time: 10, price: 1 }, { time: 40, price: 1 }, times, odd).volume).toBe(3);
  });
  it('reversed anchors give a negative change and the same volume', () => {
    const f = rangeSummary({ time: 10, price: 100 }, { time: 40, price: 90 }, times, candles, 1);
    const r = rangeSummary({ time: 40, price: 90 }, { time: 10, price: 100 }, times, candles, 1);
    expect(f.change).toBe(-10);
    expect(f.ticks).toBe(-10);
    expect(r.volume).toBe(f.volume);
    expect(r.bars).toBe(f.bars);
  });
  it('handles equal anchors, no bars and one bar', () => {
    expect(rangeSummary({ time: 20, price: 5 }, { time: 20, price: 5 }, times, candles, 1)).toMatchObject({ change: 0, ticks: 0, bars: 0, seconds: 0, volume: 2 });
    expect(rangeSummary({ time: 1, price: 5 }, { time: 9, price: 6 }, [], [], 1)).toMatchObject({ bars: 0, volume: 0 });
    expect(rangeSummary({ time: 10, price: 5 }, { time: 10, price: 6 }, [10], [bar(10, 7)], 1)).toMatchObject({ bars: 0, volume: 7 });
  });
});
