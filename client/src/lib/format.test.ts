import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtDataRange, fmtTime } from './format';

const a = 1355320800;
const b = 1580846400;

describe('fmtDataRange', () => {
  afterEach(() => vi.useRealTimers());

  it('formats a normal range', () => {
    expect(fmtDataRange(a, b, 4987)).toBe(`${fmtTime(a)} → ${fmtTime(b)} · 4,987 bars`);
  });
  it('handles a single bar', () => {
    expect(fmtDataRange(a, a, 1)).toBe(`${fmtTime(a)} → ${fmtTime(a)} · 1 bar`);
  });
  it('uses injected now when live', () => {
    const now = 1761429000;
    expect(fmtDataRange(a, b, 4987, { live: true, now })).toBe(`${fmtTime(a)} → now ${fmtTime(now)} · 4,987 bars`);
  });
  it('defaults now to the current time when live', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1761429000 * 1000));
    expect(fmtDataRange(a, b, 2, { live: true })).toBe(`${fmtTime(a)} → now ${fmtTime(1761429000)} · 2 bars`);
  });
  it('returns empty without data', () => {
    expect(fmtDataRange(a, b, 0)).toBe('');
    expect(fmtDataRange(null, b, 5)).toBe('');
    expect(fmtDataRange(a, undefined, 5)).toBe('');
  });
});

describe('fmtTime in an explicit zone', () => {
  it('formats UTC and Tehran', () => {
    expect(fmtTime(a, { timeZone: 'UTC' })).toBe('12 Dec 2012, 14:00');
    expect(fmtTime(a, { timeZone: 'Asia/Tehran' })).toBe('12 Dec 2012, 17:30');
  });

  it('dateOnly crosses the date line with the zone', () => {
    const t = Date.UTC(2024, 0, 1, 23, 0) / 1000;
    expect(fmtTime(t, { timeZone: 'UTC', dateOnly: true })).toBe('01 Jan 2024');
    expect(fmtTime(t, { timeZone: 'Asia/Tehran', dateOnly: true })).toBe('02 Jan 2024');
  });

  it('fmtDataRange takes the zone', () => {
    expect(fmtDataRange(a, b, 2, { timeZone: 'UTC' })).toBe('12 Dec 2012, 14:00 → 04 Feb 2020, 20:00 · 2 bars');
    expect(fmtDataRange(a, b, 2, { timeZone: 'Asia/Tehran' })).toBe('12 Dec 2012, 17:30 → 04 Feb 2020, 23:30 · 2 bars');
  });
});
