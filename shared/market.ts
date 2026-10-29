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

/** Unit of an interval: minutes, hours, days, weeks, months (`M`). */
export type IntervalUnit = 'm' | 'h' | 'd' | 'w' | 'M';

/** A timeframe written as a number and a unit, such as `2h`, `3d` or `3M`. Every `Timeframe` is one. */
export type Interval = `${number}${IntervalUnit}`;

const INTERVAL_MAX: Record<IntervalUnit, number> = { m: 1440, h: 168, d: 365, w: 52, M: 12 };
const UNIT_SECONDS: Record<IntervalUnit, number> = { m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 };

/** Parses `<N><unit>` (N a positive integer without leading zeros, within the unit's range, checked as written), or null. */
export function parseInterval(raw: string): { n: number; unit: IntervalUnit } | null {
  const m = /^([1-9][0-9]*)([mhdwM])$/.exec(raw);
  if (!m) return null;
  const unit = m[2] as IntervalUnit;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n > INTERVAL_MAX[unit]) return null;
  return { n, unit };
}

/** The canonical spelling of a valid interval (whole hours and whole days folded: `120m` is `2h`, `48h` is `2d`), or null when invalid. */
export function canonicalInterval(raw: string): Interval | null {
  const p = parseInterval(raw);
  if (!p) return null;
  let { n, unit } = p;
  if (unit === 'm' && n % 60 === 0) {
    n /= 60;
    unit = 'h';
  }
  if (unit === 'h' && n % 24 === 0) {
    n /= 24;
    unit = 'd';
  }
  return `${n}${unit}`;
}

/** Seconds in one bar of an interval (a month is 30 days, as in `TIMEFRAME_SECONDS`). Throws on an invalid interval. */
export function intervalSeconds(iv: Interval): number {
  const p = parseInterval(iv);
  if (!p) throw new Error(`Invalid interval ${iv}`);
  return p.n * UNIT_SECONDS[p.unit];
}

/** Largest `bars` a history request may ask for (the top bar's largest option). */
export const MAX_BARS = 20000;

/** How many bars a `from`..`to` span (unix seconds, both inclusive) holds at most. */
export function rangeBarCount(timeframe: Interval, from: number, to: number): number {
  return Math.floor((to - from) / intervalSeconds(timeframe)) + 1;
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
  /** Timeframes the provider serves itself. */
  timeframes: Timeframe[];
  /** Timeframes the server builds from a lower native one (derived from `timeframes`, see `shared/timeframes.ts`). */
  builtTimeframes: Timeframe[];
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
/* A `?sub=<key>` stream serves several subscriptions and tags every event    */
/* with the `sub` key it belongs to.                                          */

/** Most distinct subscriptions one `/api/live?sub=` stream serves. */
export const MAX_LIVE_SUBS = 16;

/** A subscription key: `<provider>:<timeframe>:<source>:<symbol>` (the symbol may itself contain `:`). */
export function subKey(provider: string, timeframe: string, source: 'native' | 'built', symbol: string): string {
  return `${provider}:${timeframe}:${source}:${symbol}`;
}

/** Parses a subscription key (splitting on the first three `:` only), or null when malformed or the source is bad. */
export function parseSubKey(key: string): { provider: string; timeframe: string; source: 'native' | 'built'; symbol: string } | null {
  const parts: string[] = [];
  let rest = key;
  for (let i = 0; i < 3; i++) {
    const at = rest.indexOf(':');
    if (at < 0) return null;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  const [provider, timeframe, source] = parts;
  if (source !== 'native' && source !== 'built') return null;
  if (!provider || !timeframe || !rest) return null;
  return { provider, timeframe, source, symbol: rest };
}

/** State of the live feed as the server reports it (the client adds its own `off`). */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

/** Event `kline`: the current bar of the feed, `closed` once it is final. */
export interface LiveKlineEvent {
  candle: Candle;
  closed: boolean;
  /** The subscription key, on a `?sub=` stream only. */
  sub?: string;
}

/** Event `status`. `fatal` means the request can never be served: the stream ends and must not be retried. */
export interface LiveStatusEvent {
  status: LiveStatus;
  detail?: string;
  fatal?: boolean;
  /** The subscription key, on a `?sub=` stream only. */
  sub?: string;
}

/** Event `log`: one line for the in-app message log. */
export interface LiveLogEvent {
  severity: 'info' | 'success' | 'warning' | 'error';
  text: string;
  /** The subscription key, on a `?sub=` stream only. */
  sub?: string;
}

/** Describes a websocket close event for the logs. */
export function formatClose(ev: { code?: number; reason?: string; wasClean?: boolean }): string {
  return `close code ${ev.code ?? 'unknown'}, reason ${ev.reason ? `"${ev.reason}"` : '(none)'}, wasClean ${String(ev.wasClean ?? false)}`;
}
