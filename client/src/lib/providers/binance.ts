/**
 * Binance public market data — free, no API key, no account.
 * REST endpoint used for history, websocket for live candles.
 */
import type { Candle, Timeframe } from '../../types';
import { fetchJson, sortCandles, type DataProvider, type HistoryRequest, type SymbolSuggestion } from './http';
import { startBinanceLive } from '../live';
import { matchSymbols } from './symbolMatch';
import { loadJson, saveJson } from '../storage';

const HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const MAX_PER_REQUEST = 1000;

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

interface KlineResponse extends Array<unknown> {}

type ExchangeInfo = { symbols: Array<{ symbol: string; baseAsset: string; quoteAsset: string; status: string }> };

interface SymbolCache {
  at: number;
  symbols: SymbolSuggestion[];
}

const CACHE_KEY = 'binance.symbols.v1';

async function fetchJsonWithFallback<T>(path: string, signal?: AbortSignal): Promise<T> {
  let lastErr: unknown;
  for (const host of HOSTS) {
    try {
      return await fetchJson<T>(`${host}${path}`, { signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Binance is unreachable');
}

/** Fetch up to `limit` klines ending "now", paginating backwards. */
async function fetchKlines(symbol: string, interval: string, limit: number, signal?: AbortSignal): Promise<Candle[]> {
  const out: Candle[] = [];
  let endTime: number | undefined;
  while (out.length < limit) {
    const batch = Math.min(MAX_PER_REQUEST, limit - out.length);
    const qs = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${batch}` + (endTime ? `&endTime=${endTime}` : '');
    const raw = await fetchJsonWithFallback<KlineResponse>(`/api/v3/klines?${qs}`, signal);
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
    endTime = Number((raw[0] as unknown[])[0]) - 1;
    signal?.throwIfAborted();
  }
  return sortCandles(out).slice(-limit);
}

async function loadSymbols(signal?: AbortSignal): Promise<SymbolSuggestion[]> {
  const cached = loadJson<SymbolCache | null>(CACHE_KEY, null);
  if (cached && Date.now() - cached.at < 24 * 3600 * 1000 && cached.symbols.length > 0) return cached.symbols;
  const info = await fetchJsonWithFallback<ExchangeInfo>('/api/v3/exchangeInfo', signal);
  const priority = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'BUSD', 'EUR', 'TRY'];
  const symbols = info.symbols
    .filter((s) => s.status === 'TRADING')
    .map((s) => ({
      symbol: s.symbol,
      label: `${s.baseAsset} / ${s.quoteAsset}`,
      exchange: 'Binance',
      type: 'crypto',
    }))
    .sort((a, b) => {
      const pa = priority.indexOf(a.label.split(' / ')[1]);
      const pb = priority.indexOf(b.label.split(' / ')[1]);
      if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      return a.symbol.localeCompare(b.symbol);
    });
  saveJson(CACHE_KEY, { at: Date.now(), symbols } satisfies SymbolCache);
  return symbols;
}

const POPULAR_SYMBOLS: SymbolSuggestion[] = [
  { symbol: 'BTCUSDT', label: 'BTC / USDT', exchange: 'Binance', type: 'crypto' },
  { symbol: 'ETHUSDT', label: 'ETH / USDT', exchange: 'Binance', type: 'crypto' },
  { symbol: 'SOLUSDT', label: 'SOL / USDT', exchange: 'Binance', type: 'crypto' },
  { symbol: 'BNBUSDT', label: 'BNB / USDT', exchange: 'Binance', type: 'crypto' },
  { symbol: 'XRPUSDT', label: 'XRP / USDT', exchange: 'Binance', type: 'crypto' },
];

export const binanceProvider: DataProvider = {
  id: 'binance',
  name: 'Binance',
  description: 'Free public crypto market data — REST klines + live websocket. No key needed.',
  supportsLive: true,
  startLive: (opts) => startBinanceLive(opts),
  needsProxy: true,
  timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'],
  defaultTimeframe: '1h',
  defaultSymbol: 'BTCUSDT',
  popularSymbols: POPULAR_SYMBOLS,

  listSymbols: loadSymbols,

  async searchSymbols(query: string, signal?: AbortSignal): Promise<SymbolSuggestion[]> {
    if (!query.trim()) return POPULAR_SYMBOLS;
    return matchSymbols(await loadSymbols(signal), query);
  },

  async fetchHistory(req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]> {
    const interval = BINANCE_INTERVALS[req.timeframe];
    if (!interval) throw new Error(`Binance does not support timeframe ${req.timeframe}`);
    const symbol = req.symbol.trim().toUpperCase();
    const candles = await fetchKlines(symbol, interval, Math.max(1, req.bars), signal);
    if (candles.length === 0) throw new Error(`No data returned for ${symbol}. Check the symbol (e.g. BTCUSDT).`);
    return candles;
  },
};

/** WebSocket URL used by lib/live.ts (public data streams). */
export function binanceStreamUrl(symbol: string, interval: string): string {
  const s = symbol.toLowerCase();
  return `wss://stream.binance.com:9443/ws/${s}@kline_${interval}`;
}

export function binanceStreamFallbackUrl(symbol: string, interval: string): string {
  const s = symbol.toLowerCase();
  return `wss://data-stream.binance.vision/ws/${s}@kline_${interval}`;
}

export type { Timeframe };
