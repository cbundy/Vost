/**
 * Coinbase Exchange public market data - free, no API key.
 * Candles: 300 per request, paginated backwards by time window. The public
 * websocket feed has no candle channel, so live streaming is not offered.
 */
import type { Candle } from '../../types';
import { filterSymbols, loadCachedSymbols, paginateBackwards, sortSuggestions } from './exchange';
import { fetchJson, type DataProvider, type HistoryRequest, type SymbolSuggestion } from './http';

const HOST = 'https://api.exchange.coinbase.com';
const MAX_PER_REQUEST = 300;
const CACHE_KEY = 'coinbase.symbols.v1';

/** Timeframe -> granularity in seconds (Coinbase has no 30m, 4h, 1w or 1M). */
export const COINBASE_GRANULARITY: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '1d': 86400,
};

/** Rows are [time(s), low, high, open, close, volume], newest first. */
export function parseCoinbaseCandles(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r: unknown[]) => ({
    time: Number(r[0]),
    low: Number(r[1]),
    high: Number(r[2]),
    open: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}

type Product = { id: string; base_currency: string; quote_currency: string; status: string; trading_disabled?: boolean };

export function parseCoinbaseProducts(products: Product[]): SymbolSuggestion[] {
  return sortSuggestions(
    products
      .filter((p) => p.status === 'online' && !p.trading_disabled)
      .map((p) => ({ symbol: p.id, label: `${p.base_currency} / ${p.quote_currency}`, exchange: 'Coinbase', type: 'crypto' })),
  );
}

const POPULAR_SYMBOLS: SymbolSuggestion[] = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'].map((b) => ({
  symbol: `${b}-USD`,
  label: `${b} / USD`,
  exchange: 'Coinbase',
  type: 'crypto',
}));

export const coinbaseProvider: DataProvider = {
  id: 'coinbase',
  name: 'Coinbase',
  description: 'Free public crypto spot data from Coinbase Exchange (REST candles, 300 per request). No key needed. No live streaming.',
  needsProxy: false,
  timeframes: ['1m', '5m', '15m', '1h', '1d'],
  defaultTimeframe: '1h',
  defaultSymbol: 'BTC-USD',
  popularSymbols: POPULAR_SYMBOLS,

  async searchSymbols(query, signal) {
    if (!query.trim()) return POPULAR_SYMBOLS;
    const all = await loadCachedSymbols(CACHE_KEY, async () =>
      parseCoinbaseProducts(await fetchJson<Product[]>(`${HOST}/products`, { signal })),
    );
    return filterSymbols(all, query);
  },

  async fetchHistory(req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]> {
    const gran = COINBASE_GRANULARITY[req.timeframe];
    if (!gran) throw new Error(`Coinbase does not support timeframe ${req.timeframe}`);
    const symbol = req.symbol.trim().toUpperCase();
    const candles = await paginateBackwards(
      Math.max(1, req.bars),
      async (before) => {
        const end = before ?? Math.floor(Date.now() / 1000);
        const start = end - MAX_PER_REQUEST * gran;
        const qs = `granularity=${gran}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
        return parseCoinbaseCandles(await fetchJson(`${HOST}/products/${encodeURIComponent(symbol)}/candles?${qs}`, { signal }));
      },
      signal,
    );
    if (candles.length === 0) throw new Error(`No data returned for ${symbol}. Check the symbol (e.g. BTC-USD).`);
    return candles;
  },
};
