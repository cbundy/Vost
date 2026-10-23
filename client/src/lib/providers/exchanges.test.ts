import { afterEach, describe, expect, it, vi } from 'vitest';
import { bybitProvider, parseBybitWs } from './bybit';
import { coinbaseProvider, parseCoinbaseProducts } from './coinbase';
import { krakenProvider, parseKrakenWs, krakenWsSymbol } from './kraken';
import { okxProvider, parseOkxWs } from './okx';
import { paginateBackwards } from './exchange';
import { binanceProvider } from './binance';

type Store = Map<string, string>;
function stubStorage(): Store {
  const m: Store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  return m;
}

/** Mock fetch: `handler(url)` returns the JSON body; records every URL. */
function stubFetch(handler: (url: URL) => unknown): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const real = new URL(decodeURIComponent(input.split('url=')[1] ?? input), 'http://x');
      urls.push(real.toString());
      return { ok: true, status: 200, json: async () => handler(real), text: async () => '' } as Response;
    }),
  );
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe('provider live contract', () => {
  it('supportsLive matches startLive for every provider', () => {
    for (const p of [binanceProvider, coinbaseProvider, krakenProvider, bybitProvider, okxProvider]) {
      expect(Boolean(p.supportsLive), p.id).toBe(typeof p.startLive === 'function');
    }
  });
});

describe('paginateBackwards', () => {
  it('stops when a page reaches no further back and dedupes', async () => {
    const pages = [[3, 4], [2, 3], [2, 3]];
    let i = 0;
    const out = await paginateBackwards(10, async () => pages[i++].map((t) => ({ time: t, open: 1, high: 1, low: 1, close: 1, volume: 1 })));
    expect(out.map((c) => c.time)).toEqual([2, 3, 4]);
  });
});

describe('Coinbase', () => {
  const row = (t: number) => [t, 1, 3, 2, 2.5, 10]; // [time, low, high, open, close, volume]
  it('maps rows, windows backwards by 300 candles and returns ascending', async () => {
    const t0 = 1_700_000_000;
    const urls = stubFetch((u) => {
      const end = Date.parse(u.searchParams.get('end')!) / 1000;
      expect(Date.parse(u.searchParams.get('end')!) - Date.parse(u.searchParams.get('start')!)).toBe(300 * 3600 * 1000);
      return end > t0 ? [row(t0 + 3600), row(t0)] : [row(t0 - 3600)];
    });
    vi.useFakeTimers({ now: (t0 + 7200) * 1000, toFake: ['Date'] });
    const out = await coinbaseProvider.fetchHistory({ symbol: 'btc-usd', timeframe: '1h', bars: 10 });
    vi.useRealTimers();
    expect(out.map((c) => c.time)).toEqual([t0 - 3600, t0, t0 + 3600]);
    expect(out[1]).toEqual({ time: t0, open: 2, high: 3, low: 1, close: 2.5, volume: 10 });
    expect(urls[0]).toContain('/products/BTC-USD/candles?granularity=3600');
  });
  it('rejects unsupported timeframes and has no live', async () => {
    await expect(coinbaseProvider.fetchHistory({ symbol: 'BTC-USD', timeframe: '4h', bars: 5 })).rejects.toThrow(/does not support/);
    expect(coinbaseProvider.supportsLive).toBeFalsy();
  });
  it('caches the symbol list for 24h', async () => {
    const store = stubStorage();
    const urls = stubFetch(() => [
      { id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online' },
      { id: 'OLD-USD', base_currency: 'OLD', quote_currency: 'USD', status: 'delisted' },
    ]);
    expect((await coinbaseProvider.searchSymbols!('btc')).map((s) => s.symbol)).toEqual(['BTC-USD']);
    await coinbaseProvider.searchSymbols!('eth');
    expect(urls).toHaveLength(1);
    const key = 'vost.coinbase.symbols.v1';
    const cached = JSON.parse(store.get(key)!);
    cached.at -= 25 * 3600 * 1000;
    store.set(key, JSON.stringify(cached));
    await coinbaseProvider.searchSymbols!('btc');
    expect(urls).toHaveLength(2);
    expect(parseCoinbaseProducts([])).toEqual([]);
  });
});

describe('Kraken', () => {
  it('parses OHLC, caps at 720 and orders ascending', async () => {
    const rows = Array.from({ length: 800 }, (_, i) => [1000 + i * 60, '1', '3', '0.5', '2', '1.5', '7', 4]);
    const urls = stubFetch(() => ({ error: [], result: { XXBTZUSD: rows, last: 1 } }));
    const out = await krakenProvider.fetchHistory({ symbol: 'xbtusd', timeframe: '1h', bars: 5000 });
    expect(out).toHaveLength(720);
    expect(out[0].time).toBe(1000 + 80 * 60);
    expect(out[0]).toMatchObject({ open: 1, high: 3, low: 0.5, close: 2, volume: 7 });
    expect(urls[0]).toContain('pair=XBTUSD&interval=60');
  });
  it('surfaces API errors', async () => {
    stubFetch(() => ({ error: ['EQuery:Unknown asset pair'] }));
    await expect(krakenProvider.fetchHistory({ symbol: 'NOPE', timeframe: '1h', bars: 5 })).rejects.toThrow(/Unknown asset pair/);
  });
  it('lists pairs with BTC naming and caches', async () => {
    stubStorage();
    const urls = stubFetch(() => ({ error: [], result: { XXBTZUSD: { altname: 'XBTUSD', wsname: 'XBT/USD', status: 'online' } } }));
    const r = await krakenProvider.searchSymbols!('btc');
    expect(r).toEqual([{ symbol: 'XBTUSD', label: 'BTC / USD', exchange: 'Kraken', type: 'crypto' }]);
    await krakenProvider.searchSymbols!('xbt');
    expect(urls).toHaveLength(1);
    expect(krakenWsSymbol('XBTUSD')).toBe('BTC/USD');
  });
  it('parses a ws ohlc frame', () => {
    const raw = JSON.stringify({ channel: 'ohlc', type: 'update', data: [{ symbol: 'BTC/USD', open: 10, high: 12, low: 9, close: 11, volume: 3, interval_begin: '2023-11-14T22:00:00.000000Z', interval: 60 }] });
    expect(parseKrakenWs(raw)).toEqual([{ candle: { time: 1699999200, open: 10, high: 12, low: 9, close: 11, volume: 3 }, closed: false }]);
    expect(parseKrakenWs('{"channel":"heartbeat"}')).toEqual([]);
  });
});

describe('Bybit', () => {
  const row = (ms: number) => [String(ms), '1', '3', '0.5', '2', '9', '18'];
  it('paginates backwards with end and returns ascending', async () => {
    const urls = stubFetch((u) => {
      const end = u.searchParams.get('end');
      return { retCode: 0, result: { list: end === null ? [row(7_200_000), row(3_600_000)] : end === '3599999' ? [row(0)] : [] } };
    });
    const out = await bybitProvider.fetchHistory({ symbol: 'btcusdt', timeframe: '1h', bars: 50 });
    expect(out.map((c) => c.time)).toEqual([0, 3600, 7200]);
    expect(out[2]).toEqual({ time: 7200, open: 1, high: 3, low: 0.5, close: 2, volume: 9 });
    expect(urls[0]).toContain('limit=50');
    expect(urls[0]).toContain('interval=60');
  });
  it('caps page size at 1000', async () => {
    const urls = stubFetch(() => ({ retCode: 0, result: { list: [] } }));
    await expect(bybitProvider.fetchHistory({ symbol: 'X', timeframe: '1d', bars: 5000 })).rejects.toThrow(/No data/);
    expect(urls[0]).toContain('limit=1000');
    expect(urls[0]).toContain('interval=D');
  });
  it('parses a ws kline frame', () => {
    const raw = JSON.stringify({ topic: 'kline.60.BTCUSDT', data: [{ start: 3_600_000, open: '1', high: '3', low: '0.5', close: '2', volume: '9', confirm: true }] });
    expect(parseBybitWs(raw)).toEqual([{ candle: { time: 3600, open: 1, high: 3, low: 0.5, close: 2, volume: 9 }, closed: true }]);
    expect(parseBybitWs('{"op":"pong"}')).toEqual([]);
  });
  it('lists trading instruments', async () => {
    stubStorage();
    stubFetch(() => ({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', status: 'Trading' }, { symbol: 'XUSDT', baseCoin: 'X', quoteCoin: 'USDT', status: 'Closed' }] } }));
    expect((await bybitProvider.searchSymbols!('usdt')).map((s) => s.symbol)).toEqual(['BTCUSDT']);
  });
});

describe('OKX', () => {
  const row = (ms: number, confirm = '1') => [String(ms), '1', '3', '0.5', '2', '9', '0', '0', confirm];
  it('paginates with after (exclusive) and returns ascending', async () => {
    const urls = stubFetch((u) => {
      const after = u.searchParams.get('after');
      return { code: '0', data: after === null ? [row(7_200_000), row(3_600_000)] : after === '3600000' ? [row(0)] : [] };
    });
    const out = await okxProvider.fetchHistory({ symbol: 'btc-usdt', timeframe: '1h', bars: 500 });
    expect(out.map((c) => c.time)).toEqual([0, 3600, 7200]);
    expect(urls[0]).toContain('instId=BTC-USDT&bar=1H&limit=100');
  });
  it('surfaces API errors', async () => {
    stubFetch(() => ({ code: '51001', msg: 'Instrument ID does not exist' }));
    await expect(okxProvider.fetchHistory({ symbol: 'NOPE', timeframe: '1h', bars: 5 })).rejects.toThrow(/does not exist/);
  });
  it('parses ws frames, confirm flag and pong', () => {
    const raw = JSON.stringify({ arg: { channel: 'candle1H', instId: 'BTC-USDT' }, data: [row(3_600_000, '0')] });
    expect(parseOkxWs(raw)).toEqual([{ candle: { time: 3600, open: 1, high: 3, low: 0.5, close: 2, volume: 9 }, closed: false }]);
    expect(parseOkxWs(JSON.stringify({ arg: { channel: 'candle1H' }, data: [row(0, '1')] }))[0].closed).toBe(true);
    expect(parseOkxWs('pong')).toEqual([]);
  });
  it('lists live instruments', async () => {
    stubStorage();
    stubFetch(() => ({ code: '0', data: [{ instId: 'BTC-USDT', baseCcy: 'BTC', quoteCcy: 'USDT', state: 'live' }, { instId: 'A-USDT', baseCcy: 'A', quoteCcy: 'USDT', state: 'suspend' }] }));
    expect((await okxProvider.searchSymbols!('btc')).map((s) => s.symbol)).toEqual(['BTC-USDT']);
  });
});
