import { describe, expect, it } from 'vitest';
import type { OhlcBar } from '../drawingGeometry';
import { anchoredVwap, barIndexAt, barVolume, inferTick, volumeProfile, volumeProfileRaw } from './volume';

const bar = (time: number, high: number, low: number, close: number, volume?: number, open = close): OhlcBar => ({ time, open, high, low, close, volume });
// hlc3: 10, 12, 15, 17 and highs 12, 15, 18, 20; volumes 1, 3, 0, 2.
const BARS = [bar(60, 12, 8, 10, 1), bar(120, 15, 9, 12, 3), bar(180, 18, 12, 15, 0), bar(240, 20, 14, 17, 2)];
const near = (a: number | null | undefined, b: number) => expect(a).toBeCloseTo(b, 9);

describe('barVolume', () => {
  it('counts a missing, negative or non-finite volume as zero', () => {
    expect([undefined, NaN, Infinity, -4, 5].map((v) => barVolume(bar(1, 2, 1, 1, v)))).toEqual([0, 0, 0, 0, 5]);
  });
});

describe('barIndexAt', () => {
  it('finds the bar holding a time and none outside the loaded bars', () => {
    expect([60, 100, 240, 250].map((t) => barIndexAt(BARS, t))).toEqual([0, 0, 3, 3]);
    expect([0, 59, 300, NaN].map((t) => barIndexAt(BARS, t))).toEqual([-1, -1, -1, -1]);
    expect(barIndexAt([], 5)).toBe(-1);
    expect([barIndexAt([bar(60, 2, 1, 1)], 60), barIndexAt([bar(60, 2, 1, 1)], 61)]).toEqual([0, -1]);
  });
});

describe('anchoredVwap', () => {
  it('is sum(src x vol) / sum(vol) with sigma bands, for hlc3', () => {
    const r = anchoredVwap(BARS, 60, 'hlc3', [1, 2])!;
    expect(r.first).toBe(0);
    [10, 11.5, 11.5, 80 / 6].forEach((v, i) => near(r.vwap[i], v));
    near(r.sigma[0], 0);
    // sigma at bar 1: sqrt((1 x 100 + 3 x 144) / 4 - 11.5^2) = sqrt(0.75).
    near(r.sigma[1], Math.sqrt(0.75));
    near(r.bands[0].upper[1], 11.5 + Math.sqrt(0.75));
    near(r.bands[1].lower[1], 11.5 - 2 * Math.sqrt(0.75));
  });

  it('follows the source setting', () => {
    const r = anchoredVwap(BARS, 60, 'high', [])!;
    [12, 14.25, 14.25, 97 / 6].forEach((v, i) => near(r.vwap[i], v));
  });

  it('starts at the anchor bar', () => {
    const r = anchoredVwap(BARS, 120, 'hlc3', [])!;
    expect(r.first).toBe(1);
    expect(r.vwap.length).toBe(3);
    near(r.vwap[0], 12);
    near(r.vwap[2], (36 + 34) / 5);
  });

  it('has no value before the first volume and keeps the VWAP over a zero-volume bar', () => {
    const lead = [bar(60, 12, 8, 10, 0), bar(120, 15, 9, 12, 2), bar(180, 18, 12, 15, 0)];
    const r = anchoredVwap(lead, 60, 'close', [1])!;
    expect(r.vwap).toEqual([null, 12, 12]);
    expect(r.bands[0].upper[0]).toBeNull();
    near(r.sigma[2], 0);
  });

  it('handles all-zero volume, one bar, no bars and an anchor outside the bars', () => {
    expect(anchoredVwap([bar(60, 2, 1, 1), bar(120, 2, 1, 1, NaN)], 60, 'close', [1])!.vwap).toEqual([null, null]);
    near(anchoredVwap([bar(60, 12, 8, 10, 4)], 60, 'close', [1])!.vwap[0], 10);
    expect(anchoredVwap([], 60, 'close', [1])).toBeNull();
    expect(anchoredVwap(BARS, 9999, 'close', [1])).toBeNull();
    expect(anchoredVwap(BARS, 1, 'close', [1])).toBeNull();
  });
});

// Bar A spans 0 to 6 (volume 6, up); bar B spans 4 to 10 (volume 12, down); 5 rows of 2.
const PROFILE = [bar(1, 6, 0, 5, 6, 1), bar(2, 10, 4, 5, 12, 9)];
const OPTS = { rows: 5, valueAreaPct: 70 };

describe('volumeProfile', () => {
  it('spreads each bar over the rows it covers in proportion and splits up from down volume', () => {
    const p = volumeProfile(PROFILE, 1, 2, OPTS)!;
    expect([p.low, p.high, p.rows.length]).toEqual([0, 10, 5]);
    expect(p.rows.map((r) => [r.low, r.high])).toEqual([[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]]);
    expect(p.rows.map((r) => [r.up, r.down])).toEqual([[2, 0], [2, 0], [2, 4], [0, 4], [0, 4]]);
    expect(p.rows.map((r) => r.total)).toEqual([2, 2, 6, 4, 4]);
    expect([p.total, p.maxTotal, p.poc]).toEqual([18, 6, 2]);
  });

  it('grows the value area from the point of control by the larger neighbour', () => {
    const p = volumeProfile(PROFILE, 1, 2, OPTS)!;
    // 70 percent of 18 is 12.6: 6, then the 4 above, then the 4 above again (14).
    expect([p.vaLowRow, p.vaHighRow, p.vaLow, p.vaHigh]).toEqual([2, 4, 4, 10]);
    const wide = volumeProfile(PROFILE, 1, 2, { ...OPTS, valueAreaPct: 100 })!;
    expect([wide.vaLow, wide.vaHigh]).toEqual([0, 10]);
    const narrow = volumeProfile(PROFILE, 1, 2, { ...OPTS, valueAreaPct: 1 })!;
    expect([narrow.vaLow, narrow.vaHigh]).toEqual([4, 6]);
  });

  it('puts a bar with high equal to low in its row', () => {
    const p = volumeProfile([bar(1, 10, 0, 5, 0), bar(2, 5, 5, 5, 7, 5)], 1, 2, OPTS)!;
    expect(p.rows.map((r) => r.total)).toEqual([0, 0, 7, 0, 0]);
    expect(p.rows[2].up).toBe(7);
    const top = volumeProfile([bar(1, 10, 0, 5, 0), bar(2, 10, 10, 5, 3, 5)], 1, 2, OPTS)!;
    expect(top.rows[4].total).toBe(3);
  });

  it('takes the lower row of a tie as the point of control', () => {
    const p = volumeProfile([bar(1, 2, 0, 1, 5), bar(2, 4, 2, 1, 5), bar(3, 4, 0, 1, 0)], 1, 3, { rows: 2, valueAreaPct: 50 })!;
    expect(p.rows.map((r) => r.total)).toEqual([5, 5]);
    expect(p.poc).toBe(0);
  });

  it('sizes rows by ticks per row', () => {
    const tick = [bar(1, 10, 0, 5, 1), bar(2, 5, 5, 5, 1)];
    expect(inferTick(tick)).toBe(1);
    expect(inferTick([bar(1, 10.25, 9.5, 10, 1)])).toBe(0.01);
    const p = volumeProfile(tick, 1, 2, { ticksPerRow: 2, valueAreaPct: 70 })!;
    expect(p.rows.length).toBe(5);
    expect(p.rows[0].high - p.rows[0].low).toBe(2);
  });

  it('gives the same result for reversed anchors and only the bars between them', () => {
    expect(volumeProfileRaw(PROFILE, 2, 1, OPTS)).toEqual(volumeProfileRaw(PROFILE, 1, 2, OPTS));
    const one = volumeProfile(PROFILE, 1, 1, OPTS)!;
    expect([one.low, one.high, one.total]).toEqual([0, 6, 6]);
  });

  it('has no point of control or value area with no volume, and no profile with no bars', () => {
    const p = volumeProfile([bar(1, 4, 0, 1), bar(2, 4, 0, 1, NaN)], 1, 2, OPTS)!;
    expect([p.total, p.poc, p.vaLow, p.vaHigh, p.maxTotal]).toEqual([0, -1, null, null, 0]);
    expect(volumeProfile([], 1, 2, OPTS)).toBeNull();
    expect(volumeProfile(PROFILE, 50, 60, OPTS)).toBeNull();
    const flat = volumeProfile([bar(1, 5, 5, 5, 4)], 1, 1, OPTS)!;
    expect([flat.rows.length, flat.total, flat.poc]).toEqual([5, 4, 0]);
  });
});

describe('the memo', () => {
  it('returns the same object for the same candles and inputs and a new one for a new candle array', () => {
    const a = volumeProfile(PROFILE, 1, 2, OPTS);
    expect(volumeProfile(PROFILE, 1, 2, OPTS)).toBe(a);
    expect(volumeProfile(PROFILE, 1, 2, { ...OPTS, rows: 6 })).not.toBe(a);
    const next = [...PROFILE];
    expect(volumeProfile(next, 1, 2, OPTS)).not.toBe(a);
    expect(anchoredVwap(BARS, 60, 'close', [1])).toBe(anchoredVwap(BARS, 60, 'close', [1]));
    expect(anchoredVwap(BARS, 60, 'close', [1])).not.toBe(anchoredVwap(BARS, 60, 'high', [1]));
  });
});
