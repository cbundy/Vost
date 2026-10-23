/**
 * Bybit v5 public spot market data - free, no API key.
 * Klines: 1000 per request, paginated backwards with `end`.
 */
import type { Candle } from '../../types';
import { startLiveSocket, unsupportedLive, type ParsedKline } from '../liveSocket';
import { filterSymbols, loadCachedSymbols, paginateBackwards, sortSuggestions } from './exchange';
import { fetchJson, type DataProvider, type HistoryRequest, type LiveOptions, type SymbolSuggestion } from './http';

const HOST = 'https://api.bybit.com';
const MAX_PER_REQUEST = 1000;
const CACHE_KEY = 'bybit.symbols.v1';

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

/** Rows are [startMs, open, high, low, close, volume, turnover], newest first. */
export function parseBybitKlines(res: BybitResponse<{ list?: string[][] }>): Candle[] {
  if (res.retCode !== 0) throw new Error(res.retMsg || `Bybit error ${res.retCode}`);
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
  if (res.retCode !== 0) throw new Error(res.retMsg || `Bybit error ${res.retCode}`);
  return sortSuggestions(
    (res.result?.list ?? [])
      .filter((i) => i.status === 'Trading')
      .map((i) => ({ symbol: i.symbol, label: `${i.baseCoin} / ${i.quoteCoin}`, exchange: 'Bybit', type: 'crypto' })),
  );
}

/** Frame on topic `kline.<interval>.<symbol>`; `start` is in ms, `confirm` marks a closed candle. */
export function parseBybitWs(raw: string): ParsedKline[] {
  const msg = JSON.parse(raw) as { topic?: string; data?: Array<Record<string, unknown>> };
  if (!msg.topic?.startsWith('kline.') || !Array.isArray(msg.data)) return [];
  return msg.data.map((d) => ({
    candle: {
      time: Math.floor(Number(d.start) / 1000),
      open: Number(d.open),
      high: Number(d.high),
      low: Number(d.low),
      close: Number(d.close),
      volume: Number(d.volume),
    },
    closed: d.confirm === true,
  }));
}

const POPULAR_SYMBOLS: SymbolSuggestion[] = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'].map((b) => ({
  symbol: `${b}USDT`,
  label: `${b} / USDT`,
  exchange: 'Bybit',
  type: 'crypto',
}));

export const bybitProvider: DataProvider = {
  id: 'bybit',
  name: 'Bybit',
  description: 'Free public crypto spot data from Bybit - REST klines (1000 per request) + live websocket. No key needed.',
  supportsLive: true,
  needsProxy: true,
  timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'],
  defaultTimeframe: '1h',
  defaultSymbol: 'BTCUSDT',
  popularSymbols: POPULAR_SYMBOLS,

  async searchSymbols(query, signal) {
    if (!query.trim()) return POPULAR_SYMBOLS;
    const all = await loadCachedSymbols(CACHE_KEY, async () =>
      parseBybitInstruments(await fetchJson(`${HOST}/v5/market/instruments-info?category=spot`, { signal })),
    );
    return filterSymbols(all, query);
  },

  async fetchHistory(req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]> {
    const interval = BYBIT_INTERVALS[req.timeframe];
    if (!interval) throw new Error(`Bybit does not support timeframe ${req.timeframe}`);
    const symbol = req.symbol.trim().toUpperCase();
    const bars = Math.max(1, req.bars);
    const candles = await paginateBackwards(
      bars,
      async (before) => {
        const limit = Math.min(MAX_PER_REQUEST, bars);
        const end = before === undefined ? '' : `&end=${before * 1000 - 1}`;
        return parseBybitKlines(
          await fetchJson(`${HOST}/v5/market/kline?category=spot&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}${end}`, { signal }),
        );
      },
      signal,
    );
    if (candles.length === 0) throw new Error(`No data returned for ${symbol}. Check the symbol (e.g. BTCUSDT).`);
    return candles;
  },

  startLive(opts: LiveOptions) {
    const interval = BYBIT_INTERVALS[opts.timeframe];
    if (!interval) return unsupportedLive(opts, opts.timeframe);
    const topic = `kline.${interval}.${opts.symbol.trim().toUpperCase()}`;
    return startLiveSocket({
      url: 'wss://stream.bybit.com/v5/public/spot',
      onOpen: (ws) => ws.send(JSON.stringify({ op: 'subscribe', args: [topic] })),
      parse: parseBybitWs,
      pingMs: 20000,
      ping: () => JSON.stringify({ op: 'ping' }),
      onKline: opts.onKline,
      onStatus: opts.onStatus,
    });
  },
};
