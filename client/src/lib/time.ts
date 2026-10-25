/** Pure timezone helpers built on Intl. Every function names its zone, so results never depend on the machine's TZ. */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function browserTimeZone(): string {
  const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(tz) ? tz : 'UTC';
}

/** UTC first, then every IANA zone the runtime knows (without a duplicate UTC). */
export function listTimeZones(): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [];
  }
  return ['UTC', ...zones.filter((z) => z !== 'UTC')];
}

/** Offset of the zone from UTC in minutes at the given UTC second (east is positive). */
export function zoneOffsetMinutes(tz: string, atSec: number): number {
  const ms = Math.floor(atSec) * 1000;
  const p: Record<string, number> = {};
  for (const part of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - ms) / 60000);
}

/** "+03:30", "-05:00", "+00:00". */
export function fmtOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export interface FormatInZoneOptions {
  dateOnly?: boolean;
}

const outCache = new Map<string, Intl.DateTimeFormat>();

/** en-GB "12 Dec 2012, 14:00" (or "12 Dec 2012" with dateOnly) in the zone. */
export function formatInZone(sec: number, tz: string, opts: FormatInZoneOptions = {}): string {
  const key = `${tz}|${opts.dateOnly ? 'd' : 'dt'}`;
  let f = outCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      ...(opts.dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }),
    });
    outCache.set(key, f);
  }
  return f.format(new Date(sec * 1000));
}

/** Short clock text, e.g. "14:05 UTC" or "09:05 GMT-5" (zone short name from Intl). */
export function fmtClock(sec: number, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(new Date(sec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('timeZoneName')}`;
}

/**
 * Wall-clock time in a zone to UTC seconds (month is 1-12).
 * In a skipped DST hour the result moves forward to the first valid time (02:30 becomes 03:30 when
 * clocks jump 02:00 to 03:00); in a repeated hour it picks the earlier instant.
 */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, h, min) / 1000;
  // Candidate offsets just before and after the wall time cover every transition.
  const offs = new Set([zoneOffsetMinutes(tz, wall - 86400), zoneOffsetMinutes(tz, wall + 86400)]);
  const valid: number[] = [];
  for (const o of offs) {
    const t = wall - o * 60;
    if (zoneOffsetMinutes(tz, t) === o) valid.push(t);
  }
  if (valid.length > 0) return Math.min(...valid);
  // Skipped hour: interpret with the offset before the jump, which lands after the gap.
  return wall - zoneOffsetMinutes(tz, wall - 86400) * 60;
}

const tickCache = new Map<string, Intl.DateTimeFormat>();
function tickFmt(tz: string, kind: 'year' | 'month' | 'day' | 'time' | 'timeSec'): Intl.DateTimeFormat {
  const key = `${tz}|${kind}`;
  let f = tickCache.get(key);
  if (!f) {
    const o: Intl.DateTimeFormatOptions = { timeZone: tz };
    if (kind === 'year') o.year = 'numeric';
    else if (kind === 'month') o.month = 'short';
    else if (kind === 'day') o.day = 'numeric';
    else {
      o.hour = '2-digit';
      o.minute = '2-digit';
      o.hourCycle = 'h23';
      if (kind === 'timeSec') o.second = '2-digit';
    }
    f = new Intl.DateTimeFormat('en-GB', o);
    tickCache.set(key, f);
  }
  return f;
}

/** Time-axis tick label for lightweight-charts' TickMarkType (0 Year, 1 Month, 2 DayOfMonth, 3 Time, 4 TimeWithSeconds). */
export function fmtTick(sec: number, tickMarkType: number, tz: string): string {
  const kinds = ['year', 'month', 'day', 'time', 'timeSec'] as const;
  return tickFmt(tz, kinds[tickMarkType] ?? 'time').format(new Date(sec * 1000));
}
