/**
 * Custom intervals: the list a person adds from the timeframe picker, which
 * ones a provider can serve, and the order the picker shows them in. The
 * grammar (what an interval is, its canonical spelling, its length) is shared
 * with the server in shared/market.ts.
 */
import { INTERVAL_MAX, canonicalInterval, intervalSeconds, parseInterval, TIMEFRAMES, type Interval, type IntervalUnit } from '../../../shared/market.ts';
import { baseTimeframe, sourceBase, type Source } from '../../../shared/timeframes.ts';
import type { Timeframe } from '../types';
import type { DataProvider } from './providers/http';

/** The most custom intervals the app keeps. */
export const MAX_CUSTOM_TIMEFRAMES = 20;

const UNIT_NAMES: Record<IntervalUnit, string> = { m: 'Minutes', h: 'Hours', d: 'Days', w: 'Weeks', M: 'Months' };
export const INTERVAL_UNITS: { unit: IntervalUnit; label: string }[] = (['m', 'h', 'd', 'w', 'M'] as const).map((unit) => ({ unit, label: UNIT_NAMES[unit] }));

/** Saved data to a clean list: canonical valid intervals only, duplicates collapsed, at most 20. Anything else is dropped. */
export function sanitizeCustomTimeframes(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) return [];
  const out: Interval[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || canonicalInterval(item) !== item || out.includes(item as Interval)) continue;
    out.push(item as Interval);
    if (out.length >= MAX_CUSTOM_TIMEFRAMES) break;
  }
  return out;
}

const nativeOf = (provider: DataProvider): Timeframe[] => provider.timeframes.filter((tf) => !(provider.builtTimeframes ?? []).includes(tf));

/** Whether the provider can load this interval: a valid canonical one that it serves, builds, or (the demo) generates. */
export function servable(provider: DataProvider, iv: string): boolean {
  if (canonicalInterval(iv) !== iv) return false;
  if (provider.offline) return true;
  if ((provider.timeframes as readonly string[]).includes(iv)) return true;
  return baseTimeframe(nativeOf(provider), iv as Interval) !== null;
}

export interface PickerEntry {
  interval: Interval;
  /** The timeframe it is built from, or null when the provider serves it itself. */
  base: Timeframe | null;
  custom: boolean;
}

/** The picker's entries: the provider's timeframes plus every saved interval it can serve, shortest bar first (ties keep the nine first). */
export function pickerTimeframes(provider: DataProvider, custom: readonly Interval[], source: Source): PickerEntry[] {
  const native = nativeOf(provider);
  const nine: PickerEntry[] = TIMEFRAMES.filter((tf) => provider.timeframes.includes(tf)).map((tf) => ({
    interval: tf,
    base: sourceBase(native, tf, source),
    custom: false,
  }));
  const extra: PickerEntry[] = [];
  for (const iv of custom) {
    if (nine.some((e) => e.interval === iv) || extra.some((e) => e.interval === iv) || !servable(provider, iv)) continue;
    extra.push({ interval: iv, base: provider.offline ? null : sourceBase(native, iv, source), custom: true });
  }
  return [...nine, ...extra].sort((a, b) => intervalSeconds(a.interval) - intervalSeconds(b.interval));
}

/** The canonical interval for what was typed, or the message to show. `listed` are the intervals already in the picker. */
export function validateNewInterval(
  n: number,
  unit: IntervalUnit,
  provider: DataProvider,
  listed: readonly Interval[],
  source: Source = 'native',
): { interval: Interval; base: Timeframe | null } | { error: string } {
  const raw = `${n}${unit}`;
  if (!Number.isInteger(n) || n < 1) return { error: 'Enter a whole number of 1 or more.' };
  if (!parseInterval(raw)) return { error: `${UNIT_NAMES[unit]} go up to ${INTERVAL_MAX[unit]}.` };
  const interval = canonicalInterval(raw)!;
  if (listed.includes(interval)) return { error: `${interval} is already in the picker.` };
  if (!servable(provider, interval)) return { error: `${provider.name} cannot build ${interval}.` };
  return { interval, base: provider.offline ? null : sourceBase(nativeOf(provider), interval, source) };
}
