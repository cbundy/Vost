import type { OhlcBar } from '../drawingGeometry';

export type PatternBar = { open: number; high: number; low: number; close: number };

/** The loaded bars with a time from t0 to t1 inclusive (either order), ascending. */
export function sourceBars(candles: readonly OhlcBar[], t0: number, t1: number): OhlcBar[] {
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return [];
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  return candles.filter((c) => c.time >= lo && c.time <= hi);
}

/**
 * The bars a Bars pattern shows ahead, in copy order: the loaded bars between the two source times, optionally
 * mirrored (reversed in time, each bar's open and close swapped so the run reads as one continuous series) and/or
 * flipped (prices turned upside down around the copy's first open), then shifted so the copy's first open is
 * `startPrice`. Empty with no loaded bar in the run. Never throws.
 */
export function barsPatternCopy(
  candles: readonly OhlcBar[],
  t0: number,
  t1: number,
  startPrice: number,
  opts: { mirrored?: boolean; flipped?: boolean } = {},
): PatternBar[] {
  let bars: PatternBar[] = sourceBars(candles, t0, t1).map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close }));
  if (bars.length === 0 || !Number.isFinite(startPrice)) return [];
  if (opts.mirrored) bars = bars.reverse().map((b) => ({ open: b.close, high: b.high, low: b.low, close: b.open }));
  if (opts.flipped) {
    const pivot = bars[0].open;
    bars = bars.map((b) => ({ open: 2 * pivot - b.open, high: 2 * pivot - b.low, low: 2 * pivot - b.high, close: 2 * pivot - b.close }));
  }
  const shift = startPrice - bars[0].open;
  return bars.map((b) => ({ open: b.open + shift, high: b.high + shift, low: b.low + shift, close: b.close + shift }));
}
