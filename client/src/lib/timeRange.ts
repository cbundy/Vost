import type { Candle } from '../types';
import { zonedTimeToUtc } from './time';

/** A time window in UTC seconds, both ends inclusive; null means open. */
export type TimeRange = { from: number | null; to: number | null };

export const FULL_RANGE: TimeRange = { from: null, to: null };

/** Fewest bars a backtest needs. */
export const MIN_RANGE_BARS = 3;

export type TimeRangeError = 'from-after-to' | 'too-few-bars';

export interface TimeRangeInfo {
  slice: Candle[];
  count: number;
  total: number;
  error: TimeRangeError | null;
  /** From is set and lies before the first loaded bar. */
  clippedStart: boolean;
  /** To is set and lies after the last loaded bar. */
  clippedEnd: boolean;
}

/** Candles with from <= time <= to. The same array when both ends are open. */
export function sliceByTimeRange(candles: Candle[], range: TimeRange): Candle[] {
  const { from, to } = range;
  if (from == null && to == null) return candles;
  return candles.filter((c) => (from == null || c.time >= from) && (to == null || c.time <= to));
}

export function describeTimeRange(candles: Candle[], range: TimeRange): TimeRangeInfo {
  const slice = sliceByTimeRange(candles, range);
  const first = candles[0]?.time;
  const last = candles[candles.length - 1]?.time;
  const { from, to } = range;
  const fromAfterTo = from != null && to != null && from > to;
  return {
    slice,
    count: slice.length,
    total: candles.length,
    error: fromAfterTo ? 'from-after-to' : slice.length < MIN_RANGE_BARS ? 'too-few-bars' : null,
    clippedStart: from != null && first != null && from < first,
    clippedEnd: to != null && last != null && to > last,
  };
}

export function timeRangeErrorText(error: TimeRangeError): string {
  return error === 'from-after-to' ? 'From is later than To' : `Fewer than ${MIN_RANGE_BARS} bars in the backtest range`;
}

/** Fewest bars the chart range may leave on screen. */
export const CHART_MIN_BARS = 2;

export type ChartRangeError = 'outside' | 'from-after-to' | 'too-few-bars';

export type ChartCrop = { ok: true; slice: Candle[] } | { ok: false; error: ChartRangeError };

/** Crops the full loaded candles to a chart range (both ends inclusive; an open end is the data edge). */
export function cropToChartRange(full: Candle[], range: TimeRange): ChartCrop {
  const first = full[0]?.time;
  const last = full[full.length - 1]?.time;
  const { from, to } = range;
  if (first == null || last == null) return { ok: false, error: 'outside' };
  if ((from != null && from < first) || (to != null && to > last)) return { ok: false, error: 'outside' };
  if (from != null && to != null && from > to) return { ok: false, error: 'from-after-to' };
  const slice = sliceByTimeRange(full, range);
  if (slice.length < CHART_MIN_BARS) return { ok: false, error: 'too-few-bars' };
  return { ok: true, slice };
}

export function chartRangeErrorText(error: ChartRangeError): string {
  if (error === 'outside') return 'Range is outside the loaded data - load more bars first';
  if (error === 'from-after-to') return 'From is later than To';
  return `Fewer than ${CHART_MIN_BARS} bars in the chart range`;
}

/** "YYYY-MM-DDTHH:mm" wall clock of an instant in a zone (datetime-local value). */
export function toZonedInputValue(sec: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(sec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Parses a datetime-local value as wall clock in a zone; null when empty or malformed. */
export function fromZonedInputValue(value: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return zonedTimeToUtc(y, mo, d, h, mi, tz);
}

/** Anything that is not an object with number-or-null from/to becomes the open range. */
export function sanitizeTimeRange(v: unknown): TimeRange {
  if (typeof v !== 'object' || v === null) return { from: null, to: null };
  const o = v as Record<string, unknown>;
  const ok = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x));
  if (!ok(o.from) || !ok(o.to)) return { from: null, to: null };
  return { from: (o.from ?? null) as number | null, to: (o.to ?? null) as number | null };
}
