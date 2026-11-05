/** Highlighted trades to bar marks by time, and how well a signal series reproduces them. */
import type { Signal } from '../../lib/backtest/types';
import type { Candle } from '../../types';
import type { HighlightTrade, MatchScore, SearchDirection, SkippedTrade } from './types';

export interface Marks {
  entries: number[];
  exits: number[];
}

/** Index of the last bar whose time is at or before `t`, or -1 when `t` is before the first bar. */
export function barAtOrBefore(candles: Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface SeriesMarks {
  marks: Marks;
  used: number;
}

/**
 * Maps one series' highlighted trades to bars. A trade outside the series, with an exit before its entry, or on a
 * side the search direction does not cover is added to `skipped` with the reason.
 */
export function marksFromTrades(
  candles: Candle[],
  trades: HighlightTrade[],
  seriesIndex: number,
  direction: SearchDirection,
  skipped: SkippedTrade[],
): SeriesMarks {
  const entries: number[] = [];
  const exits: number[] = [];
  let used = 0;
  const first = candles[0]?.time;
  const last = candles[candles.length - 1]?.time;
  trades.forEach((t, index) => {
    const skip = (reason: string): void => {
      skipped.push({ series: seriesIndex, index, reason });
    };
    if (!Number.isFinite(t.entryTime) || !Number.isFinite(t.exitTime)) return skip('time is not a number');
    if (t.exitTime < t.entryTime) return skip('exit is before entry');
    if (first == null || last == null || t.entryTime < first || t.exitTime > last) return skip('outside the series (no bars at its times)');
    if (direction !== 'both' && t.side !== direction) return skip(`${t.side} trade, but the search direction is ${direction}`);
    entries.push(barAtOrBefore(candles, t.entryTime));
    exits.push(barAtOrBefore(candles, t.exitTime));
    used++;
  });
  entries.sort((a, b) => a - b);
  exits.sort((a, b) => a - b);
  return { marks: { entries, exits }, used };
}

/** Marks below `bar`. */
export function marksBefore(m: Marks, bar: number): Marks {
  return { entries: m.entries.filter((b) => b < bar), exits: m.exits.filter((b) => b < bar) };
}

/**
 * Bars where a signal series opens and closes a position, as the bars the trade fills on (the signal of bar i
 * is filled at the open of bar i + 1). A flip from long to short is an exit and an entry. Null counts as flat.
 */
export function marksOf(signals: Signal[]): Marks {
  const entries: number[] = [];
  const exits: number[] = [];
  const n = signals.length;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const cur = signals[i] ?? 0;
    if (cur !== prev) {
      if (i + 1 < n) {
        if (prev !== 0) exits.push(i + 1);
        if (cur !== 0) entries.push(i + 1);
      }
    }
    prev = cur;
  }
  return { entries, exits };
}

/** Greedy one-to-one match of two sorted bar lists within a tolerance. */
export function matchCount(found: number[], truth: number[], tol: number): number {
  let i = 0;
  let j = 0;
  let hit = 0;
  while (i < found.length && j < truth.length) {
    const d = found[i] - truth[j];
    if (Math.abs(d) <= tol) {
      hit++;
      i++;
      j++;
    } else if (d < 0) i++;
    else j++;
  }
  return hit;
}

export interface MatchTally {
  hits: number;
  found: number;
  truth: number;
}

export function tally(found: Marks, truth: Marks, tol: number): MatchTally {
  return {
    hits: matchCount(found.entries, truth.entries, tol) + matchCount(found.exits, truth.exits, tol),
    found: found.entries.length + found.exits.length,
    truth: truth.entries.length + truth.exits.length,
  };
}

/** F1 of the summed tallies of every series, so two series score as the sum of their matches. */
export function scoreOf(tallies: MatchTally[]): MatchScore {
  let hits = 0;
  let found = 0;
  let truth = 0;
  for (const t of tallies) {
    hits += t.hits;
    found += t.found;
    truth += t.truth;
  }
  const precision = found ? hits / found : 0;
  const recall = truth ? hits / truth : 0;
  return { f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, precision, recall };
}
