import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { HISTORY_MAX_BARS, HISTORY_PAGE_BARS, belowHistoryCap, isHistoryStart, nextPageRequest } from './historyPaging';

const bar = (time: number): Candle => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 });

describe('historyPaging', () => {
  it('asks for one page ending just before the first loaded bar', () => {
    expect(nextPageRequest(5000)).toEqual({ bars: HISTORY_PAGE_BARS, to: 4999 });
    expect(HISTORY_PAGE_BARS).toBe(1000);
  });
  it('treats an empty reply or one with nothing older as the history start', () => {
    expect(isHistoryStart([], 100)).toBe(true);
    expect(isHistoryStart([bar(100), bar(200)], 100)).toBe(true);
    expect(isHistoryStart([bar(99), bar(100)], 100)).toBe(false);
  });
  it('stops paging at the cap', () => {
    expect(HISTORY_MAX_BARS).toBe(200000);
    expect(belowHistoryCap(HISTORY_MAX_BARS - 1)).toBe(true);
    expect(belowHistoryCap(HISTORY_MAX_BARS)).toBe(false);
  });
});
