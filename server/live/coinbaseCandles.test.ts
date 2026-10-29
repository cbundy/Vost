import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../providers/testing.ts';
import { SEED_RETRY_MS, coinbaseCandleFeed, parseCoinbaseMatch } from './coinbaseCandles.ts';
import type { FeedOpenContext, LiveFeed, ParsedKline } from './feeds.ts';
import { fakeTimers } from './testing.ts';

const B0 = 1_800_000_000; // a minute boundary
const SYMBOL = 'BTC-USD';
const flush = () => new Promise((r) => setTimeout(r, 5));

const frame = (id: number, at: number, price: number, size: number, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'match', trade_id: id, product_id: SYMBOL, price: String(price), size: String(size), time: new Date(at * 1000).toISOString().replace('Z', '123Z'), side: 'buy', ...extra });

const bar = (time: number, o: number, h: number, l: number, c: number, v: number, closed = false): ParsedKline => ({ candle: { time, open: o, high: h, low: l, close: c, volume: v }, closed });
/** A REST row: [time, low, high, open, close, volume]. */
const row = (time: number, o: number, h: number, l: number, c: number, v: number) => [time, l, h, o, c, v];

type Rest = (url: URL) => unknown;

function setup(granularity = 60, nowSec = B0 + 10, rest: Rest = () => []) {
  const timers = fakeTimers();
  const fetched = fakeFetch((u) => rest(u));
  let now = nowSec;
  const feed = coinbaseCandleFeed(SYMBOL, granularity, { fetch: fetched.fetch, now: () => now * 1000 }) as Required<Pick<LiveFeed, 'parse' | 'onOpen'>>;
  const emitted: ParsedKline[] = [];
  const logs: string[] = [];
  const closers: Array<() => void> = [];
  const open = (): void => {
    const ctx: FeedOpenContext = {
      emit: (items) => emitted.push(...items),
      log: (sev, text) => logs.push(`${sev}: ${text}`),
      timers,
      onClose: (fn) => closers.push(fn),
    };
    feed.onOpen(ctx);
  };
  /** Feeds frames like the socket does: what parse returns is published. */
  const push = (...frames: string[]): ParsedKline[] => {
    const out = frames.flatMap((f) => feed.parse(f));
    emitted.push(...out);
    return out;
  };
  return { feed, timers, fetched, emitted, logs, closers, open, push, setNow: (s: number) => (now = s) };
}

describe('parseCoinbaseMatch', () => {
  it('reads match and last_match for the product', () => {
    expect(parseCoinbaseMatch(frame(7, B0 + 1.5, 100.5, 0.25), SYMBOL)).toEqual({ id: 7, time: B0 + 1.5, price: 100.5, size: 0.25 });
    expect(parseCoinbaseMatch(frame(7, B0, 1, 1, { type: 'last_match' }), SYMBOL)).toMatchObject({ id: 7 });
  });
  it('yields nothing for everything else', () => {
    const bad = [
      '{"type":"subscriptions","channels":[]}',
      '{"type":"error","message":"x"}',
      frame(1, B0, 1, 1, { product_id: 'ETH-USD' }),
      frame(1, B0, 1, 1, { price: undefined }),
      frame(1, B0, 1, 1, { price: 'abc' }),
      frame(1, B0, 1, 1, { size: null }),
      frame(1, B0, 1, 1, { size: 'NaN' }),
      frame(1, B0, 1, 1, { time: 'yesterday' }),
      frame(1, B0, 1, 1, { time: undefined }),
      frame(1, B0, 1, 1, { trade_id: undefined }),
      'not json',
      'null',
    ];
    for (const raw of bad) expect(parseCoinbaseMatch(raw, SYMBOL), raw).toBeNull();
  });
});

describe('candle building (bucket started after the connection opened)', () => {
  /** Opens in the previous bucket with no REST row, then moves into B0+60 before trading. */
  const fresh = async (granularity = 60, nowSec = B0 - 5) => {
    const s = setup(granularity, nowSec);
    s.open();
    await flush(); // seed answers with no row
    return s;
  };

  it('folds OHLCV and emits the open bucket on every trade', async () => {
    const s = await fresh();
    s.push(frame(1, B0 + 1, 100, 1), frame(2, B0 + 2, 105, 2), frame(3, B0 + 3, 98, 0.5), frame(4, B0 + 4, 101, 1));
    expect(s.emitted.at(-1)).toEqual(bar(B0, 100, 105, 98, 101, 4.5));
    expect(s.emitted).toHaveLength(4);
    expect(s.emitted.every((e) => !e.closed)).toBe(true);
  });

  it('emits the old bucket once as closed, then starts the new one; the boundary trade opens the new bucket', async () => {
    const s = await fresh();
    s.push(frame(1, B0 + 10, 100, 1), frame(2, B0 + 59.9, 110, 1));
    const out = s.push(frame(3, B0 + 60, 120, 2));
    expect(out).toEqual([bar(B0, 100, 110, 100, 110, 2, true), bar(B0 + 60, 120, 120, 120, 120, 2)]);
    expect(s.emitted.filter((e) => e.closed)).toHaveLength(1);
  });

  it('a bucket with no trades emits nothing and the gap closes the previous one', async () => {
    const s = await fresh();
    s.push(frame(1, B0 + 10, 100, 1));
    expect(s.emitted).toHaveLength(1);
    const out = s.push(frame(2, B0 + 190, 90, 1));
    expect(out.map((e) => [e.candle.time, e.closed])).toEqual([[B0, true], [B0 + 180, false]]);
  });

  it('aligns 1d buckets to UTC midnight', async () => {
    const day = Date.UTC(2027, 0, 5) / 1000;
    const s = await fresh(86400, day - 5);
    s.push(frame(1, day + 3600, 10, 1), frame(2, day + 86399, 12, 1));
    expect(s.emitted.at(-1)!.candle.time).toBe(day);
    const out = s.push(frame(3, day + 86400, 13, 1));
    expect(out[0]).toMatchObject({ closed: true, candle: { time: day, volume: 2 } });
    expect(out[1].candle.time).toBe(day + 86400);
  });

  it('ignores a repeated or older trade_id', async () => {
    const s = await fresh();
    s.push(frame(5, B0 + 1, 100, 1));
    expect(s.push(frame(5, B0 + 1, 100, 1), frame(4, B0 + 2, 999, 9))).toEqual([]);
    expect(s.emitted.at(-1)!.candle.volume).toBe(1);
  });

  it('ignores a trade older than the current bucket (an old last_match)', async () => {
    const s = await fresh();
    s.push(frame(10, B0 + 61, 100, 1));
    expect(s.push(frame(11, B0 + 30, 50, 1, { type: 'last_match' }))).toEqual([]);
    expect(s.emitted).toHaveLength(1);
  });

  it('yields nothing for non-trade frames', async () => {
    const s = await fresh();
    expect(s.push('{"type":"subscriptions"}', frame(1, B0, 1, 1, { product_id: 'ETH-USD' }))).toEqual([]);
  });
});

describe('seeding from the REST candle', () => {
  const restWith = (...rows: number[][]): Rest => () => rows;

  it('asks for the current bucket through the REST candles endpoint', async () => {
    const s = setup(60, B0 + 10, restWith());
    s.open();
    await flush();
    const u = new URL(s.fetched.urls[0]);
    expect(u.origin + u.pathname).toBe('https://api.exchange.coinbase.com/products/BTC-USD/candles');
    expect(u.searchParams.get('granularity')).toBe('60');
    expect(u.searchParams.get('start')).toBe(new Date(B0 * 1000).toISOString());
    expect(u.searchParams.get('end')).toBe(new Date((B0 + 60) * 1000).toISOString());
  });

  it('buffers trades and emits nothing until the seed settles, then emits the merged bar', async () => {
    const s = setup(60, B0 + 10, restWith(row(B0, 100, 110, 95, 105, 10)));
    s.open();
    // arrives before the seed settled: one before the open time, two after
    s.push(frame(1, B0 + 8, 130, 2), frame(2, B0 + 11, 90, 1), frame(3, B0 + 12, 106, 3));
    expect(s.emitted).toEqual([]);
    await flush();
    // pre-open trade widens high/low only; the two later ones add volume and set close
    expect(s.emitted).toEqual([bar(B0, 100, 130, 90, 106, 14)]);
  });

  it('keeps folding later trades onto the seeded bar, and a late pre-open trade only widens', async () => {
    const s = setup(60, B0 + 10, restWith(row(B0, 100, 110, 95, 105, 10)));
    s.open();
    await flush();
    expect(s.emitted).toEqual([bar(B0, 100, 110, 95, 105, 10)]);
    s.push(frame(1, B0 + 5, 120, 4)); // before the open time
    expect(s.emitted.at(-1)).toEqual(bar(B0, 100, 120, 95, 105, 10));
    s.push(frame(2, B0 + 20, 107, 1));
    expect(s.emitted.at(-1)).toEqual(bar(B0, 100, 120, 95, 107, 11));
  });

  it('builds the bucket from the trades alone when REST has no row', async () => {
    const s = setup(60, B0 + 10, restWith());
    s.open();
    s.push(frame(1, B0 + 4, 100, 1), frame(2, B0 + 12, 103, 2));
    await flush();
    expect(s.emitted).toEqual([bar(B0, 100, 103, 100, 103, 3)]);
  });

  it('emits nothing for an empty seed with no trades', async () => {
    const s = setup(60, B0 + 10, restWith());
    s.open();
    await flush();
    expect(s.emitted).toEqual([]);
  });

  it('a bucket that starts after the open time needs no seed', async () => {
    let calls = 0;
    const s = setup(60, B0 + 10, () => {
      calls++;
      return [row(B0, 100, 110, 95, 105, 10)];
    });
    s.open();
    await flush();
    s.push(frame(1, B0 + 70, 200, 1));
    expect(calls).toBe(1);
    expect(s.emitted.at(-1)).toEqual(bar(B0 + 60, 200, 200, 200, 200, 1));
  });

  it('a newer bucket arriving before the seed settles drops the seed and proceeds from trades', async () => {
    const s = setup(60, B0 + 10, restWith(row(B0, 100, 110, 95, 105, 10)));
    s.open();
    s.push(frame(1, B0 + 5, 100, 1), frame(2, B0 + 65, 300, 2));
    await flush();
    expect(s.emitted).toEqual([bar(B0 + 60, 300, 300, 300, 300, 2)]);
    s.push(frame(3, B0 + 70, 301, 1));
    expect(s.emitted.at(-1)).toEqual(bar(B0 + 60, 300, 301, 300, 301, 3));
  });

  it('resets on a reconnect: a second seed replaces the state', async () => {
    const s = setup(60, B0 + 10, restWith(row(B0, 100, 110, 95, 105, 10)));
    s.open();
    await flush();
    s.push(frame(5, B0 + 12, 108, 1));
    s.setNow(B0 + 30);
    s.open(); // reconnect: trade ids may restart from the stream's replay
    s.push(frame(5, B0 + 12, 108, 1)); // buffered again, before the new open time
    await flush();
    expect(s.emitted.at(-1)).toEqual(bar(B0, 100, 110, 95, 105, 10));
    expect(s.fetched.urls).toHaveLength(2);
  });

  it('logs one warning on a failed seed, emits nothing, retries after 15 s and then succeeds', async () => {
    let fail = true;
    const s = setup(60, B0 + 10, () => (fail ? new Response('nope', { status: 400 }) : [row(B0, 100, 110, 95, 105, 10)]));
    s.open();
    s.push(frame(1, B0 + 12, 106, 1));
    await flush();
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]).toMatch(/^warning: Could not seed the live candle from Coinbase/);
    expect(s.emitted).toEqual([]);
    expect(s.timers.delays()).toEqual([SEED_RETRY_MS]);
    s.push(frame(2, B0 + 13, 107, 1));
    expect(s.emitted).toEqual([]);
    fail = false;
    s.setNow(B0 + 25);
    s.timers.advance(SEED_RETRY_MS);
    await flush();
    expect(s.fetched.urls).toHaveLength(2);
    expect(s.emitted).toEqual([bar(B0, 100, 110, 95, 107, 12)]);
    expect(s.timers.pending).toBe(0);
  });

  it('stops retrying when the bucket ended, and the next bucket proceeds unseeded', async () => {
    const s = setup(60, B0 + 10, () => new Response('nope', { status: 400 }));
    s.open();
    await flush();
    s.setNow(B0 + 70);
    s.timers.advance(SEED_RETRY_MS);
    await flush();
    expect(s.timers.pending).toBe(0);
    s.push(frame(1, B0 + 30, 1, 1)); // the dead bucket's late trade is ignored
    expect(s.emitted).toEqual([]);
    s.push(frame(2, B0 + 80, 50, 2));
    expect(s.emitted).toEqual([bar(B0 + 60, 50, 50, 50, 50, 2)]);
  });

  it('a seed that settles after the connection closed emits nothing', async () => {
    const s = setup(60, B0 + 10, restWith(row(B0, 100, 110, 95, 105, 10)));
    s.open();
    s.closers.forEach((fn) => fn());
    await flush();
    expect(s.emitted).toEqual([]);
  });

  it('a seed that settles after a newer open emits nothing for the old one', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const rows = [row(B0, 100, 110, 95, 105, 10)];
    const timers = fakeTimers();
    let n = 0;
    const fetch = (async () => {
      const mine = ++n;
      if (mine === 1) await gate;
      return new Response(JSON.stringify(mine === 1 ? [row(B0, 1, 1, 1, 1, 1)] : rows), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const feed = coinbaseCandleFeed(SYMBOL, 60, { fetch, now: () => (B0 + 10) * 1000 });
    const emitted: ParsedKline[] = [];
    const ctx = (): FeedOpenContext => ({ emit: (i) => emitted.push(...i), log: () => undefined, timers, onClose: () => undefined });
    feed.onOpen!(ctx());
    feed.onOpen!(ctx());
    await flush();
    expect(emitted).toEqual([bar(B0, 100, 110, 95, 105, 10)]);
    release();
    await flush();
    expect(emitted).toHaveLength(1);
  });

  it('clears the retry timer when the connection closes', async () => {
    const s = setup(60, B0 + 10, () => new Response('nope', { status: 400 }));
    s.open();
    await flush();
    expect(s.timers.pending).toBe(1);
    s.closers.forEach((fn) => fn());
    expect(s.timers.pending).toBe(0);
  });
});
