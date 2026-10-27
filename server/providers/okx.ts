/**
 * OKX v5 public spot market data - free, no API key.
 * Uses `history-candles` (100 per request, `after` cursor) for deep history.
 */
import type { Candle, SymbolSuggestion } from '../../shared/market.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import { InputError, NotFoundError, UpstreamError } from './errors.ts';
import { filterSymbols, paginateBackwards, sortSuggestions } from './exchange.ts';
import { noDataInSpan } from './range.ts';
import type { ProviderAdapter } from './types.ts';
import { upstreamJson } from './upstream.ts';

const PROVIDER = 'OKX';
const HOST = 'https://www.okx.com';
const MAX_PER_REQUEST = 100;
const POPULAR = catalogEntry('okx')!.popularSymbols;

/** Timeframe -> OKX bar. */
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

type OkxResponse<T> = { code: string; msg?: string; data?: T };

function failOnError(res: OkxResponse<unknown>): void {
  if (res.code !== '0') throw new UpstreamError(PROVIDER, new URL(HOST).hostname, 200, '', `${PROVIDER}: ${res.msg || `error ${res.code}`}`);
}

/** Rows are [tsMs, open, high, low, close, vol, volCcy, volCcyQuote, confirm], newest first. */
export function parseOkxCandles(res: OkxResponse<string[][]>): Candle[] {
  failOnError(res);
  return (res.data ?? []).map((r) => ({
    time: Math.floor(Number(r[0]) / 1000),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}

type Instrument = { instId: string; baseCcy: string; quoteCcy: string; state: string };

export function parseOkxInstruments(res: OkxResponse<Instrument[]>): SymbolSuggestion[] {
  failOnError(res);
  return sortSuggestions(
    (res.data ?? [])
      .filter((i) => i.state === 'live')
      .map((i) => ({ symbol: i.instId, label: `${i.baseCcy} / ${i.quoteCcy}`, exchange: 'OKX', type: 'crypto' })),
  );
}

export const okxAdapter: ProviderAdapter = {
  id: 'okx',

  async search(ctx, query) {
    if (!query.trim()) return POPULAR;
    const all = await ctx.symbols.get('okx', async () =>
      parseOkxInstruments(await upstreamJson(PROVIDER, `${HOST}/api/v5/public/instruments?instType=SPOT`, { fetch: ctx.fetch })),
    );
    return filterSymbols(all, query);
  },

  async history(ctx, req) {
    const bar = OKX_BARS[req.timeframe];
    if (!bar) throw new InputError(`OKX does not support timeframe ${req.timeframe}`);
    const symbol = req.symbol.trim().toUpperCase();
    const range = req.from !== undefined;
    const candles = await paginateBackwards(
      { bars: Math.max(1, req.bars), from: req.from, to: req.to },
      async (before) => {
        // `after` is exclusive: (to + 1) s keeps the candle opening at `to`.
        const first = req.to === undefined ? '' : `&after=${(req.to + 1) * 1000}`;
        const after = before === undefined ? first : `&after=${before * 1000}`;
        return parseOkxCandles(
          await upstreamJson(PROVIDER, `${HOST}/api/v5/market/history-candles?instId=${encodeURIComponent(symbol)}&bar=${bar}&limit=${MAX_PER_REQUEST}${after}`, ctx),
        );
      },
      ctx.signal,
    );
    if (candles.length === 0 && range) throw noDataInSpan(PROVIDER, symbol, req.timeframe, req.from!, req.to!);
    if (candles.length === 0) throw new NotFoundError(`No data returned for ${symbol}. Check the symbol (e.g. BTC-USDT).`);
    return candles;
  },
};
