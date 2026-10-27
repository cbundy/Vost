/**
 * Binance public market data - free, no API key, no account.
 * Klines: 1000 per request, paginated backwards. Falls back to the
 * data-api.binance.vision mirror when api.binance.com fails (it is blocked in
 * some regions).
 */
import { MAX_BARS, type Candle, type SymbolSuggestion } from '../../shared/market.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import { InputError, NotFoundError, UpstreamError } from './errors.ts';
import { sortCandles } from './exchange.ts';
import { cropToSpan, noDataInSpan } from './range.ts';
import { matchSymbols } from './symbolMatch.ts';
import type { AdapterContext, HistoryRequest, ProviderAdapter } from './types.ts';
import { upstreamJson } from './upstream.ts';

const PROVIDER = 'Binance';
const HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const MAX_PER_REQUEST = 1000;
const POPULAR = catalogEntry('binance')!.popularSymbols;

export const BINANCE_INTERVALS: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
  '1M': '1M',
};

type ExchangeInfo = { symbols: Array<{ symbol: string; baseAsset: string; quoteAsset: string; status: string }> };

async function jsonWithFallback<T>(ctx: AdapterContext, path: string): Promise<T> {
  let lastErr: unknown;
  for (const host of HOSTS) {
    try {
      return await upstreamJson<T>(PROVIDER, `${host}${path}`, ctx);
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      lastErr = err;
      console.warn(`[upstream] ${PROVIDER} ${new URL(host).hostname} failed (${err instanceof Error ? err.message : String(err)})${host === HOSTS[HOSTS.length - 1] ? '' : ', trying the fallback host'}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new UpstreamError(PROVIDER, HOSTS[0], null, 'Binance is unreachable');
}

/**
 * Fetch klines ending at `to` (default "now"), paginating backwards: `limit`
 * of them, or in range mode (`from` set) every one in `from`..`to`.
 */
async function fetchKlines(
  ctx: AdapterContext,
  symbol: string,
  interval: string,
  span: { limit: number; from?: number; to?: number },
): Promise<Candle[]> {
  const { limit, from, to } = span;
  const range = from !== undefined;
  const out: Candle[] = [];
  // Binance's endTime is inclusive and a kline is keyed by its open time, so +999 ms keeps the candle opening at `to`.
  let endTime: number | undefined = to === undefined ? undefined : to * 1000 + 999;
  while (range ? out.length <= MAX_BARS : out.length < limit) {
    const batch = range ? MAX_PER_REQUEST : Math.min(MAX_PER_REQUEST, limit - out.length);
    const qs = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${batch}` + (endTime !== undefined ? `&endTime=${endTime}` : '');
    const raw = await jsonWithFallback<unknown[]>(ctx, `/api/v3/klines?${qs}`);
    if (!Array.isArray(raw) || raw.length === 0) break;
    for (const row of raw) {
      const r = row as unknown[];
      const candle: Candle = {
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      };
      if (Number.isFinite(candle.time) && Number.isFinite(candle.close)) out.push(candle);
    }
    if (raw.length < batch) break; // reached the beginning of history
    const oldestMs = Number((raw[0] as unknown[])[0]);
    if (range && oldestMs <= from * 1000) break;
    endTime = oldestMs - 1;
    ctx.signal?.throwIfAborted();
  }
  const sorted = sortCandles(out);
  return range ? cropToSpan(sorted, from, to) : sorted.slice(-limit);
}

const PRIORITY = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'BUSD', 'EUR', 'TRY'];

export function parseBinanceSymbols(info: ExchangeInfo): SymbolSuggestion[] {
  return info.symbols
    .filter((s) => s.status === 'TRADING')
    .map((s) => ({ symbol: s.symbol, label: `${s.baseAsset} / ${s.quoteAsset}`, exchange: 'Binance', type: 'crypto' }))
    .sort((a, b) => {
      const pa = PRIORITY.indexOf(a.label.split(' / ')[1]);
      const pb = PRIORITY.indexOf(b.label.split(' / ')[1]);
      if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return a.symbol.localeCompare(b.symbol);
    });
}

function listSymbols(ctx: AdapterContext): Promise<SymbolSuggestion[]> {
  return ctx.symbols.get('binance', async () => parseBinanceSymbols(await jsonWithFallback<ExchangeInfo>({ ...ctx, signal: undefined }, '/api/v3/exchangeInfo')));
}

export const binanceAdapter: ProviderAdapter = {
  id: 'binance',
  listSymbols,

  async search(ctx, query) {
    if (!query.trim()) return POPULAR;
    return matchSymbols(await listSymbols(ctx), query);
  },

  async history(ctx, req: HistoryRequest) {
    const interval = BINANCE_INTERVALS[req.timeframe];
    if (!interval) throw new InputError(`Binance does not support timeframe ${req.timeframe}`);
    const symbol = req.symbol.trim().toUpperCase();
    const candles = await fetchKlines(ctx, symbol, interval, { limit: Math.max(1, req.bars), from: req.from, to: req.to });
    if (candles.length === 0 && req.from !== undefined) throw noDataInSpan(PROVIDER, symbol, req.timeframe, req.from, req.to!);
    if (candles.length === 0) throw new NotFoundError(`No data returned for ${symbol}. Check the symbol (e.g. BTCUSDT).`);
    return candles;
  },
};
