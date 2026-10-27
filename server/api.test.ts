import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BARS, TIMEFRAMES } from '../shared/market.ts';
import { PROVIDER_CATALOG } from '../shared/providerCatalog.ts';
import { createApiDeps, handleApi } from './api.ts';
import { fakeFetch, type FakeFetch } from './providers/testing.ts';

let server: http.Server;
let base = '';
let current: FakeFetch;
let upstream: (url: URL) => unknown;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // A fresh cache and a fake fetch per request: no test touches the network or another test's cache.
    const deps = createApiDeps({ fetch: current.fetch });
    void handleApi(req, res, new URL(req.url!, 'http://x'), deps);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
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

const kline = (ms: number) => [ms, '1', '3', '0.5', '2', '9'];

describe('GET /api/providers', () => {
  it('returns the catalog, uncached', async () => {
    const r = await get('/api/providers');
    expect(r.status).toBe(200);
    expect(r.body).toEqual(PROVIDER_CATALOG);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.body.map((p: { id: string }) => p.id)).toEqual(['binance', 'coinbase', 'kraken', 'bybit', 'okx', 'yahoo', 'stooq']);
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
    ['a timeframe the provider lacks', '/api/history?provider=coinbase&symbol=A&timeframe=4h&bars=5', /Coinbase does not support timeframe 4h/],
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

  it('every provider refuses exactly the timeframes its catalog entry lacks (400), before any upstream call', async () => {
    for (const info of PROVIDER_CATALOG) {
      for (const tf of TIMEFRAMES.filter((t) => !info.timeframes.includes(t))) {
        const r = await get(`/api/history?provider=${info.id}&symbol=A&timeframe=${tf}&bars=5`);
        expect(r.status, `${info.id} ${tf}`).toBe(400);
      }
    }
    expect(current.urls).toEqual([]);
  });

  it('every catalog timeframe is accepted by its adapter (never a 400)', async () => {
    upstream = () => new Response('x', { status: 404 }); // any non-400 answer proves the adapter took the timeframe
    for (const info of PROVIDER_CATALOG) {
      for (const tf of info.timeframes) {
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
    const r = await get('/api/symbols?provider=stooq');
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(200);
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
  it('returns the whole list for stooq with an empty query', async () => {
    const r = await get('/api/search?provider=stooq');
    expect(r.body.length).toBeGreaterThan(200);
  });
  it('searches', async () => {
    const r = await get('/api/search?provider=stooq&q=spdr');
    expect(r.body.map((s: { symbol: string }) => s.symbol)).toContain('spy.us');
  });
  it('answers 400 for an unknown provider', async () => {
    expect((await get('/api/search?provider=x&q=a')).status).toBe(400);
  });
});

describe('other routes', () => {
  it('the old proxy is gone: 404 listing the real routes', async () => {
    const r = await get('/api/proxy?url=https%3A%2F%2Fstooq.com%2F');
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
