import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BARS, TIMEFRAMES } from '../shared/market.ts';
import { PROVIDER_CATALOG } from '../shared/providerCatalog.ts';
import { createApiDeps, handleApi } from './api.ts';
import { openCandleStore } from './candles/store.ts';
import { fakeFetch, type FakeFetch } from './providers/testing.ts';

let server: http.Server;
let base = '';
let current: FakeFetch;
let upstream: (url: URL) => unknown;
let outcomes: Array<{ provider: string; feed: string; ok: boolean; error?: string }>;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // A fresh cache and a fake fetch per request: no test touches the network or another test's cache.
    const deps = createApiDeps({
      fetch: current.fetch,
      onOutcome: (provider, feed, r) => outcomes.push({ provider, feed, ok: r.ok, ...(r.ok ? {} : { error: r.error }) }),
    });
    void handleApi(req, res, new URL(req.url!, 'http://x'), deps);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  outcomes = [];
  upstream = () => {
    throw new Error('unexpected upstream call');
  };
  current = fakeFetch((u) => upstream(u));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

async function get(path: string): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const binanceInfo = {
  symbols: ['BTC', 'ETH', 'SPDR'].map((b) => ({ symbol: `${b}USDT`, status: 'TRADING', baseAsset: b, quoteAsset: 'USDT' })),
};
const kline = (ms: number) => [ms, '1', '3', '0.5', '2', '9'];

describe('GET /api/providers', () => {
  it('returns the catalog, uncached', async () => {
    const r = await get('/api/providers');
    expect(r.status).toBe(200);
    expect(r.body).toEqual(PROVIDER_CATALOG);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.body.map((p: { id: string }) => p.id)).toEqual(['binance', 'coinbase', 'kraken', 'bybit', 'okx', 'hyperliquid-perps', 'hyperliquid-spot', 'yahoo']);
    expect(JSON.stringify(r.body)).not.toMatch(/https?:\/\//);
  });
});

describe('GET /api/history', () => {
  it('returns ascending candles', async () => {
    upstream = () => [kline(3_600_000), kline(0)];
    const r = await get('/api/history?provider=binance&symbol=btcusdt&timeframe=1h&bars=2');
    expect(r.status).toBe(200);
    expect(r.body.map((c: { time: number }) => c.time)).toEqual([0, 3600]);
    expect(current.urls[0]).toContain('symbol=BTCUSDT&interval=1h&limit=2');
  });

  it.each([
    ['an unknown provider', '/api/history?provider=nope&symbol=A&timeframe=1h&bars=5', /Unknown provider "nope"/],
    ['a missing provider', '/api/history?symbol=A&timeframe=1h&bars=5', /Unknown provider/],
    ['a missing symbol', '/api/history?provider=binance&timeframe=1h&bars=5', /Missing symbol/],
    ['a timeframe the app does not know', '/api/history?provider=binance&symbol=A&timeframe=3m&bars=5', /does not support timeframe 3m/],
    ['a provider that was dropped', '/api/history?provider=stooq&symbol=aapl.us&timeframe=1d&bars=5', /Unknown provider "stooq"/],
    ['bars 0', '/api/history?provider=binance&symbol=A&timeframe=1h&bars=0', /bars must be an integer/],
    [`bars ${MAX_BARS + 1}`, `/api/history?provider=binance&symbol=A&timeframe=1h&bars=${MAX_BARS + 1}`, /bars must be an integer/],
    ['bars 1.5', '/api/history?provider=binance&symbol=A&timeframe=1h&bars=1.5', /bars must be an integer/],
    ['bars not a number', '/api/history?provider=binance&symbol=A&timeframe=1h&bars=lots', /bars must be an integer/],
    ['missing bars', '/api/history?provider=binance&symbol=A&timeframe=1h', /bars must be an integer/],
  ])('answers 400 for %s, without calling upstream', async (_name, path, message) => {
    const r = await get(path);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(message);
    expect(current.urls).toEqual([]);
  });

  it('accepts bars at the limit', async () => {
    upstream = () => [kline(0)];
    expect((await get(`/api/history?provider=binance&symbol=A&timeframe=1h&bars=${MAX_BARS}`)).status).toBe(200);
  });

  it('answers 404 with the no-data text', async () => {
    upstream = () => [];
    const r = await get('/api/history?provider=binance&symbol=NOPE&timeframe=1h&bars=5');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('No data returned for NOPE. Check the symbol (e.g. BTCUSDT).');
  });

  it('answers 502 naming the provider when the upstream fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    upstream = () => new Response('bad gateway', { status: 400 });
    const r = await get('/api/history?provider=kraken&symbol=XBTUSD&timeframe=1h&bars=5');
    expect(r.status).toBe(502);
    expect(r.body.error).toBe('Kraken: HTTP 400 - bad gateway');
  });

  it('every provider refuses exactly the timeframes it neither has nor can build (400), before any upstream call', async () => {
    for (const info of PROVIDER_CATALOG) {
      for (const tf of TIMEFRAMES.filter((t) => !info.timeframes.includes(t) && !info.builtTimeframes.includes(t))) {
        const r = await get(`/api/history?provider=${info.id}&symbol=A&timeframe=${tf}&bars=5`);
        expect(r.status, `${info.id} ${tf}`).toBe(400);
      }
    }
    expect(current.urls).toEqual([]);
  });

  it('every native and built timeframe is accepted (never a 400)', async () => {
    upstream = () => new Response('x', { status: 404 }); // any non-400 answer proves the adapter took the timeframe
    for (const info of PROVIDER_CATALOG) {
      for (const tf of [...info.timeframes, ...info.builtTimeframes]) {
        const r = await get(`/api/history?provider=${info.id}&symbol=A&timeframe=${tf}&bars=5`);
        expect(r.status, `${info.id} ${tf}`).not.toBe(400);
      }
    }
  });

  describe('time span', () => {
    const NOW = 1_700_000_000;
    const klines = (u: URL) => {
      const end = Number(u.searchParams.get('endTime') ?? Infinity);
      return [0, 3600, 7200, 10800].filter((t) => t * 1000 <= end).map((t) => kline(t * 1000));
    };
    it('accepts from without bars', async () => {
      upstream = klines;
      const r = await get('/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&from=3600&to=7200');
      expect(r.status).toBe(200);
      expect(r.body.map((c: { time: number }) => c.time)).toEqual([3600, 7200]);
      expect(current.urls[0]).toContain(`endTime=${7200 * 1000 + 999}`);
    });
    it('passes to through with bars', async () => {
      upstream = klines;
      const r = await get('/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=2&to=7200');
      expect(r.body.map((c: { time: number }) => c.time)).toEqual([3600, 7200]);
      expect(current.urls[0]).toContain(`limit=2&endTime=${7200 * 1000 + 999}`);
    });
    it('still needs bars without from', async () => {
      const r = await get('/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&to=7200');
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/bars must be/);
    });
    it('clamps a future to to now', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW * 1000);
      try {
        upstream = () => [kline((NOW - 3600) * 1000)];
        const r = await get(`/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&from=${NOW - 7200}&to=${NOW + 999999}`);
        expect(r.status).toBe(200);
        expect(current.urls[0]).toContain(`endTime=${NOW * 1000 + 999}`);
      } finally {
        vi.useRealTimers();
      }
    });
    it.each([
      ['a non-numeric from', 'from=abc&to=10', /from must be a unix time/],
      ['a non-numeric to', 'from=1&to=1.5', /to must be a unix time/],
      ['from after to', 'from=100&to=10', /from must not be after to/],
      ['a span over the cap', 'from=0&to=99999999', /20000/],
    ])('400 for %s', async (_n, qs, msg) => {
      const r = await get(`/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&${qs}`);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(msg);
      expect(current.urls).toHaveLength(0);
    });
    it('404 with the span for a span without data', async () => {
      upstream = klines;
      const r = await get('/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&from=50000&to=60000');
      expect(r.status).toBe(404);
      expect(r.body.error).toBe('Binance has no BTCUSDT 1h data from 1970-01-01T13:53:20.000Z to 1970-01-01T16:40:00.000Z');
    });
  });
});

describe('GET /api/symbols', () => {
  it('returns the list for a provider with one', async () => {
    upstream = () => binanceInfo;
    const r = await get('/api/symbols?provider=binance');
    expect(r.status).toBe(200);
    expect(r.body.map((s: { symbol: string }) => s.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SPDRUSDT']);
  });
  it('answers 400 for a provider without a list', async () => {
    const r = await get('/api/symbols?provider=kraken');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no symbol list/);
  });
});

describe('GET /api/search', () => {
  it('returns popular symbols for an empty query', async () => {
    const r = await get('/api/search?provider=coinbase&q=');
    expect(r.body.map((s: { symbol: string }) => s.symbol)).toContain('BTC-USD');
    expect(current.urls).toEqual([]);
  });
  it('returns popular symbols for binance with an empty query, without a list call', async () => {
    const r = await get('/api/search?provider=binance');
    expect(r.body.map((s: { symbol: string }) => s.symbol)).toContain('BTCUSDT');
    expect(current.urls).toEqual([]);
  });
  it('searches', async () => {
    upstream = () => binanceInfo;
    const r = await get('/api/search?provider=binance&q=spdr');
    expect(r.body.map((s: { symbol: string }) => s.symbol)).toEqual(['SPDRUSDT']);
  });
  it('answers 400 for an unknown provider', async () => {
    expect((await get('/api/search?provider=x&q=a')).status).toBe(400);
  });
});

describe('other routes', () => {
  it('the old proxy is gone: 404 listing the real routes', async () => {
    const r = await get('/api/proxy?url=https%3A%2F%2Fexample.com%2F');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/\/api\/history/);
    expect(current.urls).toEqual([]);
  });
  it('an unknown API path is a 404', async () => {
    expect((await get('/api/whatever')).status).toBe(404);
  });
  it('only GET is allowed', async () => {
    const res = await fetch(`${base}/api/providers`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('browser abort', () => {
  it('aborts the upstream fetch when the browser closes the request', async () => {
    let seen: AbortSignal | undefined;
    let started!: () => void;
    const began = new Promise<void>((r) => (started = r));
    current = {
      urls: [],
      fetch: ((_url: string, init: RequestInit) => {
        seen = init.signal as AbortSignal;
        started();
        return new Promise(() => undefined);
      }) as never,
    };
    const ac = new AbortController();
    const pending = fetch(`${base}/api/history?provider=binance&symbol=A&timeframe=1h&bars=5`, { signal: ac.signal }).catch(() => undefined);
    await began;
    ac.abort();
    await pending;
    await vi.waitFor(() => expect(seen!.aborted).toBe(true));
  });
});

describe('outcome hook (feeds /api/status)', () => {
  it('reports a successful history request', async () => {
    upstream = () => [kline(60000), kline(120000)];
    const r = await get('/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=2');
    expect(r.status).toBe(200);
    expect(outcomes).toEqual([{ provider: 'binance', feed: 'history', ok: true }]);
  });

  it('reports an upstream failure as a failure of the matching feed', async () => {
    upstream = () => new Response('down', { status: 503 });
    const r = await get('/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=2');
    expect(r.status).toBe(502);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ provider: 'binance', feed: 'history', ok: false });
    expect(outcomes[0].error).toContain('503');
  });

  it('reports search and symbols requests under the symbols feed', async () => {
    upstream = () => ({ symbols: [] });
    await get('/api/search?provider=binance&q=btc');
    await get('/api/symbols?provider=binance');
    expect(outcomes.map((o) => [o.provider, o.feed, o.ok])).toEqual([
      ['binance', 'symbols', true],
      ['binance', 'symbols', true],
    ]);
  });

  it('reports nothing for a caller mistake (400) or an unknown route (404)', async () => {
    expect((await get('/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=0')).status).toBe(400);
    expect((await get('/api/history?provider=nope&symbol=X&timeframe=1h&bars=2')).status).toBe(400);
    expect((await get('/api/nope')).status).toBe(404);
    expect(outcomes).toEqual([]);
  });

  it('reports nothing for a symbol the provider does not have (NotFoundError)', async () => {
    upstream = () => [];
    const r = await get('/api/history?provider=binance&symbol=NOPE&timeframe=1h&bars=2');
    expect(r.status).toBe(404);
    expect(outcomes).toEqual([]);
  });
});

describe('recorded series (candle store)', () => {
  it('serves a recorded series from the store on the second request, an unrecorded one never', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vost-api-'));
    const candles = await openCandleStore({ dir, log: () => undefined });
    const recorded = new Set(['binance:BTCUSDT:1h']);
    const srv = http.createServer((req, res) => {
      const deps = createApiDeps({ fetch: current.fetch, candles, isRecorded: (p, s, t) => recorded.has(`${p}:${s}:${t}`) });
      void handleApi(req, res, new URL(req.url!, 'http://x'), deps);
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      upstream = () => [kline(0), kline(3_600_000)];
      const q = '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=2&to=3600';
      const first = await (await fetch(url + q)).json();
      expect(current.urls).toHaveLength(1);
      expect(candles.stats().rows).toBe(2);
      const second = await (await fetch(url + q)).json();
      expect(second).toEqual(first);
      expect(current.urls).toHaveLength(1); // served from disk
      await fetch(url + q.replace('BTCUSDT', 'ETHUSDT'));
      await fetch(url + q.replace('BTCUSDT', 'ETHUSDT'));
      expect(current.urls).toHaveLength(3); // not recorded: always the exchange
      expect(candles.stats().rows).toBe(2);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
      candles.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('built timeframes', () => {
  /** A Coinbase candles endpoint over a series from time `first` every `step` seconds: one row [time, low, high, open, close, volume] per bar. */
  const series = (first: number, step: number, count: number) => (u: URL) => {
    const gran = Number(u.searchParams.get('granularity'));
    expect(gran).toBe(step);
    const start = Date.parse(u.searchParams.get('start')!) / 1000;
    const end = Date.parse(u.searchParams.get('end')!) / 1000;
    const rows = [];
    for (let i = count - 1; i >= 0; i--) {
      const t = first + i * step;
      if (t >= start && t <= end) rows.push([t, i, i + 10, i + 1, i + 2, 1]);
    }
    return rows.slice(0, 300);
  };
  const H = 3600;
  const T0 = Date.UTC(2024, 0, 1) / 1000; // a Monday, aligned to every bucket
  const times = (body: Array<{ time: number }>) => body.map((c) => c.time);

  it('serves Coinbase 4h in bars mode from 1h, every bar covering its whole bucket', async () => {
    upstream = series(T0, H, 24 * 10);
    const to = T0 + 24 * 10 * H - 1;
    const r = await get(`/api/history?provider=coinbase&symbol=BTC-USD&timeframe=4h&bars=5&to=${to}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(5);
    expect(times(r.body)).toEqual([55, 56, 57, 58, 59].map((i) => T0 + i * 4 * H));
    for (const c of r.body) expect(c.volume).toBe(4);
    expect(current.urls.every((u) => u.includes('granularity=3600'))).toBe(true);
    expect(current.urls.length).toBeGreaterThan(0);
  });

  it('serves a span in range mode: exactly the buckets stamped inside it, 1w from 1d', async () => {
    upstream = series(T0, 86400, 70);
    const from = T0 + 7 * 86400;
    const to = T0 + 40 * 86400;
    const r = await get(`/api/history?provider=coinbase&symbol=BTC-USD&timeframe=1w&from=${from}&to=${to}`);
    expect(r.status).toBe(200);
    expect(times(r.body)).toEqual([1, 2, 3, 4, 5].map((w) => T0 + w * 7 * 86400));
    expect(r.body[0]).toMatchObject({ open: 8, close: 15, low: 7, high: 23, volume: 7 });
    expect(current.urls.every((u) => u.includes('granularity=86400'))).toBe(true);
  });

  it('builds calendar months of different lengths from daily bars (Kraken 1M)', async () => {
    const first = Date.UTC(2023, 0, 1) / 1000;
    upstream = () => ({
      error: [],
      result: { XBTUSD: Array.from({ length: 120 }, (_, i) => [first + i * 86400, '1', '2', '0.5', '1.5', '1', '3', 1]), last: 0 },
    });
    const to = first + 119 * 86400;
    const r = await get(`/api/history?provider=kraken&symbol=XBTUSD&timeframe=1M&bars=3&to=${to}`);
    expect(r.status).toBe(200);
    expect(r.body.map((c: { volume: number }) => c.volume)).toEqual([28 * 3, 31 * 3, 30 * 3]); // volume 3 per day: Feb, Mar, and the forming Apr
    expect(times(r.body)).toEqual([Date.UTC(2023, 1, 1) / 1000, Date.UTC(2023, 2, 1) / 1000, Date.UTC(2023, 3, 1) / 1000]);
    expect(current.urls[0]).toContain('interval=1440');
  });

  it('reads past MAX_BARS base bars in chunks, newest first, and stops at the first empty chunk', async () => {
    const days = 20500;
    upstream = series(0, 86400, days);
    const to = (days - 1) * 86400;
    const r = await get(`/api/history?provider=coinbase&symbol=BTC-USD&timeframe=1M&bars=800&to=${to}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(660); // 56 years of months, minus the partial newest
    expect(times(r.body)).toEqual([...new Set(times(r.body))].sort((a, b) => a - b));
    expect(r.body[0].time).toBe(0); // the series starts at the start of January 1970, so that oldest bucket is complete and kept
    expect(new Date(r.body[r.body.length - 1].time * 1000).getUTCDate()).toBe(1);
  });

  it('answers 404 in the provider wording naming the built timeframe', async () => {
    upstream = () => [];
    const span = await get(`/api/history?provider=coinbase&symbol=NOPE&timeframe=4h&from=${T0}&to=${T0 + 86400}`);
    expect(span.status).toBe(404);
    expect(span.body.error).toMatch(/^Coinbase has no NOPE 4h data from /);
    const bars = await get('/api/history?provider=coinbase&symbol=NOPE&timeframe=4h&bars=5');
    expect(bars.status).toBe(404);
    expect(bars.body.error).toBe('No data returned for NOPE. Check the symbol (e.g. BTC-USD).');
  });

  it('keeps the alert evaluator on the lowest native timeframe', () => {
    for (const info of PROVIDER_CATALOG) expect(info.builtTimeframes).not.toContain(info.timeframes[0]);
    expect(PROVIDER_CATALOG.find((p) => p.id === 'coinbase')!.timeframes[0]).toBe('1m');
  });

  it('reads a recorded base series from the candle store for a built request', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vost-api-'));
    const candles = await openCandleStore({ dir, log: () => undefined });
    const srv = http.createServer((req, res) => {
      const deps = createApiDeps({ fetch: current.fetch, candles, isRecorded: (p, s, t) => `${p}:${s}:${t}` === 'coinbase:BTC-USD:1h' });
      void handleApi(req, res, new URL(req.url!, 'http://x'), deps);
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      upstream = series(T0, H, 24 * 10);
      const q = `/api/history?provider=coinbase&symbol=BTC-USD&timeframe=4h&bars=3&to=${T0 + 24 * 10 * H - 1}`;
      const first = await (await fetch(url + q)).json();
      expect(candles.stats().rows).toBeGreaterThan(0);
      const fetched = current.urls.length;
      const second = await (await fetch(url + q)).json();
      expect(second).toEqual(first);
      expect(current.urls.length).toBe(fetched); // the base series came from disk
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
      candles.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
