import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { carriedView, isAssetSwitch, type SeriesIdentity } from './carryView';

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

describe('carriedView', () => {
  const t0 = 1_000_000 * H;
  it('keeps the bar count and right offset at the new last bar on the live edge', () => {
    const old = { logical: { from: 700, to: 1002 }, from: null, to: null, length: 1000 };
    const v = carriedView(old, bars(t0, 500));
    expect(v).toEqual({ kind: 'logical', range: { from: 500 - 1 + 3 - 302, to: 502 } });
  });
  it('maps a scrolled back window to the same times', () => {
    const old = { logical: { from: 100, to: 200 }, from: t0 + 100 * H, to: t0 + 200 * H, length: 1000 };
    expect(carriedView(old, bars(t0, 1000))).toEqual({ kind: 'time', from: t0 + 100 * H, to: t0 + 200 * H, needFrom: null });
  });
  it('asks for older bars when the window starts before the first bar', () => {
    const old = { logical: { from: 100, to: 200 }, from: t0 - 50 * H, to: t0 + 20 * H, length: 1000 };
    expect(carriedView(old, bars(t0, 1000))).toEqual({ kind: 'time', from: t0 - 50 * H, to: t0 + 20 * H, needFrom: t0 - 50 * H });
  });
  it('asks for older bars when the whole window is before the first bar', () => {
    const old = { logical: { from: 100, to: 200 }, from: t0 - 80 * H, to: t0 - 20 * H, length: 1000 };
    expect(carriedView(old, bars(t0, 1000))).toEqual({ kind: 'time', from: t0 - 80 * H, to: t0 - 20 * H, needFrom: t0 - 80 * H });
  });
  it('fits when the window holds fewer than the minimum bars', () => {
    const old = { logical: { from: 100, to: 200 }, from: t0 + 10 * H, to: t0 + 11 * H, length: 1000 };
    expect(carriedView(old, bars(t0, 1000))).toBeNull();
  });
  it('ends at the last bar when the new series ends before the old window end', () => {
    const old = { logical: { from: 100, to: 200 }, from: t0 + 100 * H, to: t0 + 200 * H, length: 1000 };
    expect(carriedView(old, bars(t0, 150))).toEqual({ kind: 'time', from: t0 + 100 * H, to: t0 + 149 * H, needFrom: null });
  });
  it('fits when the new series ends before the window starts', () => {
    const old = { logical: { from: 100, to: 200 }, from: t0 + 100 * H, to: t0 + 200 * H, length: 1000 };
    expect(carriedView(old, bars(t0, 50))).toBeNull();
  });
});
