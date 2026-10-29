import { describe, expect, it } from 'vitest';
import { NotFoundError } from './errors.ts';
import { hyperliquidPerpsAdapter, hyperliquidSpotAdapter } from './hyperliquid.ts';
import { createSymbolCache } from './symbolCache.ts';
import type { AdapterContext } from './types.ts';
import type { FetchFn } from './upstream.ts';

const HOUR = 3600;

const META = {
  universe: [
    { name: 'BTC', szDecimals: 5 },
    { name: 'ETH', szDecimals: 4 },
    { name: 'kPEPE', szDecimals: 0 },
    { name: 'MATIC', szDecimals: 1, isDelisted: true },
  ],
};

/** Token positions differ from their `index` on purpose: lookups must go by `.index`. */
const SPOT_META = {
  tokens: [
    { name: 'HYPE', index: 150 },
    { name: 'USDC', index: 0 },
    { name: 'PURR', index: 1 },
  ],
  universe: [
    { name: 'PURR/USDC', tokens: [1, 0], index: 0 },
    { name: '@107', tokens: [150, 0], index: 107 },
  ],
};

interface Call {
  body: { type: string; req?: { coin: string; interval: string; startTime: number; endTime: number } };
  method?: string;
}

/** A fake Hyperliquid `/info`: records every POST body; `candles(req)` answers candleSnapshot. */
function fakeHl(candles: (req: NonNullable<Call['body']['req']>) => unknown[] = () => []) {
  const calls: Call[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Call['body'];
    calls.push({ body, method: init.method });
    let out: unknown;
    if (body.type === 'meta') out = META;
    else if (body.type === 'spotMeta') out = SPOT_META;
    else out = candles(body.req!);
    return new Response(JSON.stringify(out), { status: 200 });
  }) as unknown as FetchFn;
  const ctx: AdapterContext = { fetch, symbols: createSymbolCache() };
  return { ctx, calls, snapshots: () => calls.filter((c) => c.body.type === 'candleSnapshot') };
}

/** Candle rows with open time `t` (ms) for every hour in the window that lies inside [oldestSec, newestSec]. */
const hourly = (oldestSec: number, newestSec: number, limit = 5000) => (req: { startTime: number; endTime: number }) => {
  const rows: unknown[] = [];
  for (let t = newestSec; t >= oldestSec && rows.length < limit; t -= HOUR) {
    if (t * 1000 >= req.startTime && t * 1000 <= req.endTime) rows.push({ t: t * 1000, T: t * 1000 + 3_599_999, s: 'BTC', i: '1h', o: '1', c: String(t), h: '2', l: '0.5', v: '3', n: 1 });
  }
  return rows.reverse();
};

describe('Hyperliquid history', () => {
  it('bars mode returns the newest N, ascending, as POSTs', async () => {
    const t0 = 1_700_000_000 - (1_700_000_000 % HOUR);
    const hl = fakeHl(hourly(t0 - 99 * HOUR, t0));
    const out = await hyperliquidPerpsAdapter.history(hl.ctx, { symbol: 'btc', timeframe: '1h', bars: 10, to: t0 });
    expect(out).toHaveLength(10);
    expect(out[9].time).toBe(t0);
    expect(out[0].time).toBe(t0 - 9 * HOUR);
    expect(out.map((c) => c.time)).toEqual([...out.map((c) => c.time)].sort((a, b) => a - b));
    const snap = hl.snapshots();
    expect(snap).toHaveLength(1);
    expect(snap[0].method).toBe('POST');
    expect(snap[0].body.req).toMatchObject({ coin: 'BTC', interval: '1h', endTime: t0 * 1000 + 999 });
  });

  it('span mode over three 5000-candle windows has no duplicates or gaps and is cropped', async () => {
    const t0 = 1_700_000_000 - (1_700_000_000 % HOUR);
    const oldest = t0 - 12_999 * HOUR; // 13000 candles
    const hl = fakeHl(hourly(oldest, t0));
    const from = oldest + 100 * HOUR;
    const to = t0 - 50 * HOUR;
    const out = await hyperliquidPerpsAdapter.history(hl.ctx, { symbol: 'BTC', timeframe: '1h', bars: 1, from, to });
    expect(hl.snapshots().length).toBeGreaterThanOrEqual(3);
    expect(out[0].time).toBe(from);
    expect(out[out.length - 1].time).toBe(to);
    expect(out).toHaveLength((to - from) / HOUR + 1);
    for (let i = 1; i < out.length; i++) expect(out[i].time - out[i - 1].time).toBe(HOUR);
    const ends = hl.snapshots().map((c) => c.body.req!.endTime);
    expect(ends[0]).toBe(to * 1000 + 999);
    expect(ends[1] % 1000).toBe(999);
  });

  it('an empty span is a 404 with the no-data text', async () => {
    const hl = fakeHl(() => []);
    const err = await hyperliquidPerpsAdapter.history(hl.ctx, { symbol: 'BTC', timeframe: '1h', bars: 1, from: 1000, to: 5000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as Error).message).toContain('Hyperliquid Perps has no BTC 1h data from');
  });

  it('an empty bars result is a 404', async () => {
    const hl = fakeHl(() => []);
    await expect(hyperliquidPerpsAdapter.history(hl.ctx, { symbol: 'BTC', timeframe: '1h', bars: 5 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('an unknown symbol is a 404 naming provider and symbol, with no candleSnapshot call', async () => {
    const hl = fakeHl();
    const err = await hyperliquidSpotAdapter.history(hl.ctx, { symbol: 'NOPE/USDC', timeframe: '1h', bars: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as Error).message).toContain('Hyperliquid Spot');
    expect((err as Error).message).toContain('NOPE/USDC');
    expect(hl.snapshots()).toHaveLength(0);
  });

  it.each([
    ['btc', 'BTC'],
    ['KPEPE', 'kPEPE'],
    ['kpepe', 'kPEPE'],
    ['matic', 'MATIC'], // delisted markets still load their old charts
  ])('perps symbol %s asks for coin %s', async (symbol, coin) => {
    const hl = fakeHl(() => [{ t: 3_600_000, o: '1', c: '2', h: '3', l: '1', v: '1' }]);
    await hyperliquidPerpsAdapter.history(hl.ctx, { symbol, timeframe: '1h', bars: 1 });
    expect(hl.snapshots()[0].body.req!.coin).toBe(coin);
  });

  it.each([
    ['hype/usdc', '@107'],
    ['@107', '@107'],
    ['purr/usdc', 'PURR/USDC'],
  ])('spot symbol %s asks for coin %s (tokens found by index, not position)', async (symbol, coin) => {
    const hl = fakeHl(() => [{ t: 3_600_000, o: '1', c: '2', h: '3', l: '1', v: '1' }]);
    await hyperliquidSpotAdapter.history(hl.ctx, { symbol, timeframe: '1h', bars: 1 });
    expect(hl.snapshots()[0].body.req!.coin).toBe(coin);
  });
});

describe('Hyperliquid search', () => {
  it('an empty query gives the popular list with no upstream call', async () => {
    const hl = fakeHl();
    expect((await hyperliquidPerpsAdapter.search(hl.ctx, '')).map((s) => s.symbol)).toEqual(['BTC', 'ETH', 'SOL', 'HYPE', 'XRP']);
    expect((await hyperliquidSpotAdapter.search(hl.ctx, ' ')).map((s) => s.symbol)).toContain('HYPE/USDC');
    expect(hl.calls).toHaveLength(0);
  });

  it('finds kPEPE by pepe, leaves out delisted perps, and loads the list once', async () => {
    const hl = fakeHl();
    expect(await hyperliquidPerpsAdapter.search(hl.ctx, 'pepe')).toEqual([{ symbol: 'kPEPE', label: 'kPEPE / USDC perp', exchange: 'Hyperliquid', type: 'crypto' }]);
    expect(await hyperliquidPerpsAdapter.search(hl.ctx, 'matic')).toEqual([]);
    expect(hl.calls.filter((c) => c.body.type === 'meta')).toHaveLength(1);
  });

  it('spot suggestions are readable pairs', async () => {
    const hl = fakeHl();
    expect(await hyperliquidSpotAdapter.search(hl.ctx, 'hype')).toEqual([{ symbol: 'HYPE/USDC', label: 'HYPE / USDC', exchange: 'Hyperliquid', type: 'crypto' }]);
  });
});
