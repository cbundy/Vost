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

/** Merge candles into a series by time: a bar with the same time is replaced, others are added; the result is sorted. */
export function mergeCandles(candles: Candle[], incoming: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) byTime.set(c.time, c);
  for (const c of incoming) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
