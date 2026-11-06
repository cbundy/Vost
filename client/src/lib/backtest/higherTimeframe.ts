/**
 * Higher-timeframe bars built from the loaded bars, for the Composed filters. A higher bar is only
 * visible once it has closed by the clock at the current bar's close, so a filter never sees the future.
 */
import { canonicalInterval, type Interval } from '../../../../shared/market';
import { bucketStart, buildBars, UTC_CALENDAR } from '../../../../shared/timeframes';
import type { Candle } from '../../types';

/** Bar length in seconds of the candles themselves: the smallest gap among the first bars (a day when unknown). */
export function barSeconds(candles: Candle[]): number {
  let best = Infinity;
  for (let i = 1; i < Math.min(candles.length, 200); i++) {
    const g = candles[i].time - candles[i - 1].time;
    if (g > 0 && g < best) best = g;
  }
  return Number.isFinite(best) ? best : 86400;
}

/** `k` bars of `baseSeconds` as a canonical interval, written in the largest unit that divides it; null when invalid. */
export function multipleInterval(baseSeconds: number, k: number): Interval | null {
  const total = Math.round(baseSeconds) * Math.round(k);
  if (!Number.isFinite(total) || total <= 0 || total % 60 !== 0) return null;
  if (total % 86400 === 0) return canonicalInterval(`${total / 86400}d`);
  if (total % 3600 === 0) return canonicalInterval(`${total / 3600}h`);
  return canonicalInterval(`${total / 60}m`);
}

export interface HigherTimeframe {
  bars: Candle[];
  /** For each loaded bar, the index in `bars` of the newest higher bar closed at its close, or -1. */
  lastClosed: Int32Array;
}

/** Builds `interval` bars (UTC buckets) and maps every loaded bar to the newest higher bar closed at its close. */
export function higherTimeframe(candles: Candle[], interval: Interval): HigherTimeframe {
  const base = barSeconds(candles);
  let bars = buildBars(candles, interval, UTC_CALENDAR);
  // A partial first bucket is never used.
  if (bars.length > 0 && candles[0].time !== bars[0].time) bars = bars.slice(1);
  const index = new Map<number, number>();
  bars.forEach((b, k) => index.set(b.time, k));
  const lastClosed = new Int32Array(candles.length).fill(-1);
  for (let i = 0; i < candles.length; i++) {
    const t = candles[i].time;
    const s = bucketStart(t, interval, UTC_CALENDAR);
    const b = index.get(s);
    if (b === undefined) continue; // the dropped partial bucket
    lastClosed[i] = bucketStart(t + base, interval, UTC_CALENDAR) > s ? b : b - 1;
  }
  return { bars, lastClosed };
}

/** The multiples of the loaded bar length a setting may ask for (1 = the loaded bars). */
export const ATR_TIMEFRAME_MULTIPLES = [1, 2, 3, 4, 6, 8, 12, 24] as const;

/** The higher timeframe `k` times the loaded bars, or null to run on the loaded bars (k not above 1, no candles, bars a week or longer, an invalid multiple). */
export function higherOfMultiple(candles: Candle[], k: number): HigherTimeframe | null {
  if (!(k > 1) || candles.length === 0) return null;
  const base = barSeconds(candles);
  if (base >= 604800) return null;
  const iv = multipleInterval(base, k);
  return iv ? higherTimeframe(candles, iv) : null;
}
