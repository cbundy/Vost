/**
 * Hyperliquid's candle websocket. The coin to subscribe to (exact case, or
 * `@<index>` for spot) needs a market-list lookup, so the subscribe message is
 * resolved asynchronously on every open. The stream has no close flag: a
 * candle counts as closed once a frame with a newer `t` arrives.
 */
import { HYPERLIQUID_INTERVALS, liveSymbols, resolveMarket, type HyperliquidKind } from '../providers/hyperliquid.ts';
import type { LiveFeed, LiveFeedDeps, ParsedKline } from './feeds.ts';

const WS_URL = 'wss://api.hyperliquid.xyz/ws';

type Frame = { channel?: string; data?: { t: number; s: string; i: string; o: string; h: string; l: string; c: string; v: string } };

/** `null` when the timeframe has no Hyperliquid interval. */
export function hyperliquidFeed(kind: HyperliquidKind, symbol: string, timeframe: string, deps: LiveFeedDeps = {}): LiveFeed | null {
  const interval = HYPERLIQUID_INTERVALS[timeframe];
  if (!interval) return null;
  let coin: string | undefined;
  /** The newest candle seen on this connection. */
  let last: ParsedKline['candle'] | undefined;

  return {
    url: WS_URL,
    subscribe: async () => {
      const market = await resolveMarket(kind, symbol, { fetch: deps.fetch }, liveSymbols);
      coin = market.coin;
      return JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin, interval } });
    },
    pingMs: 20000,
    ping: JSON.stringify({ method: 'ping' }),
    onOpen: () => {
      last = undefined;
    },
    parse: (raw) => {
      const msg = JSON.parse(raw) as Frame;
      const d = msg.data;
      if (msg.channel !== 'candle' || !d || d.s !== coin || d.i !== interval) return [];
      const candle = {
        time: Math.floor(Number(d.t) / 1000),
        open: Number(d.o),
        high: Number(d.h),
        low: Number(d.l),
        close: Number(d.c),
        volume: Number(d.v),
      };
      const previous = last;
      if (previous && candle.time < previous.time) return []; // a stale frame
      last = candle;
      const out: ParsedKline[] = [];
      if (previous && candle.time > previous.time) out.push({ candle: previous, closed: true });
      out.push({ candle, closed: false });
      return out;
    },
  };
}
