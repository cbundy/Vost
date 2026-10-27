import type { Candle, SymbolSuggestion, Timeframe } from '../../shared/market.ts';
import type { SymbolCache } from './symbolCache.ts';
import type { UpstreamContext } from './upstream.ts';

/** What an adapter gets per request: the injectable fetch, the abort signal and the symbol-list cache. */
export interface AdapterContext extends UpstreamContext {
  symbols: SymbolCache;
}

export interface HistoryRequest {
  symbol: string;
  timeframe: Timeframe;
  /** Target number of bars (the provider may return fewer). */
  bars: number;
  /**
   * Range mode when set (unix seconds, inclusive): return exactly the candles
   * with `from <= time <= to`, never cut by `bars`, which is ignored then.
   */
  from?: number;
  /** Newest candle time wanted (unix seconds, inclusive). Without it: now. With `bars` only, `bars` candles end here. */
  to?: number;
}

/** One REST adapter: the server-side half of a provider in the catalog. */
export interface ProviderAdapter {
  id: string;
  /** Candles ascending by time. Throws InputError, NotFoundError or UpstreamError. */
  history(ctx: AdapterContext, req: HistoryRequest): Promise<Candle[]>;
  /** The full tradable list, for providers with `hasSymbolList`. */
  listSymbols?(ctx: AdapterContext): Promise<SymbolSuggestion[]>;
  /** Suggestions for `query`; an empty query returns the provider's default list. */
  search(ctx: AdapterContext, query: string): Promise<SymbolSuggestion[]>;
}
