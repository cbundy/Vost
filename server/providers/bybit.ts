/**
 * Bybit v5 public spot market data - free, no API key.
 * Klines: 1000 per request, paginated backwards with `end`.
 */
import type { Candle, SymbolSuggestion } from '../../shared/market.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import { InputError, NotFoundError, UpstreamError } from './errors.ts';
import { filterSymbols, paginateBackwards, sortSuggestions } from './exchange.ts';
import type { ProviderAdapter } from './types.ts';
import { upstreamJson } from './upstream.ts';

const PROVIDER = 'Bybit';
const HOST = 'https://api.bybit.com';
const MAX_PER_REQUEST = 1000;
const POPULAR = catalogEntry('bybit')!.popularSymbols;

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

type BybitResponse<T> = { retCode: number; retMsg?: string; result?: T };

function failOnError(res: BybitResponse<unknown>): void {
  if (res.retCode !== 0) throw new UpstreamError(PROVIDER, new URL(HOST).hostname, 200, '', `${PROVIDER}: ${res.retMsg || `error ${res.retCode}`}`);
}

/** Rows are [startMs, open, high, low, close, volume, turnover], newest first. */
export function parseBybitKlines(res: BybitResponse<{ list?: string[][] }>): Candle[] {
  failOnError(res);
  return (res.result?.list ?? []).map((r) => ({
    time: Math.floor(Number(r[0]) / 1000),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}

type Instrument = { symbol: string; baseCoin: string; quoteCoin: string; status: string };

export function parseBybitInstruments(res: BybitResponse<{ list?: Instrument[] }>): SymbolSuggestion[] {
  failOnError(res);
  return sortSuggestions(
    (res.result?.list ?? [])
      .filter((i) => i.status === 'Trading')
      .map((i) => ({ symbol: i.symbol, label: `${i.baseCoin} / ${i.quoteCoin}`, exchange: 'Bybit', type: 'crypto' })),
  );
}

export const bybitAdapter: ProviderAdapter = {
  id: 'bybit',

  async search(ctx, query) {
    if (!query.trim()) return POPULAR;
    const all = await ctx.symbols.get('bybit', async () =>
      parseBybitInstruments(await upstreamJson(PROVIDER, `${HOST}/v5/market/instruments-info?category=spot`, { fetch: ctx.fetch })),
    );
    return filterSymbols(all, query);
  },

  async history(ctx, req) {
    const interval = BYBIT_INTERVALS[req.timeframe];
    if (!interval) throw new InputError(`Bybit does not support timeframe ${req.timeframe}`);
    const symbol = req.symbol.trim().toUpperCase();
    const bars = Math.max(1, req.bars);
    const candles = await paginateBackwards(
      bars,
      async (before) => {
        const limit = Math.min(MAX_PER_REQUEST, bars);
        const end = before === undefined ? '' : `&end=${before * 1000 - 1}`;
        return parseBybitKlines(
          await upstreamJson(PROVIDER, `${HOST}/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}${end}`, ctx),
        );
      },
      ctx.signal,
    );
    if (candles.length === 0) throw new NotFoundError(`No data returned for ${symbol}. Check the symbol (e.g. BTCUSDT).`);
    return candles;
  },
};
