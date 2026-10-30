import type { Candle } from '../types';

/** How a chart's history loads: `scroll` opens on the latest page and pages older bars in; `all` loads everything at once. */
export type HistoryLoading = 'scroll' | 'all';

/** Bars per page in `scroll` mode: the first load and every older page. */
export const HISTORY_PAGE_BARS = 1000;

/** A technical guard: paging stops once this many bars are loaded. */
export const HISTORY_MAX_BARS = 200000;

/** How near the left edge may come to the first loaded bar (in bars) before the next older page is asked for. */
export const HISTORY_PREFETCH_BARS = 100;

/** The request for the page just before the first loaded bar (the span ends one second before it). */
export function nextPageRequest(firstTime: number): { bars: number; to: number } {
  return { bars: HISTORY_PAGE_BARS, to: firstTime - 1 };
}

/** The reply holds no bar older than the first loaded one: the provider's history starts there. */
export function isHistoryStart(reply: Candle[], firstTime: number): boolean {
  return !reply.some((c) => c.time < firstTime);
}

/** The guard: another page may be asked for only below the bar cap. */
export function belowHistoryCap(loaded: number): boolean {
  return loaded < HISTORY_MAX_BARS;
}
