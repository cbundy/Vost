/**
 * The exchanges' public websocket feeds: URLs, interval maps, subscribe and
 * keepalive messages, and the parsers that turn one frame into candles.
 * `liveFeed()` is the only entry point the relay needs.
 */
import { catalogEntry } from '../../shared/providerCatalog.ts';
import type { Candle } from '../../shared/market.ts';

export interface ParsedKline {
  candle: Candle;
  closed: boolean;
}

export interface LiveFeed {
  url: string;
  /** Mirror host tried after `fallbackAfter` failed attempts. */
  fallbackUrl?: string;
  fallbackAfter?: number;
  /** Sent on every (re)connect once the socket is open. */
  subscribe?: string;
  /** Keepalive: send `ping` every `pingMs` while open. */
  pingMs?: number;
  ping?: string;
  /** Maps one raw frame to zero or more candles; may throw on a malformed frame. */
  parse: (raw: string) => ParsedKline[];
}

/** What a feed needs to be built: the provider's own wording of the error otherwise. */
export type FeedResult = { feed: LiveFeed } | { error: string };

/* --------------------------------- Binance -------------------------------- */

export const BINANCE_INTERVALS: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
  '1M': '1M',
};

export function parseBinanceWs(raw: string): ParsedKline[] {
  const data = JSON.parse(raw) as {
    k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean };
  };
  const k = data.k;
  if (!k) return [];
  return [
    {
      candle: {
        time: Math.floor(k.t / 1000),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v),
      },
      closed: k.x,
    },
  ];
}

/* --------------------------------- Kraken --------------------------------- */

/** Timeframe -> interval in minutes. */
export const KRAKEN_INTERVALS: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

/** Websocket v2 symbol (`BTC/USD`) for a REST pair name (`XBTUSD`). */
export function krakenWsSymbol(pair: string): string {
  const p = pair.replace(/^XBT/, 'BTC').replace(/XBT$/, 'BTC');
  const m = /^(.+?)(USDT|USDC|USD|EUR|GBP|CAD|AUD|JPY|CHF|BTC|ETH)$/.exec(p);
  return m ? `${m[1]}/${m[2]}` : p;
}

/** One frame of the v2 ohlc channel -> candles (`interval_begin` is ISO time). */
export function parseKrakenWs(raw: string): ParsedKline[] {
  const msg = JSON.parse(raw) as { channel?: string; data?: Array<Record<string, unknown>> };
  if (msg.channel !== 'ohlc' || !Array.isArray(msg.data)) return [];
  return msg.data.map((d) => ({
    candle: {
      time: Math.floor(Date.parse(String(d.interval_begin)) / 1000),
      open: Number(d.open),
      high: Number(d.high),
      low: Number(d.low),
      close: Number(d.close),
      volume: Number(d.volume),
    },
    closed: false, // the channel carries no close flag
  }));
}

/* --------------------------------- Bybit ---------------------------------- */

/** Timeframe -> Bybit interval (minutes, or D/W/M). */
export const BYBIT_INTERVALS: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
};

/** Frame on topic `kline.<interval>.<symbol>`; `start` is in ms, `confirm` marks a closed candle. */
export function parseBybitWs(raw: string): ParsedKline[] {
  const msg = JSON.parse(raw) as { topic?: string; data?: Array<Record<string, unknown>> };
  if (!msg.topic?.startsWith('kline.') || !Array.isArray(msg.data)) return [];
  return msg.data.map((d) => ({
    candle: {
      time: Math.floor(Number(d.start) / 1000),
      open: Number(d.open),
      high: Number(d.high),
      low: Number(d.low),
      close: Number(d.close),
      volume: Number(d.volume),
    },
    closed: d.confirm === true,
  }));
}

/* ---------------------------------- OKX ----------------------------------- */

/** Timeframe -> OKX bar, which is also the suffix of the `candle<bar>` ws channel. */
export const OKX_BARS: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
  '1w': '1W',
  '1M': '1M',
};

const okxRowToCandle = (r: string[]): Candle => ({
  time: Math.floor(Number(r[0]) / 1000),
  open: Number(r[1]),
  high: Number(r[2]),
  low: Number(r[3]),
  close: Number(r[4]),
  volume: Number(r[5]),
});

/** Frame from the `candle<bar>` channel; the last field of a row is `confirm` ('1' = closed). */
export function parseOkxWs(raw: string): ParsedKline[] {
  if (raw === 'pong') return [];
  const msg = JSON.parse(raw) as { arg?: { channel?: string }; data?: string[][] };
  if (!msg.arg?.channel?.startsWith('candle') || !Array.isArray(msg.data)) return [];
  return msg.data.map((r) => ({ candle: okxRowToCandle(r), closed: r[8] === '1' }));
}

/* --------------------------------- lookup --------------------------------- */

const unsupported = (timeframe: string): FeedResult => ({ error: `Live data does not support ${timeframe}` });

/** `symbol` is the trimmed, upper-cased symbol as the provider's REST API spells it. */
export function liveFeed(provider: string, symbol: string, timeframe: string): FeedResult {
  switch (provider) {
    case 'binance': {
      const interval = BINANCE_INTERVALS[timeframe];
      if (!interval) return unsupported(timeframe);
      const path = `/ws/${symbol.toLowerCase()}@kline_${interval}`;
      return {
        feed: {
          url: `wss://stream.binance.com:9443${path}`,
          fallbackUrl: `wss://data-stream.binance.vision${path}`,
          fallbackAfter: 3,
          parse: parseBinanceWs,
        },
      };
    }
    case 'kraken': {
      const interval = KRAKEN_INTERVALS[timeframe];
      if (!interval) return unsupported(timeframe);
      return {
        feed: {
          url: 'wss://ws.kraken.com/v2',
          subscribe: JSON.stringify({ method: 'subscribe', params: { channel: 'ohlc', symbol: [krakenWsSymbol(symbol)], interval } }),
          parse: parseKrakenWs,
        },
      };
    }
    case 'bybit': {
      const interval = BYBIT_INTERVALS[timeframe];
      if (!interval) return unsupported(timeframe);
      return {
        feed: {
          url: 'wss://stream.bybit.com/v5/public/spot',
          subscribe: JSON.stringify({ op: 'subscribe', args: [`kline.${interval}.${symbol}`] }),
          pingMs: 20000,
          ping: JSON.stringify({ op: 'ping' }),
          parse: parseBybitWs,
        },
      };
    }
    case 'okx': {
      const bar = OKX_BARS[timeframe];
      if (!bar) return unsupported(timeframe);
      return {
        feed: {
          url: 'wss://ws.okx.com:8443/ws/v5/business',
          subscribe: JSON.stringify({ op: 'subscribe', args: [{ channel: `candle${bar}`, instId: symbol }] }),
          pingMs: 20000,
          ping: 'ping',
          parse: parseOkxWs,
        },
      };
    }
    default: {
      const name = catalogEntry(provider)?.name;
      return { error: name ? `${name} does not offer live data` : `Unknown provider "${provider}"` };
    }
  }
}
