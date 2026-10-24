import type { Candle } from '../types';

/** Merge a live kline into the candle series: update the matching bar, append a newer one, ignore older ones. */
export function applyKline(candles: Candle[], candle: Candle): Candle[] {
  if (candles.length === 0) return [candle];
  const last = candles[candles.length - 1];
  if (candle.time === last.time) {
    const next = candles.slice();
    next[next.length - 1] = candle;
    return next;
  }
  if (candle.time > last.time) return [...candles, candle];
  return candles;
}
