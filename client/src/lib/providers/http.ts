/**
 * The provider contract the store and the UI program against. Remote providers
 * are built from the shared catalog in ./index.ts and call the server through
 * ./api.ts; the demo provider lives entirely in the browser.
 */
import type { Candle, LiveStatus as ServerLiveStatus, SymbolSuggestion, Timeframe } from '../../../../shared/market.ts';

export type { SymbolSuggestion };

export interface HistoryRequest {
  symbol: string;
  timeframe: Timeframe;
  /** Target number of bars (the provider may return fewer). */
  bars: number;
  /** Time span (unix seconds, both ends inclusive); with `from` the span wins over `bars`. */
  from?: number;
  to?: number;
}

/** The server's feed states, plus `off` for a stream the client closed. */
export type LiveStatus = 'off' | ServerLiveStatus;

export interface LiveHandle {
  stop(): void;
}

export interface LiveOptions {
  symbol: string;
  timeframe: string;
  onKline: (candle: Candle, isClosed: boolean) => void;
  onStatus: (status: LiveStatus, detail?: string) => void;
  /** One entry per failure, for the in-app message log. */
  onLog?: (severity: 'info' | 'success' | 'warning' | 'error', text: string) => void;
}

export interface DataProvider {
  id: string;
  name: string;
  description: string;
  /** Works without any network connection. */
  offline?: boolean;
  /** Supports realtime updates through the server's `/api/live` stream (true exactly when `startLive` is present). */
  supportsLive?: boolean;
  /** Opens a realtime candle stream; present only when `supportsLive` is true. */
  startLive?(opts: LiveOptions): LiveHandle;
  timeframes: Timeframe[];
  defaultTimeframe: Timeframe;
  defaultSymbol: string;
  popularSymbols: SymbolSuggestion[];
  /** The provider's full tradable list, when it has one (browsable in the symbol search). */
  listSymbols?(signal?: AbortSignal): Promise<SymbolSuggestion[]>;
  searchSymbols?(query: string, signal?: AbortSignal): Promise<SymbolSuggestion[]>;
  fetchHistory(req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]>;
}
