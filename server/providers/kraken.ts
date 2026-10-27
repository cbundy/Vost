/**
 * Kraken public market data - free, no API key.
 * The OHLC endpoint only ever returns the latest 720 candles, so history depth
 * is limited.
 */
import type { Candle, SymbolSuggestion } from '../../shared/market.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import { InputError, NotFoundError, UpstreamError } from './errors.ts';
import { filterSymbols, sortCandles, sortSuggestions } from './exchange.ts';
import { cropToSpan, isoTime, noDataInSpan } from './range.ts';
import type { ProviderAdapter } from './types.ts';
import { upstreamJson } from './upstream.ts';

const PROVIDER = 'Kraken';
const HOST = 'https://api.kraken.com';
export const KRAKEN_MAX_CANDLES = 720;
const POPULAR = catalogEntry('kraken')!.popularSymbols;

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

type KrakenResponse<T> = { error?: string[]; result?: T };

function failOnError(res: KrakenResponse<unknown>): void {
  if (res.error && res.error.length > 0) throw new UpstreamError(PROVIDER, new URL(HOST).hostname, 200, '', `${PROVIDER}: ${res.error.join(', ')}`);
}

/** Rows are [time(s), open, high, low, close, vwap, volume, count]. */
export function parseKrakenOhlc(res: KrakenResponse<Record<string, unknown>>): Candle[] {
  failOnError(res);
  const key = Object.keys(res.result ?? {}).find((k) => k !== 'last');
  const rows = key ? (res.result![key] as unknown[][]) : [];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    time: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[6]),
  }));
}

type AssetPair = { altname: string; wsname?: string; status?: string };

const fixAsset = (a: string): string => (a === 'XBT' ? 'BTC' : a === 'XDG' ? 'DOGE' : a);

export function parseKrakenPairs(res: KrakenResponse<Record<string, AssetPair>>): SymbolSuggestion[] {
  failOnError(res);
  return sortSuggestions(
    Object.values(res.result ?? {})
      .filter((p) => p.wsname && (p.status === undefined || p.status === 'online'))
      .map((p) => ({
        symbol: p.altname,
        label: p.wsname!.split('/').map(fixAsset).join(' / '),
        exchange: 'Kraken',
        type: 'crypto',
      })),
  );
}

export const krakenAdapter: ProviderAdapter = {
  id: 'kraken',

  async search(ctx, query) {
    if (!query.trim()) return POPULAR;
    const all = await ctx.symbols.get('kraken', async () =>
      parseKrakenPairs(await upstreamJson(PROVIDER, `${HOST}/0/public/AssetPairs`, { fetch: ctx.fetch })),
    );
    return filterSymbols(all, query);
  },

  async history(ctx, req) {
    const interval = KRAKEN_INTERVALS[req.timeframe];
    if (!interval) throw new InputError(`Kraken does not support timeframe ${req.timeframe}`);
    const symbol = req.symbol.trim().toUpperCase();
    const res = await upstreamJson<KrakenResponse<Record<string, unknown>>>(
      PROVIDER,
      `${HOST}/0/public/OHLC?pair=${encodeURIComponent(symbol)}&interval=${interval}`,
      ctx,
    );
    const all = sortCandles(parseKrakenOhlc(res));
    const range = req.from !== undefined;
    if (all.length > 0 && req.to !== undefined && req.to < all[0].time) {
      throw new NotFoundError(`Kraken serves only the latest ${KRAKEN_MAX_CANDLES} candles, from ${isoTime(all[0].time)}; pick a later range or another provider`);
    }
    const inSpan = cropToSpan(all, req.from, req.to);
    const candles = range ? inSpan : inSpan.slice(-Math.min(Math.max(1, req.bars), KRAKEN_MAX_CANDLES));
    if (candles.length === 0 && range && all.length > 0) throw noDataInSpan(PROVIDER, symbol, req.timeframe, req.from!, req.to!);
    if (candles.length === 0) throw new NotFoundError(`No data returned for ${symbol}. Check the symbol (e.g. XBTUSD).`);
    return candles;
  },
};
