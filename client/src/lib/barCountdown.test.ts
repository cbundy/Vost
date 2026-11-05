import { describe, expect, it } from 'vitest';
import { barCountdownSeconds, fmtCountdown } from './barCountdown';

describe('barCountdownSeconds', () => {
  const open = Date.UTC(2024, 0, 10, 12, 0, 0) / 1000;
  it('counts a 1m bar opened 23 s ago', () => {
    expect(barCountdownSeconds(open, '1m', open * 1000 + 23000)).toBe(37);
  });
  it('counts a 1h bar', () => {
    expect(barCountdownSeconds(open, '1h', open * 1000 + 600000)).toBe(3000);
  });
  it('rounds a partial second up', () => {
    expect(barCountdownSeconds(open, '1m', open * 1000 + 23500)).toBe(37);
  });
  it('counts a month bar to the calendar month end', () => {
    const feb = Date.UTC(2024, 1, 1) / 1000;
    expect(barCountdownSeconds(feb, '1M', feb * 1000)).toBe(29 * 86400);
  });
  it('is null when the end is past or now', () => {
    expect(barCountdownSeconds(open, '1m', open * 1000 + 60000)).toBeNull();
    expect(barCountdownSeconds(open, '1m', open * 1000 + 90000)).toBeNull();
  });
  it('is null with no bar or a bad timeframe', () => {
    expect(barCountdownSeconds(null, '1m', 0)).toBeNull();
    expect(barCountdownSeconds(undefined, '1m', 0)).toBeNull();
    expect(barCountdownSeconds(open, 'zz', open * 1000)).toBeNull();
  });
});

describe('fmtCountdown', () => {
  it('formats by size', () => {
    expect(fmtCountdown(0)).toBe('00:00');
    expect(fmtCountdown(59)).toBe('00:59');
    expect(fmtCountdown(277)).toBe('04:37');
    expect(fmtCountdown(3599)).toBe('59:59');
    expect(fmtCountdown(3600)).toBe('01:00:00');
    expect(fmtCountdown(86399)).toBe('23:59:59');
    expect(fmtCountdown(86400)).toBe('1d 00h');
    expect(fmtCountdown(2 * 86400 + 5 * 3600 + 180)).toBe('2d 05h');
    expect(fmtCountdown(-5)).toBe('00:00');
  });
});
