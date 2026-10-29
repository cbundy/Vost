/**
 * Coinbase has no candle stream on its public websocket, so the server builds
 * each candle from the `matches` (trade) channel. A bar that starts mid-way
 * (first connect, or a reconnect) is seeded from Coinbase's own REST candle so
 * the live bar never looks smaller than the real one. See `coinbaseCandleFeed`.
 */
import type { Candle } from '../../shared/market.ts';
import { COINBASE_HOST, parseCoinbaseCandles } from '../providers/coinbase.ts';
import { upstreamJson, type FetchFn } from '../providers/upstream.ts';
import type { FeedOpenContext, LiveFeed, ParsedKline } from './feeds.ts';

/** Pause before the seed is asked again after it failed. */
export const SEED_RETRY_MS = 15_000;

export interface Trade {
  id: number;
  /** Seconds since the epoch, with the fraction. */
  time: number;
  price: number;
  size: number;
}

/** One `match` / `last_match` frame of the subscribed product, or null for anything else. */
export function parseCoinbaseMatch(raw: string, symbol: string): Trade | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!msg || (msg.type !== 'match' && msg.type !== 'last_match') || msg.product_id !== symbol) return null;
  const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';
  if (!present(msg.trade_id) || !present(msg.price) || !present(msg.size) || !present(msg.time)) return null;
  const id = Number(msg.trade_id);
  const price = Number(msg.price);
  const size = Number(msg.size);
  const time = Date.parse(String(msg.time)) / 1000;
  if (![id, price, size, time].every(Number.isFinite)) return null;
  return { id, time, price, size };
}

export interface CoinbaseCandleDeps {
  fetch?: FetchFn;
  /** Clock in ms; defaults to `Date.now`. */
  now?: () => number;
}

interface Bar {
  candle: Candle;
  /** Time of the trade (or seed) that set the close. */
  closeAt: number;
  /** Seeded from REST: trades before the open time are already in it. */
  seeded: boolean;
}

interface Pending {
  bucket: number;
  trades: Trade[];
}

/**
 * The `LiveFeed` parts that turn trades into candles for `symbol` at
 * `granularity` seconds: `parse` and `onOpen`. The caller adds url and subscribe.
 */
export function coinbaseCandleFeed(symbol: string, granularity: number, deps: CoinbaseCandleDeps = {}): Pick<LiveFeed, 'parse' | 'onOpen'> {
  const now = deps.now ?? Date.now;
  const bucketOf = (t: number): number => Math.floor(t / granularity) * granularity;

  let cur: Bar | null = null;
  let lastId = -Infinity;
  /** Trades in buckets before this are ignored. */
  let minBucket = -Infinity;
  /** The bucket being seeded: trades are buffered and nothing is emitted for it. */
  let pending: Pending | null = null;
  /** When the connection opened; trades before it may already be in the REST candle. */
  let openedAt = 0;
  /** Bumped on every open: a seed answer from an older connection is dropped. */
  let generation = 0;
  let retryTimer: unknown;
  let retryTimers: FeedOpenContext['timers'] | null = null;

  const snapshot = (): ParsedKline => ({ candle: { ...cur!.candle }, closed: false });

  const startBar = (t: Trade): void => {
    cur = {
      candle: { time: bucketOf(t.time), open: t.price, high: t.price, low: t.price, close: t.price, volume: t.size },
      closeAt: t.time,
      seeded: false,
    };
  };

  const fold = (bar: Bar, t: Trade): void => {
    const c = bar.candle;
    c.high = Math.max(c.high, t.price);
    c.low = Math.min(c.low, t.price);
    if (t.time >= bar.closeAt) {
      c.close = t.price;
      bar.closeAt = t.time;
    }
    if (!(bar.seeded && t.time < openedAt)) c.volume += t.size; // an earlier trade is in the REST volume
  };

  const clearRetry = (): void => {
    if (retryTimer !== undefined) retryTimers?.clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const dropPending = (): void => {
    if (pending) minBucket = Math.max(minBucket, pending.bucket + granularity);
    pending = null;
    clearRetry();
  };

  /** Folds a trade outside any seeding; returns what to publish. */
  const apply = (t: Trade): ParsedKline[] => {
    const b = bucketOf(t.time);
    if (b < minBucket) return [];
    const out: ParsedKline[] = [];
    if (cur && b < cur.candle.time) return [];
    if (cur && b > cur.candle.time) {
      out.push({ candle: { ...cur.candle }, closed: true });
      cur = null;
    }
    if (cur) fold(cur, t);
    else startBar(t);
    out.push(snapshot());
    return out;
  };

  const settle = (bucket: number, rows: Candle[]): ParsedKline[] => {
    const buffered = pending!.trades;
    pending = null;
    const row = rows.find((r) => r.time === bucket && [r.open, r.high, r.low, r.close, r.volume].every(Number.isFinite));
    cur = row ? { candle: { ...row }, closeAt: openedAt, seeded: true } : null;
    for (const t of buffered) {
      if (cur) fold(cur, t);
      else startBar(t);
    }
    return cur ? [snapshot()] : [];
  };

  return {
    parse(raw) {
      const t = parseCoinbaseMatch(raw, symbol);
      if (!t || t.id <= lastId) return [];
      lastId = t.id;
      const b = bucketOf(t.time);
      if (pending) {
        if (b < pending.bucket) return [];
        if (b === pending.bucket) {
          pending.trades.push(t);
          return [];
        }
        dropPending(); // the bucket ended before the seed settled: the next one is complete from trades
      }
      return apply(t);
    },

    onOpen(ctx) {
      generation++;
      const mine = generation;
      clearRetry();
      retryTimers = ctx.timers;
      ctx.onClose(() => {
        if (generation === mine) {
          pending = null;
          clearRetry();
        }
      });
      cur = null;
      lastId = -Infinity;
      minBucket = -Infinity;
      openedAt = now() / 1000;
      const bucket = bucketOf(openedAt);
      pending = { bucket, trades: [] };

      const seed = async (): Promise<void> => {
        if (generation !== mine || !pending || pending.bucket !== bucket) return;
        const qs = `granularity=${granularity}&start=${new Date(bucket * 1000).toISOString()}&end=${new Date((bucket + granularity) * 1000).toISOString()}`;
        let rows: Candle[];
        try {
          rows = parseCoinbaseCandles(await upstreamJson('Coinbase', `${COINBASE_HOST}/products/${encodeURIComponent(symbol)}/candles?${qs}`, { fetch: deps.fetch }));
        } catch (err) {
          if (generation !== mine || !pending || pending.bucket !== bucket) return;
          const why = err instanceof Error ? err.message : String(err);
          if (now() / 1000 >= bucket + granularity) {
            dropPending(); // the bucket is over: the next one is complete from trades
            return;
          }
          ctx.log('warning', `Could not seed the live candle from Coinbase (${why}); retrying in ${SEED_RETRY_MS / 1000} s.`);
          retryTimer = ctx.timers.setTimeout(() => {
            retryTimer = undefined;
            void seed();
          }, SEED_RETRY_MS);
          return;
        }
        if (generation !== mine || !pending || pending.bucket !== bucket) return;
        ctx.emit(settle(bucket, rows));
      };
      void seed();
    },
  };
}
