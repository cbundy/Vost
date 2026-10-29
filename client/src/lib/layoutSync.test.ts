import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from '../types';
import { barTimeAt, publishCrosshair, publishTimeRange, subscribe } from './layoutSync';

const bars = (times: number[]): Candle[] => times.map((time) => ({ time, open: 1, high: 2, low: 0, close: 1, volume: 1 }));

describe('barTimeAt', () => {
  const c = bars([100, 160, 220, 280]);
  it('finds the bar for an exact and a mid-bar time', () => {
    expect(barTimeAt(c, 160)).toBe(160);
    expect(barTimeAt(c, 200)).toBe(160);
    expect(barTimeAt(c, 279)).toBe(220);
    expect(barTimeAt(c, 300)).toBe(280);
  });
  it('is null before the first bar and after the last bar span', () => {
    expect(barTimeAt(c, 99)).toBeNull();
    expect(barTimeAt(c, 340)).toBeNull();
    expect(barTimeAt([], 1)).toBeNull();
  });
});

describe('view bus', () => {
  const offs: Array<() => void> = [];
  afterEach(() => {
    while (offs.length) offs.pop()!();
  });
  it('delivers to every chart but the source and stops after unsubscribe', () => {
    const a = { crosshair: vi.fn(), timeRange: vi.fn() };
    const b = { crosshair: vi.fn(), timeRange: vi.fn() };
    offs.push(subscribe('a', a));
    const offB = subscribe('b', b);
    offs.push(offB);
    const pos = { time: 1, price: 2, providerId: 'demo', symbol: 'X' };
    publishCrosshair('a', pos);
    publishTimeRange('a', { from: 1, to: 2 });
    expect(a.crosshair).not.toHaveBeenCalled();
    expect(a.timeRange).not.toHaveBeenCalled();
    expect(b.crosshair).toHaveBeenCalledWith(pos);
    expect(b.timeRange).toHaveBeenCalledWith({ from: 1, to: 2 });
    publishCrosshair('a', null);
    expect(b.crosshair).toHaveBeenLastCalledWith(null);
    offB();
    publishCrosshair('a', pos);
    expect(b.crosshair).toHaveBeenCalledTimes(2);
  });
});
