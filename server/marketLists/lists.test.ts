import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_LIST_RETRY_MS, MARKET_LIST_TTL_MS, createMarketListCache } from './lists.ts';
import { createSymbolCache } from '../providers/symbolCache.ts';
import type { FetchFn } from '../providers/upstream.ts';

const KEY = 'sekret-cmc-key-123';

interface Call {
  url: URL;
  headers: Record<string, string>;
}

/** A fake fetch that records url and headers; `handler` returns a body or a Response. */
function fake(handler: (url: URL, headers: Record<string, string>) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    const out = await handler(url, headers);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  }) as unknown as FetchFn;
  return { fetch, calls };
}

const COINS = [
  ['BTC', 'Bitcoin'], ['USDT', 'Tether'], ['WBTC', 'Wrapped Bitcoin'], ['STETH', 'Lido Staked Ether'], ['NOPAIR', 'No Pair Coin'],
  ...Array.from({ length: 95 }, (_, i) => [`C${i}`, `Coin ${i}`]),
];
const binanceInfo = {
  symbols: ['BTC', ...Array.from({ length: 95 }, (_, i) => `C${i}`)].map((b) => ({ symbol: `${b}USDT`, status: 'TRADING', baseAsset: b, quoteAsset: 'USDT' })),
};
const cgBody = COINS.map(([s, n], i) => ({ symbol: s.toLowerCase(), name: n, market_cap: 1000 - i, total_volume: 500 - i }));
const cmcBody = { data: COINS.map(([s, n], i) => ({ symbol: s, name: n, quote: { USD: { market_cap: 1000 - i, volume_24h: 500 - i } } })) };

function healthy(extra?: (url: URL, headers: Record<string, string>) => unknown) {
  return fake((url, headers) => {
    const o = extra?.(url, headers);
    if (o !== undefined) return o;
    if (url.hostname === 'api.binance.com') return binanceInfo;
    if (url.hostname === 'api.coingecko.com') return cgBody;
    if (url.hostname === 'pro-api.coinmarketcap.com') return cmcBody;
    throw new Error(`unexpected ${url}`);
  });
}

let t = Date.UTC(2026, 10, 6, 12);
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  t = Date.UTC(2026, 10, 6, 12);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const cache = () => createMarketListCache(() => t);
const ids = (l: Array<{ id: string }>) => l.map((x) => x.id);
const hosts = (f: { calls: Call[] }) => f.calls.map((c) => c.url.hostname);

describe('sources', () => {
  it('without a key only CoinGecko is called, once per order', async () => {
    const f = healthy();
    const lists = await cache().get({ fetch: f.fetch, symbols: createSymbolCache() });
    expect(ids(lists)).toEqual(['crypto-cap', 'crypto-volume', 'stocks-cap', 'stocks-volume', 'indices']);
    const cg = f.calls.filter((c) => c.url.hostname === 'api.coingecko.com');
    expect(cg.map((c) => c.url.searchParams.get('order')).sort()).toEqual(['market_cap_desc', 'volume_desc']);
    expect(hosts(f)).not.toContain('pro-api.coinmarketcap.com');
    expect(lists[0].source).toMatch(/CoinGecko/);
    expect(lists[0].date).toBe('2026-11-06');
    expect(lists[0].live).toBe(true);
  });

  it('with a key CoinMarketCap is called with the header and CoinGecko is not', async () => {
    const f = healthy();
    const lists = await cache().get({ fetch: f.fetch, symbols: createSymbolCache(), coinMarketCapKey: ` ${KEY} ` });
    const cmc = f.calls.filter((c) => c.url.hostname === 'pro-api.coinmarketcap.com');
    expect(cmc.map((c) => c.url.searchParams.get('sort')).sort()).toEqual(['market_cap', 'volume_24h']);
    for (const c of cmc) expect(c.headers['X-CMC_PRO_API_KEY']).toBe(KEY);
    expect(hosts(f)).not.toContain('api.coingecko.com');
    expect(lists[0].source).toMatch(/CoinMarketCap/);
    expect(lists[1].entries[0].metric).toBe(500);
  });

  it('a blank key counts as unset', async () => {
    const f = healthy();
    await cache().get({ fetch: f.fetch, symbols: createSymbolCache(), coinMarketCapKey: '  ' });
    expect(hosts(f)).not.toContain('pro-api.coinmarketcap.com');
  });

  it('a CoinMarketCap 401 falls back to CoinGecko, and the key shows up nowhere even when echoed', async () => {
    const f = healthy((url) => (url.hostname === 'pro-api.coinmarketcap.com' ? new Response(`bad key ${KEY}`, { status: 401 }) : undefined));
    const lists = await cache().get({ fetch: f.fetch, symbols: createSymbolCache(), coinMarketCapKey: KEY });
    expect(lists[0].source).toMatch(/CoinGecko/);
    expect(lists[0].entries.length).toBe(30);
    const seen = JSON.stringify([lists, warn.mock.calls, error.mock.calls]);
    expect(seen).not.toContain(KEY);
    expect(warn.mock.calls.some((c) => String(c[0]) === '[market-lists] crypto-cap pro-api.coinmarketcap.com 401')).toBe(true);
  });

  it('when both sources fail while CoinMarketCap echoes the key, the error and logs stay clean', async () => {
    const f = healthy((url) => (url.hostname === 'api.binance.com' ? undefined : new Response(`bad key ${KEY}`, { status: 401 })));
    const lists = await cache().get({ fetch: f.fetch, symbols: createSymbolCache(), coinMarketCapKey: KEY });
    expect(lists[0].error).toBeTruthy();
    expect(JSON.stringify([lists, warn.mock.calls, error.mock.calls])).not.toContain(KEY);
  });
});

describe('mapping', () => {
  it('excludes stablecoins, wrapped and staked, skips coins without a Binance pair, keeps 30 in upstream order', async () => {
    const f = healthy();
    const [cap] = await cache().get({ fetch: f.fetch, symbols: createSymbolCache() });
    expect(cap.excluded.map((e) => e.symbol)).toEqual(['USDT', 'WBTC', 'STETH']);
    expect(cap.excluded[0].reason).toMatch(/stablecoin/);
    expect(cap.skipped).toHaveLength(1);
    expect(cap.skipped[0]).toMatchObject({ symbol: 'NOPAIR' });
    expect(cap.skipped[0].reason).toMatch(/rank 5/);
    expect(cap.entries).toHaveLength(30);
    expect(cap.entries[0]).toEqual({ provider: 'binance', symbol: 'BTCUSDT', name: 'Bitcoin', rank: 1, metric: 1000 });
    expect(cap.entries[1]).toMatchObject({ symbol: 'C0USDT', rank: 6 });
    const ranks = cap.entries.map((e) => e.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('a Binance list that cannot be loaded gives an error, never unmapped entries', async () => {
    const f = healthy((url) => (url.hostname === 'api.binance.com' ? new Response('no', { status: 400 }) : undefined));
    const [cap, vol] = await cache().get({ fetch: f.fetch, symbols: createSymbolCache() });
    expect(cap.error).toBeTruthy();
    expect(cap.entries).toEqual([]);
    expect(vol.error).toBeTruthy();
  });
});

describe('fixed lists', () => {
  it('equal universe.json, dated 2026-11-05', async () => {
    const u = JSON.parse(readFileSync(new URL('../../docs/spikes/strategy-search/universe.json', import.meta.url), 'utf8'));
    const lists = await cache().get({ fetch: healthy().fetch, symbols: createSymbolCache() });
    const byId = Object.fromEntries(lists.map((l) => [l.id, l]));
    for (const [id, key] of [['stocks-cap', 'stocksCap'], ['stocks-volume', 'stocksVolume'], ['indices', 'indices']] as const) {
      expect(byId[id].entries.map((e) => e.symbol)).toEqual(u[key].entries.map((e: { symbol: string }) => e.symbol));
      expect(byId[id].date).toBe('2026-11-05');
      expect(byId[id].source).toBe(u[key].source);
      expect(byId[id].live).toBe(false);
      expect(byId[id].entries.every((e) => e.provider === 'yahoo')).toBe(true);
    }
  });
});

describe('cache', () => {
  it('serves the day from memory, then refreshes', async () => {
    const f = healthy();
    const c = cache();
    const ctx = { fetch: f.fetch, symbols: createSymbolCache() };
    await c.get(ctx);
    const n = f.calls.length;
    t += MARKET_LIST_TTL_MS - 1000;
    await c.get(ctx);
    expect(f.calls.length).toBe(n);
    t += 2000;
    const lists = await c.get(ctx);
    expect(f.calls.filter((x) => x.url.hostname === 'api.coingecko.com')).toHaveLength(4);
    expect(lists[0].date).toBe('2026-11-07');
    expect(lists[0].stale).toBeUndefined();
  });

  it('a failed refresh serves the old list with stale and its own date', async () => {
    let down = false;
    const f = healthy((url) => (down && url.hostname === 'api.coingecko.com' ? new Response('x', { status: 403 }) : undefined));
    const c = cache();
    const ctx = { fetch: f.fetch, symbols: createSymbolCache() };
    await c.get(ctx);
    down = true;
    t += MARKET_LIST_TTL_MS + 1;
    const [cap] = await c.get(ctx);
    expect(cap.stale).toBe(true);
    expect(cap.date).toBe('2026-11-06');
    expect(cap.entries).toHaveLength(30);
    expect(warn.mock.calls.filter((x) => String(x[0]).startsWith('[market-lists] crypto-cap api.coingecko.com 403'))).toHaveLength(1);
  });

  it('a first failure gives that list an error while the other lists still answer', async () => {
    const f = healthy((url) => (url.hostname === 'api.coingecko.com' && url.searchParams.get('order') === 'volume_desc' ? new Response('x', { status: 403 }) : undefined));
    const lists = await cache().get({ fetch: f.fetch, symbols: createSymbolCache() });
    expect(lists).toHaveLength(5);
    expect(lists[0].entries).toHaveLength(30);
    expect(lists[1]).toMatchObject({ id: 'crypto-volume', entries: [], error: expect.stringContaining('403') });
    expect(lists[4].entries.length).toBeGreaterThan(0);
  });

  it('concurrent calls share one upstream load', async () => {
    const f = healthy();
    const c = cache();
    const ctx = { fetch: f.fetch, symbols: createSymbolCache() };
    await Promise.all([c.get(ctx), c.get(ctx), c.get(ctx)]);
    expect(f.calls.filter((x) => x.url.hostname === 'api.coingecko.com')).toHaveLength(2);
  });

  it('retries a failed load on the next request, but no sooner than the backoff', async () => {
    let down = true;
    const f = healthy((url) => (down && url.hostname === 'api.coingecko.com' ? new Response('x', { status: 403 }) : undefined));
    const c = cache();
    const ctx = { fetch: f.fetch, symbols: createSymbolCache() };
    await c.get(ctx);
    const n = f.calls.length;
    t += MARKET_LIST_RETRY_MS - 1000;
    await c.get(ctx);
    expect(f.calls.length).toBe(n);
    down = false;
    t += 2000;
    const [cap] = await c.get(ctx);
    expect(f.calls.length).toBeGreaterThan(n);
    expect(cap.entries).toHaveLength(30);
    expect(cap.error).toBeUndefined();
  });
});
