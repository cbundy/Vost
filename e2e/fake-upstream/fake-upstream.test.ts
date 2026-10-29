import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Candle } from '../../shared/market.ts';
import { PROVIDER_CATALOG } from '../../shared/providerCatalog.ts';
import { liveFeed } from '../../server/live/feeds.ts';
import { openUpstream, type UpstreamSocket } from '../../server/live/socket.ts';
import { adapters } from '../../server/providers/index.ts';
import { createSymbolCache } from '../../server/providers/symbolCache.ts';
import { setTestUpstream } from '../../server/testUpstream.ts';
import { createLibraries } from '../../server/pine/libraries.ts';
import { startFakeUpstream, type FakeUpstream } from './index.ts';
import { CLOSED_LIB_PATH, NESTED_LIB_PATH, NESTED_LIB_SOURCE, OPEN_LIB_PATH, OPEN_LIB_SOURCE } from './pine-libraries.ts';

let fake: FakeUpstream;

beforeAll(async () => {
  fake = await startFakeUpstream();
  setTestUpstream(fake.url);
});

afterAll(async () => {
  setTestUpstream(null);
  await fake.close();
});

const HOSTS: Record<string, string[]> = {
  binance: ['api.binance.com'],
  coinbase: ['api.exchange.coinbase.com'],
  kraken: ['api.kraken.com'],
  bybit: ['api.bybit.com'],
  okx: ['www.okx.com'],
  'hyperliquid-perps': ['api.hyperliquid.xyz'],
  'hyperliquid-spot': ['api.hyperliquid.xyz'],
  yahoo: ['query1.finance.yahoo.com'],
};

describe('fake upstream REST, through the real adapters and the real fetch', () => {
  for (const info of PROVIDER_CATALOG) {
    it(`${info.id}: history, symbols and search`, async () => {
      const adapter = adapters.get(info.id)!;
      const ctx = { symbols: createSymbolCache() };
      const before = fake.requests.length;

      const candles = await adapter.history(ctx, { symbol: info.defaultSymbol, timeframe: info.defaultTimeframe, bars: 300 });
      expect(candles.length).toBeGreaterThan(100);
      for (const c of candles) {
        expect(Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0).toBe(true);
        expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
        expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      }
      expect(candles.map((c) => c.time)).toEqual([...new Set(candles.map((c) => c.time))].sort((a, b) => a - b));

      if (info.hasSymbolList) {
        const list = await adapter.listSymbols!(ctx);
        expect(list.length).toBeGreaterThan(3);
      }
      if (info.hasSearch) {
        const found = await adapter.search(ctx, info.defaultSymbol.slice(0, 3));
        expect(found.length).toBeGreaterThan(0);
        expect(found.some((s) => s.symbol.toUpperCase().includes(info.defaultSymbol.slice(0, 3).toUpperCase()))).toBe(true);
      }

      // Everything went to the fake, under the provider's own host.
      const mine = fake.requests.slice(before);
      expect(mine.length).toBeGreaterThan(0);
      expect(new Set(mine.map((r) => r.host))).toEqual(new Set(HOSTS[info.id].filter((h) => mine.some((r) => r.host === h))));
      expect(mine.every((r) => HOSTS[info.id].includes(r.host))).toBe(true);
    });
  }

  it('binance answers on its mirror host too', async () => {
    const res = await fetch(`${fake.url}/https/data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBe(5);
  });

  it('answers 404 for a host it does not know', async () => {
    const res = await fetch(`${fake.url}/https/example.com/x`);
    expect(res.status).toBe(404);
  });
});

/** Collects what an upstream socket reports and lets a test wait for the next matching event. */
function watch(provider: string, host?: 'fallback') {
  const symbols: Record<string, string> = { coinbase: 'BTC-USD', okx: 'BTC-USDT', kraken: 'XBTUSD', 'hyperliquid-perps': 'BTC', 'hyperliquid-spot': 'HYPE/USDC' };
  const found = liveFeed(provider, symbols[provider] ?? 'BTCUSDT', '1m');
  if ('error' in found) throw new Error(found.error);
  const feed = host === 'fallback' ? { ...found.feed, url: found.feed.fallbackUrl! } : found.feed;
  const klines: Candle[] = [];
  const statuses: string[] = [];
  const failures: string[] = [];
  const listeners = new Set<() => void>();
  const poke = (): void => listeners.forEach((fn) => fn());
  const socket: UpstreamSocket = openUpstream({
    feed,
    label: `${provider} test`,
    onStatus: (ev) => {
      statuses.push(ev.status);
      poke();
    },
    onKline: (c) => {
      klines.push(c);
      poke();
    },
    onLog: () => undefined,
    onFailure: (text) => {
      failures.push(text);
      poke();
    },
  });
  /** Resolves when `cond` holds; re-checked on every event. */
  const until = (cond: () => boolean, what: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const check = (): void => {
        if (!cond()) return;
        listeners.delete(check);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`timed out waiting for ${what} (statuses ${statuses.join(',')}; ${klines.length} klines; failures ${failures.join(' | ')})`));
      }, 15_000);
      listeners.add(check);
      check();
    });
  return { socket, klines, statuses, failures, until };
}

describe('fake upstream live feeds, through the real socket and WebSocket', () => {
  for (const provider of ['binance', 'coinbase', 'kraken', 'bybit', 'okx', 'hyperliquid-perps', 'hyperliquid-spot']) {
    it(`${provider}: a kline arrives, then a new one with a different close`, async () => {
      const w = watch(provider);
      try {
        await w.until(() => w.klines.length >= 1, 'the first kline');
        const first = w.klines[0];
        expect(first.close).toBeGreaterThan(0);
        // The same bar (same open time) must be re-sent with a different close: the forming candle updates in place.
        // A minute rollover mid-test only starts a new bar, which then updates in place too.
        await w.until(
          () => w.klines.some((a) => w.klines.some((b) => a.time === b.time && a.close !== b.close)),
          'a forming bar re-sent with a changed close',
        );
        expect(w.klines.every((k) => k.time >= first.time && k.time <= first.time + 60)).toBe(true);
        expect(w.statuses).toContain('live');
      } finally {
        w.socket.close();
      }
    });
  }

  it('binance: the fallback stream host serves klines too', async () => {
    const w = watch('binance', 'fallback');
    try {
      await w.until(() => w.klines.length >= 1, 'a kline from the mirror');
      expect(fake.requests.some((r) => r.kind === 'ws' && r.host === 'data-stream.binance.vision')).toBe(true);
    } finally {
      w.socket.close();
    }
  });

  it('records the websocket requests under their original host', () => {
    const hosts = new Set(fake.requests.filter((r) => r.kind === 'ws').map((r) => r.host));
    expect(hosts).toContain('stream.binance.com:9443');
    expect(hosts).toContain('ws.kraken.com');
    expect(hosts).toContain('stream.bybit.com');
    expect(hosts).toContain('ws.okx.com:8443');
    expect(hosts).toContain('ws-feed.exchange.coinbase.com');
    expect(hosts).toContain('api.hyperliquid.xyz');
  });

  it('stop() makes the socket report a failure and start() brings the klines back', async () => {
    const w = watch('okx');
    try {
      await w.until(() => w.klines.length >= 1, 'the first kline');
      await fake.stop();
      await w.until(() => w.failures.length >= 1 && w.statuses.at(-1) === 'reconnecting', 'a failure after stop()');
      // While stopped, a fresh connect is refused.
      await expect(fetch(`${fake.url}/https/www.okx.com/api/v5/public/instruments?instType=SPOT`)).rejects.toThrow();
      const seen = w.klines.length;
      await fake.start();
      await w.until(() => w.statuses.at(-1) === 'live' && w.klines.length > seen, 'live again with new klines after start()');
    } finally {
      w.socket.close();
    }
  });

  it('answers a Telegram sendMessage POST and records its method and body', async () => {
    const before = fake.requests.length;
    const body = JSON.stringify({ chat_id: '1', text: 'hello' });
    const res = await fetch(`${fake.url}/https/api.telegram.org/bottest-token/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    expect(res.status).toBe(200);
    const reply = (await res.json()) as { ok: boolean; result: { message_id: number } };
    expect(reply.ok).toBe(true);
    expect(typeof reply.result.message_id).toBe('number');
    expect(fake.requests.slice(before)).toEqual([{ kind: 'http', scheme: 'https', host: 'api.telegram.org', path: '/bottest-token/sendMessage', method: 'POST', body }]);
    const other = await fetch(`${fake.url}/https/api.telegram.org/bottest-token/getMe`, { method: 'POST', body: '{}' });
    expect(other.status).toBe(404);
  });
});

describe('fake upstream TradingView library endpoints, through the real Libraries lookup', () => {
  it('serves an open-source library, the library it imports, and a closed-source one', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vost-fake-tv-'));
    try {
      const libs = createLibraries({ dir, log: () => undefined });
      await libs.load();
      expect(await libs.get(OPEN_LIB_PATH)).toMatchObject({ ok: true, origin: 'tradingview', source: OPEN_LIB_SOURCE });
      expect(await libs.get(NESTED_LIB_PATH)).toMatchObject({ ok: true, source: NESTED_LIB_SOURCE });
      expect(await libs.get(CLOSED_LIB_PATH)).toMatchObject({ ok: false, reason: 'closed-source' });
      expect(await libs.get('alice/Unknown/1')).toMatchObject({ ok: false, reason: 'not-found' });
      const hosts = new Set(fake.requests.map((r) => r.host));
      expect(hosts.has('www.tradingview.com') && hosts.has('pine-facade.tradingview.com')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('search without type=3 finds no library', async () => {
    const res = await fetch(`${fake.url}/https/www.tradingview.com/pubscripts-suggest-json/?search=OpenLib`);
    expect(((await res.json()) as { results: unknown[] }).results).toEqual([]);
  });
});
