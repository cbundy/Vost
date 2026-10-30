import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { historyNeededFrom, quickRangeState, quickRangeWindow, resetLogicalRange, resetRangeKey } from './quickRange';

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

describe('quickRangeState while older pages may load', () => {
  const day = 86400;
  const c = bars([0, 1, 2, 3, 4].map((i) => utc(2024, 5, 10 + i)));
  it('enables a range that reaches before the first bar and marks it needsOlder', () => {
    expect(quickRangeState('1M', c, 'UTC', true)).toMatchObject({ enabled: true, needsOlder: true });
    // a bar sparse range that would be disabled without paging
    const two = bars([utc(2024, 5, 14), utc(2024, 5, 15)]);
    expect(quickRangeState('1M', two, 'UTC').enabled).toBe(false);
    expect(quickRangeState('1M', two, 'UTC', true).enabled).toBe(true);
  });
  it('disables or shows all once the start is known (canPage false)', () => {
    const s = quickRangeState('1M', c, 'UTC', false);
    expect(s).toMatchObject({ enabled: true, showAll: true, needsOlder: false });
    const two = bars([utc(2024, 5, 14), utc(2024, 5, 15)]);
    expect(quickRangeState('1M', two, 'UTC', false).enabled).toBe(false);
  });
  it('does not page a range already covered, and All never pages', () => {
    const dense = bars(Array.from({ length: 30 }, (_, i) => utc(2024, 4, 1) + i * day));
    expect(quickRangeState('5D', dense, 'UTC', true).needsOlder).toBe(false);
    expect(quickRangeState('All', c, 'UTC', true).needsOlder).toBe(false);
    expect(historyNeededFrom('All', c, 'UTC')).toBeNull();
  });
  it('historyNeededFrom gives the time to reach, or null when covered', () => {
    expect(historyNeededFrom('1M', c, 'UTC')).toBe(utc(2024, 4, 14));
    const dense = bars(Array.from({ length: 60 }, (_, i) => utc(2024, 4, 1) + i * day));
    expect(historyNeededFrom('5D', dense, 'UTC')).toBeNull();
    expect(historyNeededFrom('1M', [], 'UTC')).toBeNull();
  });
});

describe('resetRangeKey', () => {
  it('maps the canonical unit to a window', () => {
    for (const t of ['1m', '5m', '30m', '90m']) expect(resetRangeKey(t)).toBe('1D');
    for (const t of ['1h', '4h', '60m', '2h']) expect(resetRangeKey(t)).toBe('5D');
    for (const t of ['1d', '3d', '24h', '1440m']) expect(resetRangeKey(t)).toBe('1M');
    for (const t of ['1w', '1M', '3M', 'nope', '']) expect(resetRangeKey(t)).toBe('All');
  });
});

describe('resetLogicalRange', () => {
  const day = 86400;
  const daily = (n: number) => bars(Array.from({ length: n }, (_, i) => utc(2024, 1, 1) + i * day));
  it('shows the last month plus the right offset on a long daily series', () => {
    const c = daily(100); // last bar 2024-04-09, month back 2024-03-09 = index 68
    expect(resetLogicalRange('1d', c, 'UTC', 3)).toEqual({ from: 68, to: 99 + 3 });
  });
  it('falls back to all data when the bars do not reach back, the window is thin, or the timeframe is weekly', () => {
    expect(resetLogicalRange('1d', daily(20), 'UTC', 3)).toBeNull();
    expect(resetLogicalRange('1w', daily(100), 'UTC', 3)).toBeNull();
    expect(resetLogicalRange('1d', [], 'UTC', 3)).toBeNull();
    const sparse = bars([utc(2023, 1, 1), utc(2024, 4, 1), utc(2024, 4, 9)]);
    expect(quickRangeState('1M', sparse, 'UTC').enabled).toBe(false);
    expect(resetLogicalRange('1d', sparse, 'UTC', 3)).toBeNull();
  });
});
