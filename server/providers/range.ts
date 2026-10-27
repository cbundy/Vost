/** Helpers for time-span ("range mode") history requests, shared by every adapter. */
import type { Candle, Timeframe } from '../../shared/market.ts';
import { NotFoundError } from './errors.ts';

/** The candles with `from <= time <= to` (both inclusive); either bound may be left out. */
export function cropToSpan(candles: Candle[], from?: number, to?: number): Candle[] {
  return candles.filter((c) => (from === undefined || c.time >= from) && (to === undefined || c.time <= to));
}

const iso = (sec: number): string => new Date(sec * 1000).toISOString();

/** The 404 for a span without a single candle. */
export function noDataInSpan(provider: string, symbol: string, timeframe: Timeframe, from: number, to: number): NotFoundError {
  return new NotFoundError(`${provider} has no ${symbol} ${timeframe} data from ${iso(from)} to ${iso(to)}`);
}

export { iso as isoTime };
