import { describe, expect, it } from 'vitest';
import { NotFoundError, UpstreamError } from './errors.ts';
import { parseStooqCsv, stooqAdapter } from './stooq.ts';
import { STOOQ_SYMBOLS } from './stooqSymbols.ts';
import { createSymbolCache } from './symbolCache.ts';
import type { FetchFn } from './upstream.ts';

const textFetch = (body: string, urls: string[] = []): FetchFn =>
  (async (input: string) => {
    urls.push(String(input));
    return new Response(body, { status: 200 });
  }) as unknown as FetchFn;
const ctx = (fetch: FetchFn) => ({ fetch, symbols: createSymbolCache() });

describe('stooq symbol list', () => {
  it('is large, unique and complete', async () => {
    const list = await stooqAdapter.listSymbols!(ctx(textFetch('')));
    expect(list).toBe(STOOQ_SYMBOLS);
    expect(list.length).toBeGreaterThan(200);
    expect(new Set(list.map((s) => s.symbol)).size).toBe(list.length);
    for (const s of list) {
      expect(s.exchange).toBeTruthy();
      expect(s.type).toBeTruthy();
      expect(s.label).toBeTruthy();
    }
  });
  it('finds spy.us by name', async () => {
    const r = await stooqAdapter.search(ctx(textFetch('')), 'spdr');
    expect(r.map((s) => s.symbol)).toContain('spy.us');
  });
  it('returns the whole list for an empty query', async () => {
    expect(await stooqAdapter.search(ctx(textFetch('')), '  ')).toBe(STOOQ_SYMBOLS);
  });
});

describe('parseStooqCsv', () => {
  it('reads a header with spaces and mixed case, and ignores blank lines', () => {
    const csv = ' Date , OPEN,High ,low,Close, Volume\r\n2024-01-02,1,3,0.5,2,100\r\n\r\n2024-01-03,2,4,1,3,\r\n\r\n';
    expect(parseStooqCsv(csv)).toEqual([
      { time: 1704153600, open: 1, high: 3, low: 0.5, close: 2, volume: 100 },
      { time: 1704240000, open: 2, high: 4, low: 1, close: 3, volume: 0 },
    ]);
  });
  it('skips rows without a date or close, and parses a no-row body to nothing', () => {
    expect(parseStooqCsv('Date,Open,High,Low,Close,Volume\nnope,1,1,1,1,1\n2024-01-02,1,1,1,,1\n')).toEqual([]);
    expect(parseStooqCsv('')).toEqual([]);
    expect(parseStooqCsv('Date,Open,High,Low,Close,Volume\n')).toEqual([]);
  });
});

describe('stooq history', () => {
  const req = { symbol: 'AAPL.US', timeframe: '1d', bars: 2 } as const;
  const csv = 'Date,Open,High,Low,Close,Volume\n2024-01-04,3,3,3,3,1\n2024-01-02,1,1,1,1,1\n2024-01-03,2,2,2,2,1\n';
  it('requests the lower-cased symbol and returns the last bars ascending', async () => {
    const urls: string[] = [];
    const out = await stooqAdapter.history(ctx(textFetch(csv, urls)), req);
    expect(out.map((c) => c.close)).toEqual([2, 3]);
    expect(urls[0]).toBe('https://stooq.com/q/d/l/?s=aapl.us&i=d');
  });
  it('turns a no-data body into a not-found error', async () => {
    await expect(stooqAdapter.history(ctx(textFetch('No data')), req)).rejects.toBeInstanceOf(NotFoundError);
  });
  it('explains the bot check', async () => {
    const p = stooqAdapter.history(ctx(textFetch('<!DOCTYPE html><html>challenge</html>')), req);
    await expect(p).rejects.toBeInstanceOf(UpstreamError);
    await expect(p).rejects.toThrow(/bot protection/);
  });
  it('rejects intraday timeframes', async () => {
    await expect(stooqAdapter.history(ctx(textFetch(csv)), { ...req, timeframe: '1h' })).rejects.toThrow(/only supports daily, weekly and monthly/);
  });
});
