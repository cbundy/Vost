import type { Candle } from '../types';
import { MIN_RANGE_BARS, sliceByTimeRange, toZonedInputValue } from './timeRange';
import { zonedTimeToUtc } from './time';
import { canonicalInterval, parseInterval } from '../../../shared/market.ts';

export type QuickRangeKey = '1D' | '5D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'All';

export const QUICK_RANGES: { key: QuickRangeKey; label: string; title: string }[] = [
  { key: '1D', label: '1D', title: 'Show the last day' },
  { key: '5D', label: '5D', title: 'Show the last 5 days' },
  { key: '1M', label: '1M', title: 'Show the last month' },
  { key: '3M', label: '3M', title: 'Show the last 3 months' },
  { key: '6M', label: '6M', title: 'Show the last 6 months' },
  { key: 'YTD', label: 'YTD', title: 'Show the year to date' },
  { key: '1Y', label: '1Y', title: 'Show the last year' },
  { key: '5Y', label: '5Y', title: 'Show the last 5 years' },
  { key: 'All', label: 'All', title: 'Show all loaded bars' },
];

const MONTHS_BACK: Partial<Record<QuickRangeKey, number>> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '5Y': 60 };
const DAYS_BACK: Partial<Record<QuickRangeKey, number>> = { '1D': 1, '5D': 5 };

/** The window of a quick range ending at the last bar; from is null for All. Anchored on the wall clock in the zone. */
export function quickRangeWindow(
  key: QuickRangeKey,
  lastTime: number,
  timeZone: string,
): { from: number | null; to: number } {
  if (key === 'All') return { from: null, to: lastTime };
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(toZonedInputValue(lastTime, timeZone));
  if (!m) return { from: null, to: lastTime };
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (key === 'YTD') return { from: zonedTimeToUtc(y, 1, 1, 0, 0, timeZone), to: lastTime };
  const days = DAYS_BACK[key];
  if (days != null) {
    const t = new Date(Date.UTC(y, mo - 1, d - days));
    return {
      from: zonedTimeToUtc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), h, mi, timeZone),
      to: lastTime,
    };
  }
  const months = MONTHS_BACK[key] ?? 0;
  const total = y * 12 + (mo - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return { from: zonedTimeToUtc(ty, tm + 1, Math.min(d, lastDay), h, mi, timeZone), to: lastTime };
}

export interface QuickRangeState {
  enabled: boolean;
  /** The window starts at or before the first bar, so the whole loaded series shows. */
  showAll: boolean;
  from: number | null;
  to: number | null;
  /** The window starts before the first loaded bar and older pages may still come: clicking loads them first. */
  needsOlder: boolean;
}

/**
 * The state of a quick range. With `canPage` (older pages may still load) a window that starts before the first loaded bar
 * is enabled and `needsOlder`; without it such a window shows all loaded bars. `All` never pages.
 */
export function quickRangeState(key: QuickRangeKey, candles: Candle[], timeZone: string, canPage = false): QuickRangeState {
  if (candles.length === 0) return { enabled: false, showAll: false, from: null, to: null, needsOlder: false };
  const last = candles[candles.length - 1].time;
  const { from, to } = quickRangeWindow(key, last, timeZone);
  if (from == null) return { enabled: candles.length >= MIN_RANGE_BARS, showAll: true, from, to, needsOlder: false };
  const showAll = from <= candles[0].time;
  if (canPage && from < candles[0].time) return { enabled: true, showAll, from, to, needsOlder: true };
  const count = showAll ? candles.length : sliceByTimeRange(candles, { from, to }).length;
  return { enabled: count >= MIN_RANGE_BARS, showAll, from, to, needsOlder: false };
}

const RESET_RANGE: Record<string, QuickRangeKey> = { m: '1D', h: '5D', d: '1M' };

/** The quick range Reset view shows for a timeframe: minutes the last day, hours 5 days, days a month, weeks, months and unknown all data. */
export function resetRangeKey(timeframe: string): QuickRangeKey {
  const iv = canonicalInterval(timeframe);
  const p = iv ? parseInterval(iv) : null;
  return (p && RESET_RANGE[p.unit]) || 'All';
}

/**
 * The logical bar range Reset view shows for a timeframe, or null to fit all data (All, fewer than the minimum bars in the
 * window, or loaded bars that do not reach back that far). The range ends `rightOffset` bars past the last bar.
 */
export function resetLogicalRange(
  timeframe: string,
  candles: Candle[],
  timeZone: string,
  rightOffset: number,
): { from: number; to: number } | null {
  const key = resetRangeKey(timeframe);
  if (key === 'All') return null;
  const q = quickRangeState(key, candles, timeZone);
  if (!q.enabled || q.showAll || q.from == null) return null;
  const from = q.from;
  const first = candles.findIndex((c) => c.time >= from);
  if (first < 0) return null;
  return { from: first, to: candles.length - 1 + rightOffset };
}

/** The time a quick range reaches back to when that is before the first loaded bar (older pages are needed), else null. */
export function historyNeededFrom(key: QuickRangeKey, candles: Candle[], timeZone: string): number | null {
  if (candles.length === 0 || key === 'All') return null;
  const { from } = quickRangeWindow(key, candles[candles.length - 1].time, timeZone);
  return from != null && from < candles[0].time ? from : null;
}
