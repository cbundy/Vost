import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { carriedView, isAssetSwitch, logicalAtTime, timeAtLogical, type SeriesIdentity } from './carryView';

const H = 3600;
const bars = (first: number, n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: first + i * H, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
const id = (o: Partial<SeriesIdentity> = {}): SeriesIdentity => ({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1h', datasetId: null, ...o });

describe('isAssetSwitch', () => {
  it('is true for a symbol or provider change on the same timeframe', () => {
    expect(isAssetSwitch(id(), id({ symbol: 'ETHUSDT' }))).toBe(true);
    expect(isAssetSwitch(id(), id({ providerId: 'other' }))).toBe(true);
  });
  it('is false for a timeframe change, a dataset, the first load or no change', () => {
    expect(isAssetSwitch(id(), id({ symbol: 'ETHUSDT', timeframe: '4h' }))).toBe(false);
    expect(isAssetSwitch(id({ datasetId: 'd' }), id({ symbol: 'ETHUSDT' }))).toBe(false);
    expect(isAssetSwitch(id(), id({ symbol: 'ETHUSDT', datasetId: 'd' }))).toBe(false);
    expect(isAssetSwitch(null, id())).toBe(false);
    expect(isAssetSwitch(id(), id())).toBe(false);
  });
});

describe('timeAtLogical and logicalAtTime', () => {
  const t0 = 1_000_000 * H;
  const cs = bars(t0, 100);
  it('round-trip inside and outside the data, with fractional indexes', () => {
    for (const i of [-200, -0.5, 0, 0.25, 10, 50.75, 98.5, 99, 99.5, 250]) {
      expect(logicalAtTime(cs, timeAtLogical(cs, i, H), H)).toBeCloseTo(i, 6);
    }
  });
  it('extrapolates by one bar length per index past the data', () => {
    expect(timeAtLogical(cs, -3, H)).toBe(t0 - 3 * H);
    expect(timeAtLogical(cs, 102, H)).toBe(t0 + 99 * H + 3 * H);
  });
  it('shifts the index when bars are prepended', () => {
    const t = timeAtLogical(cs, 5, H);
    expect(logicalAtTime([...bars(t0 - 40 * H, 40), ...cs], t, H)).toBeCloseTo(45, 6);
  });
});

describe('carriedView', () => {
  const t0 = 1_000_000 * H;
  const view = (from: number, to: number, n = 1000) => ({ logical: { from, to }, candles: bars(t0, n) });
  it('keeps the bar count and right offset at the new last bar on the live edge', () => {
    const v = carriedView({ logical: { from: 700, to: 1002 }, candles: bars(t0, 1000) }, bars(t0, 500));
    expect(v).toEqual({ kind: 'logical', range: { from: 500 - 1 + 3 - 302, to: 502 } });
  });
  it('maps a scrolled back window to the same times', () => {
    expect(carriedView(view(100, 200), bars(t0, 1000))).toEqual({ kind: 'time', from: t0 + 100 * H, to: t0 + 200 * H, needFrom: null });
  });
  it('keeps empty space before the first old bar and asks for older bars', () => {
    expect(carriedView(view(-200, 300), bars(t0, 1000))).toEqual({ kind: 'time', from: t0 - 200 * H, to: t0 + 300 * H, needFrom: t0 - 200 * H });
  });
  it('asks for older bars when the window starts before the first new bar', () => {
    expect(carriedView(view(100, 200), bars(t0 + 150 * H, 1000))).toEqual({
      kind: 'time',
      from: t0 + 100 * H,
      to: t0 + 200 * H,
      needFrom: t0 + 100 * H,
    });
  });
  it('fits when the window holds fewer than the minimum bars', () => {
    expect(carriedView(view(10, 11), bars(t0, 1000))).toBeNull();
  });
  it('keeps the span when the new series ends before the old window end', () => {
    expect(carriedView(view(100, 200), bars(t0, 150))).toEqual({ kind: 'time', from: t0 + 100 * H, to: t0 + 200 * H, needFrom: null });
  });
  it('fits when the new series ends before the window starts', () => {
    expect(carriedView(view(100, 200), bars(t0, 50))).toBeNull();
  });
});
