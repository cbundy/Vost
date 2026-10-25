/**
 * Realtime candle streams, still opened by the browser straight from the
 * exchanges' public websockets (the server moves them in a later change).
 * Keyed by provider id; ./index.ts attaches `startLive` from here exactly
 * when the shared catalog says `supportsLive`. These wss:// hosts are the
 * only upstream host names left in the client.
 */
import { startBinanceLive } from '../live';
import { startLiveSocket, unsupportedLive, type ParsedKline } from '../liveSocket';
import type { LiveHandle, LiveOptions } from './http';

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

/** WebSocket URL used by lib/live.ts (public data streams). */
export function binanceStreamUrl(symbol: string, interval: string): string {
  return `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`;
}

export function binanceStreamFallbackUrl(symbol: string, interval: string): string {
  return `wss://data-stream.binance.vision/ws/${symbol.toLowerCase()}@kline_${interval}`;
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

const okxRowToKline = (r: string[]): ParsedKline['candle'] => ({
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
  return msg.data.map((r) => ({ candle: okxRowToKline(r), closed: r[8] === '1' }));
}

/* ------------------------------- start live ------------------------------- */

type StartLive = (opts: LiveOptions) => LiveHandle;

const startKrakenLive: StartLive = (opts) => {
  const interval = KRAKEN_INTERVALS[opts.timeframe];
  if (!interval) return unsupportedLive(opts, opts.timeframe);
  const symbol = krakenWsSymbol(opts.symbol.trim().toUpperCase());
  return startLiveSocket({
    url: 'wss://ws.kraken.com/v2',
    onOpen: (ws) => ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ohlc', symbol: [symbol], interval } })),
    parse: parseKrakenWs,
    onKline: opts.onKline,
    onStatus: opts.onStatus,
  });
};

const startBybitLive: StartLive = (opts) => {
  const interval = BYBIT_INTERVALS[opts.timeframe];
  if (!interval) return unsupportedLive(opts, opts.timeframe);
  const topic = `kline.${interval}.${opts.symbol.trim().toUpperCase()}`;
  return startLiveSocket({
    url: 'wss://stream.bybit.com/v5/public/spot',
    onOpen: (ws) => ws.send(JSON.stringify({ op: 'subscribe', args: [topic] })),
    parse: parseBybitWs,
    pingMs: 20000,
    ping: () => JSON.stringify({ op: 'ping' }),
    onKline: opts.onKline,
    onStatus: opts.onStatus,
  });
};

const startOkxLive: StartLive = (opts) => {
  const bar = OKX_BARS[opts.timeframe];
  if (!bar) return unsupportedLive(opts, opts.timeframe);
  const sub = { op: 'subscribe', args: [{ channel: `candle${bar}`, instId: opts.symbol.trim().toUpperCase() }] };
  return startLiveSocket({
    url: 'wss://ws.okx.com:8443/ws/v5/business',
    onOpen: (ws) => ws.send(JSON.stringify(sub)),
    parse: parseOkxWs,
    pingMs: 20000,
    ping: () => 'ping',
    onKline: opts.onKline,
    onStatus: opts.onStatus,
  });
};

/** The realtime feed of each provider that has one, by provider id. */
export const LIVE_FEEDS: Record<string, StartLive> = {
  binance: (opts) => startBinanceLive(opts),
  kraken: startKrakenLive,
  bybit: startBybitLive,
  okx: startOkxLive,
};
