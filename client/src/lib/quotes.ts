/** Watchlist quote math: pure, no I/O. */
import type { Candle } from '../../../shared/market.ts';

/** A quote is reused for this long before it is fetched again. */
export const QUOTE_MIN_AGE_MS = 60_000;
/** Daily bars the symbol card asks for (a little over a year). */
export const CARD_BARS = 260;
/** Daily bars a watchlist row asks for (only the last two are used). */
export const ROW_BARS = 5;

const DAY = 86_400;

export interface Quote {
  last: number;
  chg: number;
  chgPct: number;
}

/** Last close against the previous close; null with fewer than 2 bars or a zero previous close. */
export function quoteFromBars(bars: readonly Candle[] | null | undefined): Quote | null {
  if (!bars || bars.length < 2) return null;
  const last = bars[bars.length - 1].close;
  const prev = bars[bars.length - 2].close;
  if (!prev || !Number.isFinite(prev) || !Number.isFinite(last)) return null;
  const chg = last - prev;
  return { last, chg, chgPct: (chg / prev) * 100 };
}

/** The visible keys whose last fetch is missing or at least `minAgeMs` old. */
export function dueKeys(
  visible: Iterable<string>,
  lastFetched: Readonly<Record<string, number | undefined>>,
  now: number,
  minAgeMs: number = QUOTE_MIN_AGE_MS,
): string[] {
  const out: string[] = [];
  for (const k of visible) {
    const at = lastFetched[k];
    if (at === undefined || now - at >= minAgeMs) out.push(k);
  }
  return out;
}

export interface CardStats extends Quote {
  dayLow: number;
  dayHigh: number;
  /** Last bar volume over the average of the 30 bars before it; null when it cannot be computed. */
  volRatio: number | null;
  /** 52-week extremes; null unless the bars span at least 360 days. */
  high52: number | null;
  low52: number | null;
}

/** What can be computed for the symbol card from its daily bars; null without a usable quote. */
export function cardStats(dailyBars: readonly Candle[] | null | undefined, nowSec: number): CardStats | null {
  const q = quoteFromBars(dailyBars);
  if (!q || !dailyBars) return null;
  const bar = dailyBars[dailyBars.length - 1];

  let volRatio: number | null = null;
  const prior = dailyBars.slice(-31, -1);
  if (bar.volume > 0 && prior.length === 30 && prior.every((b) => b.volume > 0)) {
    volRatio = bar.volume / (prior.reduce((a, b) => a + b.volume, 0) / 30);
  }

  const year = dailyBars.filter((b) => b.time >= nowSec - 365 * DAY);
  let high52: number | null = null;
  let low52: number | null = null;
  if (year.length > 1 && year[year.length - 1].time - year[0].time >= 360 * DAY) {
    high52 = Math.max(...year.map((b) => b.high));
    low52 = Math.min(...year.map((b) => b.low));
  }
  return { ...q, dayLow: bar.low, dayHigh: bar.high, volRatio, high52, low52 };
}
