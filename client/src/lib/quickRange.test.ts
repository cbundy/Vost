import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { quickRangeState, quickRangeWindow } from './quickRange';

const utc = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 1000;
const bars = (times: number[]): Candle[] => times.map((time) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

describe('quickRangeWindow', () => {
  const last = utc(2024, 5, 15, 12, 30);
  it('maps each key from the last bar in UTC', () => {
    const f = (k: Parameters<typeof quickRangeWindow>[0]) => quickRangeWindow(k, last, 'UTC').from;
    expect(f('1D')).toBe(utc(2024, 5, 14, 12, 30));
    expect(f('5D')).toBe(utc(2024, 5, 10, 12, 30));
    expect(f('1M')).toBe(utc(2024, 4, 15, 12, 30));
    expect(f('3M')).toBe(utc(2024, 2, 15, 12, 30));
    expect(f('6M')).toBe(utc(2023, 11, 15, 12, 30));
    expect(f('YTD')).toBe(utc(2024, 1, 1));
    expect(f('1Y')).toBe(utc(2023, 5, 15, 12, 30));
    expect(f('5Y')).toBe(utc(2019, 5, 15, 12, 30));
    expect(f('All')).toBeNull();
    expect(quickRangeWindow('1D', last, 'UTC').to).toBe(last);
  });
  it('clamps 1M from 31 Mar to the end of February', () => {
    expect(quickRangeWindow('1M', utc(2023, 3, 31, 10), 'UTC').from).toBe(utc(2023, 2, 28, 10));
    expect(quickRangeWindow('1M', utc(2024, 3, 31, 10), 'UTC').from).toBe(utc(2024, 2, 29, 10));
  });
  it('starts YTD at local midnight 1 Jan in the zone', () => {
    // Tehran is UTC+3:30 all year since 2022
    expect(quickRangeWindow('YTD', utc(2024, 5, 15), 'Asia/Tehran').from).toBe(utc(2023, 12, 31, 20, 30));
    expect(quickRangeWindow('YTD', utc(2024, 5, 15), 'America/New_York').from).toBe(utc(2024, 1, 1, 5));
  });
  it('keeps the local year for a last bar on 1 Jan 02:00 local', () => {
    // 2024-01-01 02:00 Tehran = 2023-12-31 22:30 UTC
    expect(quickRangeWindow('YTD', utc(2023, 12, 31, 22, 30), 'Asia/Tehran').from).toBe(utc(2023, 12, 31, 20, 30));
  });
});

describe('quickRangeState', () => {
  const day = 86400;
  it('disables everything with no data', () => {
    expect(quickRangeState('All', [], 'UTC').enabled).toBe(false);
    expect(quickRangeState('1M', [], 'UTC').enabled).toBe(false);
  });
  it('reports shows-all when the window starts before the first bar', () => {
    const c = bars([0, 1, 2, 3, 4].map((i) => utc(2024, 5, 10 + i)));
    const s = quickRangeState('1M', c, 'UTC');
    expect(s.showAll).toBe(true);
    expect(s.enabled).toBe(true);
    expect(quickRangeState('All', c, 'UTC')).toMatchObject({ enabled: true, showAll: true });
  });
  it('disables windows with fewer than 3 bars', () => {
    const c = bars(Array.from({ length: 30 }, (_, i) => utc(2024, 4, 1) + i * day));
    expect(quickRangeState('1D', c, 'UTC').enabled).toBe(false);
    expect(quickRangeState('5D', c, 'UTC').enabled).toBe(true);
    expect(quickRangeState('5D', c, 'UTC').showAll).toBe(false);
  });
  it('enables 1D on hourly bars and All needs 3 bars', () => {
    const c = bars(Array.from({ length: 48 }, (_, i) => utc(2024, 5, 14) + i * 3600));
    expect(quickRangeState('1D', c, 'UTC').enabled).toBe(true);
    expect(quickRangeState('All', bars([1, 2]), 'UTC').enabled).toBe(false);
  });
});
