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

/** Largest `bars` a history request may ask for (the top bar's largest option). */
export const MAX_BARS = 20000;

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
  /** The browser can open a realtime stream for this provider (until the server takes that over). */
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
