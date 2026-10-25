/**
 * Coinbase Exchange public market data - free, no API key.
 * Candles: 300 per request, paginated backwards by time window.
 */
import type { Candle, SymbolSuggestion } from '../../shared/market.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import { InputError, NotFoundError } from './errors.ts';
import { filterSymbols, paginateBackwards, sortSuggestions } from './exchange.ts';
import type { ProviderAdapter } from './types.ts';
import { upstreamJson } from './upstream.ts';

const PROVIDER = 'Coinbase';
const HOST = 'https://api.exchange.coinbase.com';
const MAX_PER_REQUEST = 300;
const POPULAR = catalogEntry('coinbase')!.popularSymbols;

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

export const coinbaseAdapter: ProviderAdapter = {
  id: 'coinbase',

  async search(ctx, query) {
    if (!query.trim()) return POPULAR;
    const all = await ctx.symbols.get('coinbase', async () =>
      parseCoinbaseProducts(await upstreamJson<Product[]>(PROVIDER, `${HOST}/products`, { fetch: ctx.fetch })),
    );
    return filterSymbols(all, query);
  },

  async history(ctx, req) {
    const gran = COINBASE_GRANULARITY[req.timeframe];
    if (!gran) throw new InputError(`Coinbase does not support timeframe ${req.timeframe}`);
    const symbol = req.symbol.trim().toUpperCase();
    const candles = await paginateBackwards(
      Math.max(1, req.bars),
      async (before) => {
        const end = before ?? Math.floor(Date.now() / 1000);
        const start = end - MAX_PER_REQUEST * gran;
        const qs = `granularity=${gran}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
        return parseCoinbaseCandles(await upstreamJson(PROVIDER, `${HOST}/products/${encodeURIComponent(symbol)}/candles?${qs}`, ctx));
      },
      ctx.signal,
    );
    if (candles.length === 0) throw new NotFoundError(`No data returned for ${symbol}. Check the symbol (e.g. BTC-USD).`);
    return candles;
  },
};
