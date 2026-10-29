/**
 * Built timeframes: a provider that lacks a timeframe can still offer it when
 * a lower native timeframe nests exactly in it. This module chooses the base
 * timeframe and aggregates base bars into bars of the target timeframe. Erasable
 * TypeScript only, and no imports outside `shared/`.
 *
 * Calendar rules (what an exchange would print):
 * - UTC (crypto): an m/h interval that divides a day is `floor(t / seconds) * seconds`;
 *   one shorter than a day that does not (7h) restarts at each UTC midnight; an h
 *   interval longer than a day (36h) counts from 1970-01-01. `Nd` counts N-day
 *   buckets from 1970-01-01, `Nw` N-week buckets from Monday 1970-01-05, `NM`
 *   N-month buckets from January 1970 (3M is calendar quarters, 12M years).
 * - Session (stocks): a trading day is the exchange-local date; m/h buckets of at
 *   most a day are counted from that day's regular session open (so a 9:30 ET
 *   open gives 4h buckets 9:30-13:30 and 13:30-16:00); `Nd`, `Nw` and `NM` count
 *   the same way over exchange-local civil days and are stamped at the session
 *   open of the bucket's first day; an h interval longer than a day uses the UTC
 *   rule. DST follows the exchange time zone.
 * A built bar is stamped at its bucket start.
 */
import { TIMEFRAMES, TIMEFRAME_SECONDS, intervalSeconds, parseInterval, type Candle, type Interval, type IntervalUnit, type Timeframe } from './market.ts';

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

const parsed = new Map<string, { n: number; unit: IntervalUnit }>();

/** The cached parse of an interval; throws on an invalid one. */
function parse(iv: Interval): { n: number; unit: IntervalUnit } {
  let p = parsed.get(iv);
  if (!p) {
    const q = parseInterval(iv);
    if (!q) throw new Error(`Invalid interval ${iv}`);
    parsed.set(iv, (p = q));
  }
  return p;
}

/** Seconds a bucket of `iv` can span at most (a month is 31 days here, unlike `intervalSeconds`). */
export function bucketSecondsMax(iv: Interval): number {
  const { n, unit } = parse(iv);
  if (unit === 'd') return n * DAY;
  if (unit === 'w') return 7 * n * DAY;
  if (unit === 'M') return 31 * n * DAY;
  return intervalSeconds(iv);
}

/**
 * The timeframe `target` is built from: the largest native timeframe below it
 * whose bars nest exactly in it. An m/h/d target needs a native timeframe of at
 * most a day whose seconds divide the target's; a week is built from any native
 * timeframe of at most a day (never native 1w); a month from one of at most a day
 * or native 1M. Null when `target` is native, invalid or nothing nests.
 */
export function baseTimeframe(native: readonly Timeframe[], target: Interval): Timeframe | null {
  if ((native as readonly string[]).includes(target)) return null;
  const p = parseInterval(target);
  if (!p) return null;
  const targetSeconds = intervalSeconds(target);
  let best: Timeframe | null = null;
  for (const tf of TIMEFRAMES) {
    const seconds = TIMEFRAME_SECONDS[tf];
    if (!native.includes(tf) || seconds >= targetSeconds) continue;
    const nests =
      p.unit === 'w' ? seconds <= DAY : p.unit === 'M' ? seconds <= DAY || tf === '1M' : seconds <= DAY && targetSeconds % seconds === 0;
    if (nests && (best === null || seconds > TIMEFRAME_SECONDS[best])) best = tf;
  }
  return best;
}

/** Where a chart's bars come from: the exchange's own, or built from the next lower native timeframe. */
export type Source = 'native' | 'built';

/** Parses a `source` query value: absent or `native` is native, `built` is built, anything else null. */
export function parseSource(raw: string | null | undefined): Source | null {
  if (raw == null || raw === '' || raw === 'native') return 'native';
  return raw === 'built' ? 'built' : null;
}

/**
 * The timeframe `target` is built from under `source`. Native: as `baseTimeframe`.
 * Built: a native timeframe above the lowest one is built too, from the next
 * lower native timeframe that nests. Null means the request is served native.
 */
export function sourceBase(native: readonly Timeframe[], target: Interval, source: Source): Timeframe | null {
  if (source === 'built' && (native as readonly string[]).includes(target)) {
    const lowest = native.reduce<Timeframe | null>((m, tf) => (m === null || TIMEFRAME_SECONDS[tf] < TIMEFRAME_SECONDS[m] ? tf : m), null);
    if (target === lowest) return null;
    return baseTimeframe(native.filter((tf) => tf !== target), target);
  }
  return baseTimeframe(native, target);
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

/** The first Monday on or before civil date `day`, counted in `weeks`-week buckets from Monday 1970-01-05 (day 4). */
function weekBucket(day: number, weeks: number): number {
  const span = 7 * weeks;
  return 4 + Math.floor((day - 4) / span) * span;
}

/** The first civil date (days since 1970-01-01) of the `months`-month bucket holding `day`, counted from January 1970. */
function monthBucket(day: number, months: number): number {
  const d = new Date(day * DAY * 1000);
  const index = (d.getUTCFullYear() - 1970) * 12 + d.getUTCMonth();
  return Date.UTC(1970, Math.floor(index / months) * months, 1) / (DAY * 1000);
}

/** Start of the `target` bucket holding unix time `t`. */
export function bucketStart(t: number, target: Interval, calendar: Calendar = UTC_CALENDAR): number {
  const { n, unit } = parse(target);
  const seconds = intervalSeconds(target);
  if (calendar.kind === 'utc') {
    const day = Math.floor(t / DAY);
    if (unit === 'd') return Math.floor(day / n) * n * DAY;
    if (unit === 'w') return weekBucket(day, n) * DAY;
    if (unit === 'M') return monthBucket(day, n) * DAY;
    if (seconds > DAY || DAY % seconds === 0) return Math.floor(t / seconds) * seconds;
    return day * DAY + Math.floor((t - day * DAY) / seconds) * seconds; // restarts at each UTC midnight
  }
  const { timeZone, openSeconds } = calendar;
  const day = localDay(t, timeZone);
  if (unit === 'd') return zonedTime(Math.floor(day / n) * n, openSeconds, timeZone);
  if (unit === 'w') return zonedTime(weekBucket(day, n), openSeconds, timeZone);
  if (unit === 'M') return zonedTime(monthBucket(day, n), openSeconds, timeZone);
  if (seconds > DAY) return Math.floor(t / seconds) * seconds;
  const open = zonedTime(day, openSeconds, timeZone);
  if (seconds === DAY) return open;
  return open + Math.floor((t - open) / seconds) * seconds;
}

/**
 * Aggregates ascending base bars into `target` bars: open of the first, close
 * of the last, highest high, lowest low, summed volume, stamped at the bucket
 * start. A gap inside a bucket just leaves that bucket with the bars present.
 * Every bucket is returned, the oldest and newest possibly partial: the caller
 * decides which to keep.
 */
export function buildBars(base: readonly Candle[], target: Interval, calendar: Calendar = UTC_CALENDAR): Candle[] {
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
