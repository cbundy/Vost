import type { Candle } from '../types';

/** Bars per second the replay can play at. */
export const REPLAY_SPEEDS = [1, 3, 10] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Fewest bars shown at the start of a replay. */
export const REPLAY_MIN_VISIBLE = 2;

/** A replay position over its source bars. */
export interface ReplayPosition {
  source: Candle[];
  cursor: number;
}

/**
 * The cursor for a replay that starts at `time`: the last bar at or before it, clamped so that at least
 * REPLAY_MIN_VISIBLE bars show and at least one is left to replay. Null when the time lies outside the
 * data (before the first bar or after the last) or the data is too short to replay.
 */
export function replayStartIndex(source: Candle[], time: number): number | null {
  if (source.length < REPLAY_MIN_VISIBLE + 1) return null;
  if (!Number.isFinite(time) || time < source[0].time || time > source[source.length - 1].time) return null;
  let lo = 0;
  let hi = source.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (source[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(REPLAY_MIN_VISIBLE - 1, Math.min(lo, source.length - 2));
}

/** The cursor after moving `delta` bars, kept inside the source. */
export function stepReplay(pos: ReplayPosition, delta: number): number {
  return Math.max(REPLAY_MIN_VISIBLE - 1, Math.min(pos.cursor + delta, pos.source.length - 1));
}

/** The bars shown at a cursor (the same array reference is never reused: it is a copy). */
export function replayVisible(source: Candle[], cursor: number): Candle[] {
  return source.slice(0, cursor + 1);
}

/** Milliseconds between two bars while playing. */
export function replayIntervalMs(speed: number): number {
  return 1000 / Math.max(1, speed);
}

export function replayAtEnd(pos: ReplayPosition): boolean {
  return pos.cursor >= pos.source.length - 1;
}

export function replayAtStart(pos: ReplayPosition): boolean {
  return pos.cursor <= REPLAY_MIN_VISIBLE - 1;
}

/** Whether a Pine run (computed on `runCandles`) reaches no further than the last visible bar. */
export function runFitsVisible(runCandles: Candle[] | undefined, lastVisibleTime: number | null): boolean {
  if (lastVisibleTime == null || !runCandles || runCandles.length === 0) return true;
  return runCandles[runCandles.length - 1].time <= lastVisibleTime;
}

/**
 * Whether a Pine run computed on `runCandles` is still true for `currentCandles`: the run's bars are a
 * prefix of the current ones (same first bar, same bar at the run's last index). A run that is a prefix
 * never reaches past the current bars, so keeping it shows no look-ahead.
 */
export function runIsPrefixOf(runCandles: Candle[], currentCandles: Candle[]): boolean {
  const n = runCandles.length;
  if (n === 0 || currentCandles.length < n) return false;
  return runCandles[0].time === currentCandles[0].time && runCandles[n - 1].time === currentCandles[n - 1].time;
}
