import { MAX_BARS, rangeBarCount } from '../../../shared/market.ts';
import type { Candle, Interval } from '../types';

/** How a chart's history loads: `scroll` opens on the latest page and pages older bars in; `all` loads everything at once. */
export type HistoryLoading = 'scroll' | 'all';

/** Bars per page in `scroll` mode: the first load and every older page. */
export const HISTORY_PAGE_BARS = 1000;

/** A technical guard: paging stops once this many bars are loaded. */
export const HISTORY_MAX_BARS = 200000;

/** How near the left edge may come to the first loaded bar (in bars) before the next older page is asked for. */
export const HISTORY_PREFETCH_BARS = 100;

/** The request for the page just before the first loaded bar (the span ends one second before it). */
export function nextPageRequest(firstTime: number, bars: number = HISTORY_PAGE_BARS): { bars: number; to: number } {
  return { bars, to: firstTime - 1 };
}

/**
 * Bars per page for a run whose range starts at `from`, before the first loaded bar: the whole gap in one page where it
 * fits, else full pages of MAX_BARS; never fewer than a scroll page. A timeframe that cannot be parsed gets a scroll page.
 */
export function runPageBars(timeframe: Interval, from: number, first: number): number {
  try {
    const gap = rangeBarCount(timeframe, from, first - 1);
    return Math.min(MAX_BARS, Math.max(HISTORY_PAGE_BARS, gap));
  } catch {
    return HISTORY_PAGE_BARS;
  }
}

/** The reply holds no bar older than the first loaded one: the provider's history starts there. */
export function isHistoryStart(reply: Candle[], firstTime: number): boolean {
  return !reply.some((c) => c.time < firstTime);
}

/** The guard: another page may be asked for only below the bar cap. */
export function belowHistoryCap(loaded: number): boolean {
  return loaded < HISTORY_MAX_BARS;
}
