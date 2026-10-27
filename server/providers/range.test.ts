/** Range mode (`from`/`to`): each adapter's requests, paging stop and inclusive crop. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_BARS, rangeBarCount } from '../../shared/market.ts';
import { binanceAdapter } from './binance.ts';
import { bybitAdapter } from './bybit.ts';
import { coinbaseAdapter } from './coinbase.ts';
import { InputError, NotFoundError } from './errors.ts';
import { paginateBackwards } from './exchange.ts';
import { krakenAdapter } from './kraken.ts';
import { okxAdapter } from './okx.ts';
import { cropToSpan } from './range.ts';
import { createSymbolCache } from './symbolCache.ts';
import { ctxFor, fakeFetch } from './testing.ts';
import { stooqAdapter } from './stooq.ts';
import { yahooAdapter } from './yahoo.ts';
import type { FetchFn } from './upstream.ts';

afterEach(() => vi.useRealTimers());

const H = 3600;
/** Candle open times (s) of a fake market: every hour from 0 to 999 hours. */
const ALL = Array.from({ length: 1000 }, (_, i) => i * H);
const times = (out: Array<{ time: number }>) => out.map((c) => c.time);
const expected = (from: number, to: number) => ALL.filter((t) => t >= from && t <= to);

describe('shared', () => {
  it('rangeBarCount counts both ends', () => {
    expect(rangeBarCount('1h', 0, 0)).toBe(1);
    expect(rangeBarCount('1h', 0, 3599)).toBe(1);
    expect(rangeBarCount('1h', 0, 3600)).toBe(2);
    expect(rangeBarCount('1M', 0, 30 * 86400)).toBe(2);
    expect(rangeBarCount('1M', 0, 30 * 86400 - 1)).toBe(1);
  });
  it('cropToSpan keeps both bounds', () => {
    const c = [1, 2, 3, 4].map((time) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
    expect(times(cropToSpan(c, 2, 3))).toEqual([2, 3]);
  });
  it('paginateBackwards range mode stops at from, crops, and honours the cap', async () => {
    const pages: Array<number | undefined> = [];
    const c = (time: number) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    const out = await paginateBackwards(
      { from: 4, to: 9 },
      async (before) => {
        pages.push(before);
        return before === undefined ? [c(10), c(9), c(8), c(7)] : [c(6), c(5), c(4), c(3)];
      },
    );
    expect(times(out)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(pages).toEqual([undefined, 7]);
    let calls = 0;
    await paginateBackwards({ from: 0 }, async (before) => {
      calls++;
      const top = before === undefined ? 10_000_000 : before - 1;
      return Array.from({ length: 5000 }, (_, i) => c(top - i));
    });
    expect(calls).toBe(5); // 5 x 5000 = 25000 > MAX_BARS stops it
    expect(MAX_BARS).toBe(20000);
  });
});

describe('Binance', () => {
  const market = (u: URL) => {
    const end = Number(u.searchParams.get('endTime') ?? Infinity);
    const limit = Number(u.searchParams.get('limit'));
    return ALL.filter((t) => t * 1000 <= end).slice(-limit).map((t) => [t * 1000, '1', '3', '0.5', '2', '9']);
  };
  it('pages back from to until from, keeping both edge bars', async () => {
    const f = fakeFetch(market);
    const from = 10 * H;
    const to = 900 * H;
    const out = await binanceAdapter.history(ctxFor(f), { symbol: 'btcusdt', timeframe: '1h', bars: 0, from, to });
    expect(times(out)).toEqual(expected(from, to));
    expect(f.urls[0]).toContain(`endTime=${to * 1000 + 999}`);
    expect(f.urls[0]).toContain('limit=1000');
    expect(f.urls).toHaveLength(1);
  });
  it('joins pages without duplicates and stops once from is reached', async () => {
    const f = fakeFetch(market);
    const out = await binanceAdapter.history(ctxFor(f), { symbol: 'X', timeframe: '1h', bars: 0, from: 0, to: 999 * H });
    expect(times(out)).toEqual(ALL);
    expect(f.urls).toHaveLength(1); // 1000 candles fit one page and the page is short of nothing: oldest <= from
  });
  it('pages twice for a span over one page', async () => {
    const big = Array.from({ length: 2500 }, (_, i) => i * H);
    const f = fakeFetch((u) => {
      const end = Number(u.searchParams.get('endTime'));
      return big.filter((t) => t * 1000 <= end).slice(-1000).map((t) => [t * 1000, '1', '3', '0.5', '2', '9']);
    });
    const from = 1200 * H;
    const out = await binanceAdapter.history(ctxFor(f), { symbol: 'X', timeframe: '1h', bars: 0, from, to: 2499 * H });
    expect(out).toHaveLength(2499 - 1200 + 1);
    expect(new Set(times(out)).size).toBe(out.length);
    expect(f.urls).toHaveLength(2);
    expect(f.urls[1]).toContain(`endTime=${1500 * H * 1000 - 1}`);
  });
  it('returns partial coverage when history starts after from', async () => {
    const f = fakeFetch(market);
    const out = await binanceAdapter.history(ctxFor(f), { symbol: 'X', timeframe: '1h', bars: 0, from: -100 * H + 5 * H, to: 20 * H });
    expect(times(out)).toEqual(expected(0, 20 * H));
  });
  it('404 naming provider, symbol and span when nothing is inside', async () => {
    const f = fakeFetch(market);
    const p = binanceAdapter.history(ctxFor(f), { symbol: 'btcusdt', timeframe: '1h', bars: 0, from: 5000 * H, to: 5001 * H });
    await expect(p).rejects.toBeInstanceOf(NotFoundError);
    await expect(binanceAdapter.history(ctxFor(f), { symbol: 'btcusdt', timeframe: '1h', bars: 0, from: 5000 * H, to: 5001 * H })).rejects.toThrow(
      /Binance has no BTCUSDT 1h data from 1970-07-28T08:00:00.000Z to 1970-07-28T09:00:00.000Z/,
    );
  });
  it('bars with only to: bars candles ending at to', async () => {
    const f = fakeFetch(market);
    const out = await binanceAdapter.history(ctxFor(f), { symbol: 'X', timeframe: '1h', bars: 3, to: 50 * H });
    expect(times(out)).toEqual([48 * H, 49 * H, 50 * H]);
    expect(f.urls[0]).toContain(`limit=3&endTime=${50 * H * 1000 + 999}`);
  });
});

describe('Bybit', () => {
  const market = (u: URL) => {
    const end = Number(u.searchParams.get('end') ?? Infinity);
    const limit = Number(u.searchParams.get('limit'));
    const list = ALL.filter((t) => t * 1000 <= end).slice(-limit).reverse().map((t) => [String(t * 1000), '1', '3', '0.5', '2', '9', '0']);
    return { retCode: 0, result: { list } };
  };
  it('first end includes to, stops at from, keeps both edges', async () => {
    const f = fakeFetch(market);
    const from = 300 * H;
    const to = 700 * H;
    const out = await bybitAdapter.history(ctxFor(f), { symbol: 'btcusdt', timeframe: '1h', bars: 0, from, to });
    expect(times(out)).toEqual(expected(from, to));
    expect(f.urls[0]).toContain(`end=${to * 1000 + 999}`);
    expect(f.urls[0]).toContain('limit=1000');
    expect(f.urls).toHaveLength(1);
  });
  it('pages across several requests without duplicates and returns partial coverage', async () => {
    const big = Array.from({ length: 2500 }, (_, i) => (i + 100) * H); // history starts at hour 100
    const f = fakeFetch((u) => {
      const end = Number(u.searchParams.get('end') ?? Infinity);
      const list = big.filter((t) => t * 1000 <= end).slice(-1000).reverse().map((t) => [String(t * 1000), '1', '3', '0.5', '2', '9', '0']);
      return { retCode: 0, result: { list } };
    });
    const out = await bybitAdapter.history(ctxFor(f), { symbol: 'X', timeframe: '1h', bars: 0, from: 0, to: 2599 * H });
    expect(times(out)).toEqual(big);
    expect(new Set(times(out)).size).toBe(out.length);
    expect(f.urls.length).toBeGreaterThan(1);
    expect(f.urls[1]).toContain(`end=${(2599 - 999) * H * 1000 - 1}`);
  });
  it('404 for an empty span', async () => {
    const f = fakeFetch(market);
    await expect(bybitAdapter.history(ctxFor(f), { symbol: 'btcusdt', timeframe: '1h', bars: 0, from: 5000 * H, to: 5001 * H })).rejects.toThrow(
      /Bybit has no BTCUSDT 1h data/,
    );
  });
});

describe('OKX', () => {
  const market = (u: URL) => {
    const after = Number(u.searchParams.get('after') ?? Infinity);
    const data = ALL.filter((t) => t * 1000 < after).slice(-100).reverse().map((t) => [String(t * 1000), '1', '3', '0.5', '2', '9', '0', '0', '1']);
    return { code: '0', data };
  };
  it('first after is exclusive of to+1, pages until from, no duplicates', async () => {
    const f = fakeFetch(market);
    const from = 500 * H;
    const to = 750 * H;
    const out = await okxAdapter.history(ctxFor(f), { symbol: 'btc-usdt', timeframe: '1h', bars: 0, from, to });
    expect(times(out)).toEqual(expected(from, to));
    expect(f.urls[0]).toContain(`after=${(to + 1) * 1000}`);
    expect(f.urls).toHaveLength(3); // 251 candles: pages of 100 reach back to <= from on the third
    expect(f.urls[1]).toContain(`after=${651 * H * 1000}`);
  });
  it('returns partial coverage when history starts after from', async () => {
    const f = fakeFetch((u) => {
      const r = market(u) as { code: string; data: string[][] };
      return { code: r.code, data: r.data.filter((row) => Number(row[0]) >= 100 * H * 1000) };
    });
    const out = await okxAdapter.history(ctxFor(f), { symbol: 'btc-usdt', timeframe: '1h', bars: 0, from: 0, to: 350 * H });
    expect(times(out)).toEqual(expected(100 * H, 350 * H));
  });
  it('404 for an empty span', async () => {
    const f = fakeFetch(market);
    await expect(okxAdapter.history(ctxFor(f), { symbol: 'btc-usdt', timeframe: '1h', bars: 0, from: 5000 * H, to: 5001 * H })).rejects.toThrow(
      /OKX has no BTC-USDT 1h data/,
    );
  });
});

describe('Coinbase', () => {
  const rows = (start: number, end: number, empty: (s: number) => boolean) =>
    ALL.filter((t) => t >= start && t <= end && !empty(t)).reverse().slice(0, 300).map((t) => [t, 1, 3, 2, 2, 9]);
  it('steps fixed windows by time and an empty window does not end the span', async () => {
    const hole = (t: number) => t >= 400 * H && t < 700 * H; // a whole 300-candle window is empty
    const f = fakeFetch((u) => rows(Date.parse(u.searchParams.get('start')!) / 1000, Date.parse(u.searchParams.get('end')!) / 1000, hole));
    const from = 100 * H;
    const to = 899 * H + 5;
    const out = await coinbaseAdapter.history(ctxFor(f), { symbol: 'btc-usd', timeframe: '1h', bars: 0, from, to });
    expect(times(out)).toEqual(expected(from, to).filter((t) => !hole(t)));
    const span = to - from + 1;
    expect(f.urls).toHaveLength(Math.ceil(span / (300 * H)));
    const first = new URL(f.urls[0]);
    expect(first.searchParams.get('end')).toBe(new Date(to * 1000).toISOString());
  });
  it('returns partial coverage when history starts after from', async () => {
    const f = fakeFetch((u) => rows(Date.parse(u.searchParams.get('start')!) / 1000, Date.parse(u.searchParams.get('end')!) / 1000, (t) => t < 100 * H));
    const out = await coinbaseAdapter.history(ctxFor(f), { symbol: 'btc-usd', timeframe: '1h', bars: 0, from: 0, to: 700 * H });
    expect(times(out)).toEqual(expected(100 * H, 700 * H));
    expect(new Set(times(out)).size).toBe(out.length);
  });
  it('404 for an empty span', async () => {
    const f = fakeFetch(() => []);
    await expect(coinbaseAdapter.history(ctxFor(f), { symbol: 'btc-usd', timeframe: '1h', bars: 0, from: 0, to: 10 * H })).rejects.toThrow(
      /Coinbase has no BTC-USD 1h data/,
    );
  });
});

describe('Kraken', () => {
  const window = Array.from({ length: 720 }, (_, i) => [900 * H + i * H, '1', '3', '0.5', '2', '2', '9', 1]);
  const f = () => fakeFetch(() => ({ error: [], result: { XBTUSD: window, last: 1 } }));
  it('crops an overlapping span', async () => {
    const out = await krakenAdapter.history(ctxFor(f()), { symbol: 'xbtusd', timeframe: '1h', bars: 0, from: 800 * H, to: 905 * H });
    expect(times(out)).toEqual([900 * H, 901 * H, 902 * H, 903 * H, 904 * H, 905 * H]);
  });
  it('404 naming the earliest time when the span ends before the window', async () => {
    const p = krakenAdapter.history(ctxFor(f()), { symbol: 'xbtusd', timeframe: '1h', bars: 0, from: 10 * H, to: 20 * H });
    await expect(p).rejects.toBeInstanceOf(NotFoundError);
    await expect(krakenAdapter.history(ctxFor(f()), { symbol: 'xbtusd', timeframe: '1h', bars: 0, from: 10 * H, to: 20 * H })).rejects.toThrow(
      /Kraken serves only the latest 720 candles, from 1970-02-07T12:00:00.000Z; pick a later range or another provider/,
    );
  });
  it('404 for a span after the window with no candles', async () => {
    await expect(krakenAdapter.history(ctxFor(f()), { symbol: 'xbtusd', timeframe: '1h', bars: 0, from: 5000 * H, to: 5001 * H })).rejects.toThrow(/Kraken has no XBTUSD 1h data/);
  });
});

describe('Yahoo', () => {
  const chart = (ts: number[]) => ({
    chart: {
      result: [
        {
          timestamp: ts,
          indicators: { quote: [{ open: ts.map(() => 1), high: ts.map(() => 3), low: ts.map(() => 0.5), close: ts.map(() => 2), volume: ts.map(() => 9) }] },
        },
      ],
    },
  });
  it('uses period1/period2 (to+1) and no range, cropping inclusively', async () => {
    const f = fakeFetch(() => chart([0, 86400, 2 * 86400, 3 * 86400, 4 * 86400]));
    const out = await yahooAdapter.history(ctxFor(f), { symbol: 'aapl', timeframe: '1d', bars: 0, from: 86400, to: 3 * 86400 });
    expect(times(out)).toEqual([86400, 2 * 86400, 3 * 86400]);
    expect(f.urls[0]).toContain(`period1=${86400}&period2=${3 * 86400 + 1}`);
    expect(f.urls[0]).not.toContain('range=');
  });
  it('rejects a 1m span older than 7 days, naming Yahoo Finance and the earliest time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-31T00:00:00Z'));
    const now = Math.floor(Date.now() / 1000);
    const f = fakeFetch(() => chart([]));
    const p = yahooAdapter.history(ctxFor(f), { symbol: 'aapl', timeframe: '1m', bars: 0, from: now - 8 * 86400, to: now });
    await expect(p).rejects.toBeInstanceOf(InputError);
    await expect(p).rejects.toThrow(/Yahoo Finance serves 1m data only from 2026-01-24T00:00:00.000Z/);
    expect(f.urls).toHaveLength(0);
    // Exactly at the depth is fine.
    const ok = await yahooAdapter.history(ctxFor(fakeFetch(() => chart([now - 7 * 86400]))), { symbol: 'aapl', timeframe: '1m', bars: 0, from: now - 7 * 86400, to: now });
    expect(ok).toHaveLength(1);
  });
  it('returns partial coverage when history starts after from', async () => {
    const f = fakeFetch(() => chart([3 * 86400, 4 * 86400]));
    const out = await yahooAdapter.history(ctxFor(f), { symbol: 'aapl', timeframe: '1d', bars: 0, from: 0, to: 10 * 86400 });
    expect(times(out)).toEqual([3 * 86400, 4 * 86400]);
  });
  it('404 when no bar is inside the span', async () => {
    const f = fakeFetch(() => chart([0, 86400]));
    await expect(yahooAdapter.history(ctxFor(f), { symbol: 'aapl', timeframe: '1d', bars: 0, from: 5 * 86400, to: 6 * 86400 })).rejects.toThrow(/Yahoo Finance has no aapl 1d data/);
  });
});

describe('Stooq', () => {
  const csv = ['Date,Open,High,Low,Close,Volume', ...[1, 2, 3, 4, 5].map((d) => `2024-01-0${d},1,3,0.5,2,9`)].join('\n');
  const day = (d: number) => Date.parse(`2024-01-0${d}`) / 1000;
  const ctx = () => ({ fetch: (async () => new Response(csv, { status: 200 })) as unknown as FetchFn, symbols: createSymbolCache() });
  it('crops the CSV to the span without a bars cut', async () => {
    const out = await stooqAdapter.history(ctx(), { symbol: 'aapl.us', timeframe: '1d', bars: 1, from: day(2), to: day(4) });
    expect(times(out)).toEqual([day(2), day(3), day(4)]);
  });
  it('returns partial coverage when the CSV starts after from', async () => {
    const out = await stooqAdapter.history(ctx(), { symbol: 'aapl.us', timeframe: '1d', bars: 1, from: day(1) - 10 * 86400, to: day(3) });
    expect(times(out)).toEqual([day(1), day(2), day(3)]);
  });
  it('404 when the span holds nothing', async () => {
    await expect(stooqAdapter.history(ctx(), { symbol: 'aapl.us', timeframe: '1d', bars: 1, from: day(5) + 86400, to: day(5) + 2 * 86400 })).rejects.toThrow(/Stooq has no aapl.us 1d data/);
  });
});
