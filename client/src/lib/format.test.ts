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
