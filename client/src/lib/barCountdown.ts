import type { Interval } from '../../../shared/market';
import { parseInterval } from '../../../shared/market';
import { intervalEndMs } from './pine/marketFeed';

/** Whole seconds left in the bar opening at `lastOpenSec`, or null when there is no bar, the timeframe is unknown or the bar's end is not ahead of `nowMs`. */
export function barCountdownSeconds(lastOpenSec: number | null | undefined, timeframe: string, nowMs: number): number | null {
  if (lastOpenSec == null || !Number.isFinite(lastOpenSec) || !parseInterval(timeframe as Interval)) return null;
  const left = Math.ceil((intervalEndMs(lastOpenSec * 1000, timeframe as Interval) - nowMs) / 1000);
  return left > 0 ? left : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `MM:SS` under an hour, `HH:MM:SS` under a day, else `Nd HHh`. */
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 3600) return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  if (s < 86400) return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return `${Math.floor(s / 86400)}d ${pad(Math.floor((s % 86400) / 3600))}h`;
}
