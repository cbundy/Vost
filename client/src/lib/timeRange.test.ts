import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import {
  chartRangeErrorText,
  cropToChartRange,
  describeTimeRange,
  fromZonedInputValue,
  sanitizeTimeRange,
  sliceByTimeRange,
  toZonedInputValue,
} from './timeRange';

const bars = (n: number, start = 1000, step = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: start + i * step, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));

describe('sliceByTimeRange', () => {
  const c = bars(10); // 1000..1900
  it('keeps both ends inclusive and drops the neighbours', () => {
    const s = sliceByTimeRange(c, { from: 1200, to: 1500 });
    expect(s.map((x) => x.time)).toEqual([1200, 1300, 1400, 1500]);
  });
  it('null ends are open', () => {
    expect(sliceByTimeRange(c, { from: 1800, to: null }).map((x) => x.time)).toEqual([1800, 1900]);
    expect(sliceByTimeRange(c, { from: null, to: 1100 }).map((x) => x.time)).toEqual([1000, 1100]);
  });
  it('returns the same array when both ends are null', () => {
    expect(sliceByTimeRange(c, { from: null, to: null })).toBe(c);
  });
});

describe('describeTimeRange', () => {
  const c = bars(10);
  it('open range has no error or clipping', () => {
    const d = describeTimeRange(c, { from: null, to: null });
    expect(d).toMatchObject({ count: 10, total: 10, error: null, clippedStart: false, clippedEnd: false });
  });
  it('range wholly outside the data is too-few-bars with count 0', () => {
    expect(describeTimeRange(c, { from: 5000, to: 6000 })).toMatchObject({ count: 0, error: 'too-few-bars' });
    expect(describeTimeRange(c, { from: 0, to: 500 })).toMatchObject({ count: 0, error: 'too-few-bars' });
  });
  it('partial overlap clips and crops to the overlap', () => {
    const a = describeTimeRange(c, { from: 0, to: 1300 });
    expect(a).toMatchObject({ count: 4, clippedStart: true, clippedEnd: false, error: null });
    const b = describeTimeRange(c, { from: 1700, to: 9999 });
    expect(b).toMatchObject({ count: 3, clippedStart: false, clippedEnd: true, error: null });
  });
  it('From later than To is from-after-to', () => {
    expect(describeTimeRange(c, { from: 1500, to: 1200 }).error).toBe('from-after-to');
  });
  it('two bars is too-few-bars, three is fine', () => {
    expect(describeTimeRange(c, { from: 1000, to: 1100 }).error).toBe('too-few-bars');
    expect(describeTimeRange(c, { from: 1000, to: 1200 }).error).toBeNull();
  });
});

describe('zoned input values', () => {
  const utc = (y: number, m: number, d: number, h: number, mi: number) => Date.UTC(y, m - 1, d, h, mi) / 1000;
  const NY = 'America/New_York';
  it('formats the wall clock in the zone', () => {
    expect(toZonedInputValue(utc(2024, 1, 15, 8, 30), 'UTC')).toBe('2024-01-15T08:30');
    expect(toZonedInputValue(utc(2024, 1, 15, 8, 30), 'Asia/Tehran')).toBe('2024-01-15T12:00');
    expect(toZonedInputValue(utc(2024, 1, 15, 17, 0), NY)).toBe('2024-01-15T12:00');
    expect(toZonedInputValue(utc(2024, 1, 1, 0, 0), 'UTC')).toBe('2024-01-01T00:00');
  });
  it('round trips in UTC, Tehran and New York', () => {
    for (const tz of ['UTC', 'Asia/Tehran', NY]) {
      for (const t of [utc(2024, 1, 15, 8, 30), utc(2024, 7, 4, 23, 59), utc(2024, 12, 31, 0, 0)]) {
        expect(fromZonedInputValue(toZonedInputValue(t, tz), tz)).toBe(t);
      }
    }
  });
  it('handles the DST skip and repeat', () => {
    expect(fromZonedInputValue('2024-03-10T02:30', NY)).toBe(utc(2024, 3, 10, 7, 30));
    expect(toZonedInputValue(utc(2024, 3, 10, 7, 30), NY)).toBe('2024-03-10T03:30');
    expect(fromZonedInputValue('2024-11-03T01:30', NY)).toBe(utc(2024, 11, 3, 5, 30));
    // the later 01:30 (EST) shows the same wall clock; parsing it picks the earlier instant
    expect(toZonedInputValue(utc(2024, 11, 3, 6, 30), NY)).toBe('2024-11-03T01:30');
    expect(toZonedInputValue(utc(2024, 11, 3, 5, 30), NY)).toBe('2024-11-03T01:30');
  });
  it('empty or malformed input is null', () => {
    for (const v of ['', 'x', '2024-01-15', '2024-13-01T00:00', '2024-02-31T00:00', '2024-01-15T25:00']) {
      expect(fromZonedInputValue(v, 'UTC')).toBeNull();
    }
  });
});

describe('sanitizeTimeRange', () => {
  it('accepts number-or-null ends and falls back otherwise', () => {
    expect(sanitizeTimeRange({ from: 1, to: null })).toEqual({ from: 1, to: null });
    for (const bad of ['x', null, undefined, 5, { from: 'a' }, { from: 1 }, { from: NaN, to: null }]) {
      expect(sanitizeTimeRange(bad)).toEqual({ from: null, to: null });
    }
  });
});

describe('cropToChartRange', () => {
  const full = bars(10); // times 1000..1900
  it('slices inclusively when both ends hit a bar', () => {
    const r = cropToChartRange(full, { from: 1200, to: 1500 });
    expect(r.ok && r.slice.map((c) => c.time)).toEqual([1200, 1300, 1400, 1500]);
  });
  it('an open end is the data edge', () => {
    const a = cropToChartRange(full, { from: null, to: 1100 });
    expect(a.ok && a.slice.map((c) => c.time)).toEqual([1000, 1100]);
    const b = cropToChartRange(full, { from: 1800, to: null });
    expect(b.ok && b.slice.map((c) => c.time)).toEqual([1800, 1900]);
  });
  it('is outside when From is before the first bar or To after the last', () => {
    expect(cropToChartRange(full, { from: 999, to: null })).toEqual({ ok: false, error: 'outside' });
    expect(cropToChartRange(full, { from: null, to: 1901 })).toEqual({ ok: false, error: 'outside' });
    expect(cropToChartRange([], { from: 1, to: 2 })).toEqual({ ok: false, error: 'outside' });
  });
  it('From later than To', () => {
    expect(cropToChartRange(full, { from: 1500, to: 1200 })).toEqual({ ok: false, error: 'from-after-to' });
  });
  it('a one-bar window is too few bars', () => {
    expect(cropToChartRange(full, { from: 1200, to: 1200 })).toEqual({ ok: false, error: 'too-few-bars' });
    expect(cropToChartRange(full, { from: 1210, to: 1290 })).toEqual({ ok: false, error: 'too-few-bars' });
  });
  it('has its own error wording', () => {
    expect(chartRangeErrorText('outside')).toBe('Range is outside the loaded data - load more bars first');
    expect(chartRangeErrorText('from-after-to')).toBe('From is later than To');
    expect(chartRangeErrorText('too-few-bars')).toBe('Fewer than 2 bars in the chart range');
  });
});
