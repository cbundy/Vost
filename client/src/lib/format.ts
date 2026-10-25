/**
 * Number / date formatting helpers used across the UI.
 */
import { browserTimeZone, formatInZone } from './time';

export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (abs >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (abs >= 0.01) return v.toFixed(4);
  return v.toPrecision(6);
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

export function fmtMoney(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Formats in the given IANA zone; undefined means the browser zone. */
export function fmtTime(sec: number, opts: { dateOnly?: boolean; timeZone?: string } = {}): string {
  return formatInZone(sec, opts.timeZone ?? browserTimeZone(), { dateOnly: opts.dateOnly });
}

export function fmtDurationBarCount(bars: number): string {
  if (bars <= 0) return '0 bars';
  return bars === 1 ? '1 bar' : `${fmtNum(bars, 0)} bars`;
}

/** Loaded data span, e.g. "12 Dec 2012, 14:00 → 04 Feb 2020, 19:00 · 4,987 bars". Empty when there is no data. */
export function fmtDataRange(
  firstSec: number | null | undefined,
  lastSec: number | null | undefined,
  count: number,
  opts: { live?: boolean; now?: number; timeZone?: string } = {},
): string {
  if (count <= 0 || firstSec == null || lastSec == null) return '';
  const tz = { timeZone: opts.timeZone };
  const end = opts.live ? `now ${fmtTime(opts.now ?? Date.now() / 1000, tz)}` : fmtTime(lastSec, tz);
  return `${fmtTime(firstSec, tz)} → ${end} · ${fmtDurationBarCount(count)}`;
}

/** Human-readable bar interval, e.g. 3600 -> "1h". */
export function barLabelFromSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'custom';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = seconds / 60;
    return Number.isInteger(m) ? `${m}m` : `${m.toFixed(1)}m`;
  }
  if (seconds < 86400) {
    const h = seconds / 3600;
    return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
  }
  if (seconds < 86400 * 28) {
    const d = seconds / 86400;
    return Number.isInteger(d) ? `${d}d` : `${d.toFixed(1)}d`;
  }
  const mo = seconds / (86400 * 30.4375);
  return Number.isInteger(mo) ? `${mo}M` : `${mo.toFixed(1)}M`;
}

/** Class name helper for +/- values. */
export function pnlClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return '';
  return v > 0 ? 'pos' : 'neg';
}
