/**
 * Built timeframes: a provider that lacks a timeframe can still offer it when
 * a lower native timeframe nests exactly in it. This module chooses the base
 * timeframe and aggregates base bars into bars of the target timeframe. Erasable
 * TypeScript only, and no imports outside `shared/`.
 *
 * Calendar rules (what an exchange would print):
 * - UTC (crypto): intraday and daily buckets are `floor(t / seconds) * seconds`,
 *   weeks start on Monday 00:00 UTC, months on the 1st 00:00 UTC.
 * - Session (stocks): a trading day is the exchange-local date; intraday buckets
 *   are counted from that day's regular session open (so a 9:30 ET open gives
 *   4h buckets 9:30-13:30 and 13:30-16:00); days, weeks and months are stamped
 *   at the session open of their first day. DST follows the exchange time zone.
 * A built bar is stamped at its bucket start.
 */
import { TIMEFRAMES, TIMEFRAME_SECONDS, type Candle, type Timeframe } from './market.ts';

/** How the buckets of a built timeframe are laid out in time. */
export type Calendar =
  | { kind: 'utc' }
  | {
      kind: 'session';
      /** IANA name of the exchange time zone, e.g. `America/New_York`. */
      timeZone: string;
      /** Regular session open, in seconds after the exchange-local midnight (9:30 is 34200). */
      openSeconds: number;
    };

export const UTC_CALENDAR: Calendar = { kind: 'utc' };

const DAY = 86400;

/** Seconds a bucket of `tf` can span at most (a month is 31 days here, unlike `TIMEFRAME_SECONDS`). */
export function bucketSecondsMax(tf: Timeframe): number {
  return tf === '1M' ? 31 * DAY : TIMEFRAME_SECONDS[tf];
}

/**
 * The timeframe `target` is built from: the largest native timeframe below it
 * whose bars nest exactly in it. Intraday and daily targets need the target to
 * be a whole multiple of the base; a week or a month is built from days or
 * lower (a month never from weeks). Null when `target` is native or nothing
 * nests.
 */
export function baseTimeframe(native: readonly Timeframe[], target: Timeframe): Timeframe | null {
  if (native.includes(target)) return null;
  const targetSeconds = TIMEFRAME_SECONDS[target];
  let best: Timeframe | null = null;
  for (const tf of TIMEFRAMES) {
    const seconds = TIMEFRAME_SECONDS[tf];
    if (!native.includes(tf) || seconds >= targetSeconds) continue;
    const nests = target === '1w' || target === '1M' ? seconds <= DAY : targetSeconds % seconds === 0;
    if (nests && (best === null || seconds > TIMEFRAME_SECONDS[best])) best = tf;
  }
  return best;
}

/** The timeframes a provider with these native timeframes can add, in `TIMEFRAMES` order. */
export function builtTimeframes(native: readonly Timeframe[]): Timeframe[] {
  return TIMEFRAMES.filter((tf) => baseTimeframe(native, tf) !== null);
}

/* ------------------------------ time zones ------------------------------- */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Seconds the zone is ahead of UTC at unix time `t`. */
function zoneOffset(t: number, timeZone: string): number {
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(t * 1000))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - t;
}

/** The exchange-local calendar date of unix time `t`, as days since 1970-01-01 of that civil date. */
function localDay(t: number, timeZone: string): number {
  return Math.floor((t + zoneOffset(t, timeZone)) / DAY);
}

/** Unix time of `secondsOfDay` on the local civil date `day` (days since 1970-01-01) in the zone. */
function zonedTime(day: number, secondsOfDay: number, timeZone: string): number {
  const wall = day * DAY + secondsOfDay;
  let t = wall - zoneOffset(wall, timeZone);
  t = wall - zoneOffset(t, timeZone);
  return t;
}

/** The Monday on or before the civil date `day` (days since 1970-01-01, a Thursday). */
function mondayOf(day: number): number {
  return day - (((day + 3) % 7) + 7) % 7;
}

function firstOfMonth(day: number): number {
  const d = new Date(day * DAY * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / (DAY * 1000);
}

/** Start of the `target` bucket holding unix time `t`. */
export function bucketStart(t: number, target: Timeframe, calendar: Calendar = UTC_CALENDAR): number {
  const seconds = TIMEFRAME_SECONDS[target];
  if (calendar.kind === 'utc') {
    if (target === '1w') return mondayOf(Math.floor(t / DAY)) * DAY;
    if (target === '1M') return firstOfMonth(Math.floor(t / DAY)) * DAY;
    return Math.floor(t / seconds) * seconds;
  }
  const { timeZone, openSeconds } = calendar;
  const day = localDay(t, timeZone);
  if (target === '1w') return zonedTime(mondayOf(day), openSeconds, timeZone);
  if (target === '1M') return zonedTime(firstOfMonth(day), openSeconds, timeZone);
  const open = zonedTime(day, openSeconds, timeZone);
  if (target === '1d') return open;
  return open + Math.floor((t - open) / seconds) * seconds;
}

/**
 * Aggregates ascending base bars into `target` bars: open of the first, close
 * of the last, highest high, lowest low, summed volume, stamped at the bucket
 * start. A gap inside a bucket just leaves that bucket with the bars present.
 * Every bucket is returned, the oldest and newest possibly partial: the caller
 * decides which to keep.
 */
export function buildBars(base: readonly Candle[], target: Timeframe, calendar: Calendar = UTC_CALENDAR): Candle[] {
  const out: Candle[] = [];
  for (const c of base) {
    const start = bucketStart(c.time, target, calendar);
    const last = out[out.length - 1];
    if (last && last.time === start) {
      if (c.high > last.high) last.high = c.high;
      if (c.low < last.low) last.low = c.low;
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ time: start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    }
  }
  return out;
}
