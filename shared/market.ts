/**
 * Wire types shared by the server and the client: what `/api/*` sends and
 * receives. Erasable TypeScript only (the server runs it by type stripping),
 * and no imports outside `shared/`.
 */

/** One OHLCV bar. `time` is a UNIX timestamp in **seconds** (UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Timeframes understood by the app. Not every provider supports every timeframe. */
export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Seconds in one bar of each timeframe (a month is approximated as 30 days). */
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
  '1M': 2592000,
};

/** Largest `bars` a history request may ask for (the top bar's largest option). */
export const MAX_BARS = 20000;

/** How many bars a `from`..`to` span (unix seconds, both inclusive) holds at most. */
export function rangeBarCount(timeframe: Timeframe, from: number, to: number): number {
  return Math.floor((to - from) / TIMEFRAME_SECONDS[timeframe]) + 1;
}

export interface SymbolSuggestion {
  symbol: string;
  label?: string;
  exchange?: string;
  type?: string;
}

/** Static description of one remote data provider, served at `/api/providers`. */
export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  timeframes: Timeframe[];
  defaultTimeframe: Timeframe;
  defaultSymbol: string;
  popularSymbols: SymbolSuggestion[];
  /** The server can stream live candles for this provider (`/api/live`). */
  supportsLive: boolean;
  /** `/api/symbols` returns the provider's full tradable list. */
  hasSymbolList: boolean;
  /** `/api/search` finds symbols by name. */
  hasSearch: boolean;
}

/** Body of every non-2xx API response. */
export interface ApiError {
  error: string;
}

/* ------------------------------- live stream ------------------------------ */
/* `GET /api/live` is a server-sent-events stream of these three events.      */

/** State of the live feed as the server reports it (the client adds its own `off`). */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

/** Event `kline`: the current bar of the feed, `closed` once it is final. */
export interface LiveKlineEvent {
  candle: Candle;
  closed: boolean;
}

/** Event `status`. `fatal` means the request can never be served: the stream ends and must not be retried. */
export interface LiveStatusEvent {
  status: LiveStatus;
  detail?: string;
  fatal?: boolean;
}

/** Event `log`: one line for the in-app message log. */
export interface LiveLogEvent {
  severity: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

/** Describes a websocket close event for the logs. */
export function formatClose(ev: { code?: number; reason?: string; wasClean?: boolean }): string {
  return `close code ${ev.code ?? 'unknown'}, reason ${ev.reason ? `"${ev.reason}"` : '(none)'}, wasClean ${String(ev.wasClean ?? false)}`;
}
