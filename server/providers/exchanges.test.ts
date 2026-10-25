import { afterEach, describe, expect, it, vi } from 'vitest';
import { binanceAdapter } from './binance.ts';
import { bybitAdapter } from './bybit.ts';
import { coinbaseAdapter, parseCoinbaseProducts } from './coinbase.ts';
import { InputError, NotFoundError, UpstreamError } from './errors.ts';
import { paginateBackwards } from './exchange.ts';
import { krakenAdapter } from './kraken.ts';
import { okxAdapter } from './okx.ts';
import { createSymbolCache } from './symbolCache.ts';
import { ctxFor, fakeFetch } from './testing.ts';
import { pickRange, yahooAdapter } from './yahoo.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('paginateBackwards', () => {
  it('stops when a page reaches no further back and dedupes', async () => {
    const pages = [[3, 4], [2, 3], [2, 3]];
    let i = 0;
    const out = await paginateBackwards(10, async () => pages[i++].map((t) => ({ time: t, open: 1, high: 1, low: 1, close: 1, volume: 1 })));
    expect(out.map((c) => c.time)).toEqual([2, 3, 4]);
  });
});

describe('Binance', () => {
  const kline = (ms: number) => [ms, '1', '3', '0.5', '2', '9'];
  it('pages backwards with endTime, 1000 rows at a time, and returns ascending', async () => {
    const f = fakeFetch((u) => {
      if (u.searchParams.get('endTime') !== null) return [kline(0)];
      return Array.from({ length: 1000 }, (_, i) => kline((1000 + i) * 3_600_000)); // ascending, like Binance
    });
    const out = await binanceAdapter.history(ctxFor(f), { symbol: 'btcusdt', timeframe: '1h', bars: 1500 });
    expect(out).toHaveLength(1001);
    expect(out[0]).toEqual({ time: 0, open: 1, high: 3, low: 0.5, close: 2, volume: 9 });
    expect(out[1000].time).toBe(1999 * 3600);
    expect(f.urls[0]).toBe('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000');
    expect(f.urls[1]).toContain('limit=500&endTime=3599999999');
  });
  it('falls back to data-api.binance.vision after the first host fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fakeFetch((u) => (u.hostname === 'api.binance.com' ? new Response('geo blocked', { status: 451 }) : [kline(0)]));
    const out = await binanceAdapter.history(ctxFor(f), { symbol: 'BTCUSDT', timeframe: '1d', bars: 5 });
    expect(out).toHaveLength(1);
    expect(f.urls.map((u) => new URL(u).hostname)).toEqual(['api.binance.com', 'data-api.binance.vision']);
    expect(console.warn).toHaveBeenCalled();
  });
  it('raises the last error when both hosts fail', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fakeFetch(() => new Response('nope', { status: 451 }));
    await expect(binanceAdapter.history(ctxFor(f), { symbol: 'X', timeframe: '1d', bars: 5 })).rejects.toThrow('Binance: HTTP 451 - nope');
  });
  it('rejects unsupported timeframes and reports no data as not found', async () => {
    const f = fakeFetch(() => []);
    await expect(binanceAdapter.history(ctxFor(f), { symbol: 'X', timeframe: '2h' as never, bars: 5 })).rejects.toBeInstanceOf(InputError);
    await expect(binanceAdapter.history(ctxFor(f), { symbol: 'NOPE', timeframe: '1h', bars: 5 })).rejects.toBeInstanceOf(NotFoundError);
  });
  it('lists trading symbols (quote priority first), caches them and searches them', async () => {
    const f = fakeFetch(() => ({
      symbols: [
        { symbol: 'ETHBTC', baseAsset: 'ETH', quoteAsset: 'BTC', status: 'TRADING' },
        { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'OLDUSDT', baseAsset: 'OLD', quoteAsset: 'USDT', status: 'BREAK' },
      ],
    }));
    const ctx = ctxFor(f);
    expect((await binanceAdapter.listSymbols!(ctx)).map((s) => s.symbol)).toEqual(['BTCUSDT', 'ETHBTC']);
    expect((await binanceAdapter.search(ctx, 'eth')).map((s) => s.symbol)).toEqual(['ETHBTC']);
    expect(f.urls).toHaveLength(1);
    expect((await binanceAdapter.search(ctx, '')).map((s) => s.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']);
  });
});

describe('Coinbase', () => {
  const row = (t: number) => [t, 1, 3, 2, 2.5, 10]; // [time, low, high, open, close, volume]
  it('maps rows, windows backwards by 300 candles and returns ascending', async () => {
    const t0 = 1_700_000_000;
    const f = fakeFetch((u) => {
      const end = Date.parse(u.searchParams.get('end')!) / 1000;
      expect(Date.parse(u.searchParams.get('end')!) - Date.parse(u.searchParams.get('start')!)).toBe(300 * 3600 * 1000);
      return end > t0 ? [row(t0 + 3600), row(t0)] : [row(t0 - 3600)];
    });
    vi.useFakeTimers({ now: (t0 + 7200) * 1000, toFake: ['Date'] });
    const out = await coinbaseAdapter.history(ctxFor(f), { symbol: 'btc-usd', timeframe: '1h', bars: 10 });
    expect(out.map((c) => c.time)).toEqual([t0 - 3600, t0, t0 + 3600]);
    expect(out[1]).toEqual({ time: t0, open: 2, high: 3, low: 1, close: 2.5, volume: 10 });
    expect(f.urls[0]).toContain('/products/BTC-USD/candles?granularity=3600');
  });
  it('rejects unsupported timeframes', async () => {
    await expect(coinbaseAdapter.history(ctxFor(fakeFetch(() => [])), { symbol: 'BTC-USD', timeframe: '4h', bars: 5 })).rejects.toThrow(/does not support/);
  });
  it('searches the online products', async () => {
    const f = fakeFetch(() => [
      { id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online' },
      { id: 'OLD-USD', base_currency: 'OLD', quote_currency: 'USD', status: 'delisted' },
    ]);
    expect((await coinbaseAdapter.search(ctxFor(f), 'btc')).map((s) => s.symbol)).toEqual(['BTC-USD']);
    expect(parseCoinbaseProducts([])).toEqual([]);
  });
  it('caches the symbol list across searches', async () => {
    let now = 0;
    const f = fakeFetch(() => [{ id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online' }]);
    const ctx = { fetch: f.fetch, symbols: createSymbolCache(() => now) };
    await coinbaseAdapter.search(ctx, 'btc');
    await coinbaseAdapter.search(ctx, 'eth');
    expect(f.urls).toHaveLength(1);
    now += 25 * 3600 * 1000;
    await coinbaseAdapter.search(ctx, 'btc');
    expect(f.urls).toHaveLength(2);
  });
});

describe('Kraken', () => {
  it('parses OHLC, caps at 720 and orders ascending', async () => {
    const rows = Array.from({ length: 800 }, (_, i) => [1000 + i * 60, '1', '3', '0.5', '2', '1.5', '7', 4]);
    const f = fakeFetch(() => ({ error: [], result: { XXBTZUSD: rows, last: 1 } }));
    const out = await krakenAdapter.history(ctxFor(f), { symbol: 'xbtusd', timeframe: '1h', bars: 5000 });
    expect(out).toHaveLength(720);
    expect(out[0].time).toBe(1000 + 80 * 60);
    expect(out[0]).toMatchObject({ open: 1, high: 3, low: 0.5, close: 2, volume: 7 });
    expect(f.urls[0]).toContain('pair=XBTUSD&interval=60');
  });
  it('surfaces API errors as an upstream error naming Kraken', async () => {
    const f = fakeFetch(() => ({ error: ['EQuery:Unknown asset pair'] }));
    const err = await krakenAdapter.history(ctxFor(f), { symbol: 'NOPE', timeframe: '1h', bars: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as Error).message).toBe('Kraken: EQuery:Unknown asset pair');
  });
  it('lists pairs with BTC naming and caches', async () => {
    const f = fakeFetch(() => ({ error: [], result: { XXBTZUSD: { altname: 'XBTUSD', wsname: 'XBT/USD', status: 'online' } } }));
    const ctx = ctxFor(f);
    expect(await krakenAdapter.search(ctx, 'btc')).toEqual([{ symbol: 'XBTUSD', label: 'BTC / USD', exchange: 'Kraken', type: 'crypto' }]);
    await krakenAdapter.search(ctx, 'xbt');
    expect(f.urls).toHaveLength(1);
  });
});

describe('Bybit', () => {
  const row = (ms: number) => [String(ms), '1', '3', '0.5', '2', '9', '18'];
  it('paginates backwards with end and returns ascending', async () => {
    const f = fakeFetch((u) => {
      const end = u.searchParams.get('end');
      return { retCode: 0, result: { list: end === null ? [row(7_200_000), row(3_600_000)] : end === '3599999' ? [row(0)] : [] } };
    });
    const out = await bybitAdapter.history(ctxFor(f), { symbol: 'btcusdt', timeframe: '1h', bars: 50 });
    expect(out.map((c) => c.time)).toEqual([0, 3600, 7200]);
    expect(out[2]).toEqual({ time: 7200, open: 1, high: 3, low: 0.5, close: 2, volume: 9 });
    expect(f.urls[0]).toContain('limit=50');
    expect(f.urls[0]).toContain('interval=60');
  });
  it('caps page size at 1000', async () => {
    const f = fakeFetch(() => ({ retCode: 0, result: { list: [] } }));
    await expect(bybitAdapter.history(ctxFor(f), { symbol: 'X', timeframe: '1d', bars: 5000 })).rejects.toThrow(/No data/);
    expect(f.urls[0]).toContain('limit=1000');
    expect(f.urls[0]).toContain('interval=D');
  });
  it('surfaces API errors', async () => {
    const f = fakeFetch(() => ({ retCode: 10001, retMsg: 'Invalid symbol' }));
    await expect(bybitAdapter.history(ctxFor(f), { symbol: 'X', timeframe: '1d', bars: 5 })).rejects.toThrow('Bybit: Invalid symbol');
  });
  it('lists trading instruments', async () => {
    const f = fakeFetch(() => ({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', status: 'Trading' }, { symbol: 'XUSDT', baseCoin: 'X', quoteCoin: 'USDT', status: 'Closed' }] } }));
    expect((await bybitAdapter.search(ctxFor(f), 'usdt')).map((s) => s.symbol)).toEqual(['BTCUSDT']);
  });
});

describe('OKX', () => {
  const row = (ms: number, confirm = '1') => [String(ms), '1', '3', '0.5', '2', '9', '0', '0', confirm];
  it('paginates with after (exclusive) and returns ascending', async () => {
    const f = fakeFetch((u) => {
      const after = u.searchParams.get('after');
      return { code: '0', data: after === null ? [row(7_200_000), row(3_600_000)] : after === '3600000' ? [row(0)] : [] };
    });
    const out = await okxAdapter.history(ctxFor(f), { symbol: 'btc-usdt', timeframe: '1h', bars: 500 });
    expect(out.map((c) => c.time)).toEqual([0, 3600, 7200]);
    expect(f.urls[0]).toContain('instId=BTC-USDT&bar=1H&limit=100');
  });
  it('surfaces API errors', async () => {
    const f = fakeFetch(() => ({ code: '51001', msg: 'Instrument ID does not exist' }));
    await expect(okxAdapter.history(ctxFor(f), { symbol: 'NOPE', timeframe: '1h', bars: 5 })).rejects.toThrow('OKX: Instrument ID does not exist');
  });
  it('lists live instruments', async () => {
    const f = fakeFetch(() => ({ code: '0', data: [{ instId: 'BTC-USDT', baseCcy: 'BTC', quoteCcy: 'USDT', state: 'live' }, { instId: 'A-USDT', baseCcy: 'A', quoteCcy: 'USDT', state: 'suspend' }] }));
    expect((await okxAdapter.search(ctxFor(f), 'btc')).map((s) => s.symbol)).toEqual(['BTC-USDT']);
  });
});

describe('Yahoo', () => {
  const chart = (n: number) => ({
    chart: {
      result: [
        {
          timestamp: Array.from({ length: n }, (_, i) => 1000 + i * 86400),
          indicators: { quote: [{ open: Array(n).fill(1), high: Array(n).fill(3), low: Array(n).fill(0.5), close: Array(n).fill(2), volume: Array(n).fill(9) }] },
        },
      ],
    },
  });
  it('picks the smallest range that covers the bars, capped for intraday', () => {
    expect(pickRange('1d', 100)).toBe('6mo');
    expect(pickRange('1d', 5)).toBe('5d');
    expect(pickRange('1d', 300)).toBe('1y');
    expect(pickRange('1d', 100000)).toBe('max');
    expect(pickRange('5m', 100000)).toBe('1mo');
  });
  it('requests the chosen range and returns the last bars', async () => {
    const f = fakeFetch(() => chart(10));
    const out = await yahooAdapter.history(ctxFor(f), { symbol: 'aapl', timeframe: '1d', bars: 4 });
    expect(out).toHaveLength(4);
    expect(f.urls[0]).toContain('/v8/finance/chart/aapl?interval=1d&range=5d');
  });
  it('rejects 4h, which Yahoo lacks', async () => {
    await expect(yahooAdapter.history(ctxFor(fakeFetch(() => chart(1))), { symbol: 'aapl', timeframe: '4h', bars: 4 })).rejects.toThrow(/Yahoo Finance does not support timeframe 4h/);
  });
  it('keeps the 429 message', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fakeFetch(() => new Response('Too Many Requests', { status: 429 }));
    const caught = yahooAdapter.history(ctxFor(f), { symbol: 'aapl', timeframe: '1d', bars: 4 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    const err = (await caught) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.status).toBe(429);
    expect(err.message).toBe('Yahoo Finance is rate-limiting this server (HTTP 429). Wait a minute and retry, or use Binance / CSV import.');
  });
  it('reports a missing chart as not found', async () => {
    const f = fakeFetch(() => ({ chart: { result: null, error: null } }));
    await expect(yahooAdapter.history(ctxFor(f), { symbol: 'zzzz', timeframe: '1d', bars: 4 })).rejects.toBeInstanceOf(NotFoundError);
  });
  it('searches, falling back to the popular list on failure or no hits', async () => {
    const hit = fakeFetch(() => ({ quotes: [{ symbol: 'AAPL', shortname: 'Apple', exchDisp: 'NASDAQ', quoteType: 'EQUITY' }, { shortname: 'no symbol' }] }));
    expect(await yahooAdapter.search(ctxFor(hit), 'apple')).toEqual([{ symbol: 'AAPL', label: 'Apple', exchange: 'NASDAQ', type: 'stock' }]);
    const fail = fakeFetch(() => new Response('x', { status: 404 }));
    expect((await yahooAdapter.search(ctxFor(fail), 'apple')).length).toBe(12);
    const none = fakeFetch(() => ({ quotes: [] }));
    expect((await yahooAdapter.search(ctxFor(none), 'zzz')).length).toBe(12);
  });
});
