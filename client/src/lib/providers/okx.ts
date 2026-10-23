/**
 * OKX v5 public spot market data - free, no API key.
 * Uses `history-candles` (100 per request, `after` cursor) for deep history.
 */
import type { Candle } from '../../types';
import { startLiveSocket, unsupportedLive, type ParsedKline } from '../liveSocket';
import { filterSymbols, loadCachedSymbols, paginateBackwards, sortSuggestions } from './exchange';
import { fetchJson, type DataProvider, type HistoryRequest, type LiveOptions, type SymbolSuggestion } from './http';

const HOST = 'https://www.okx.com';
const MAX_PER_REQUEST = 100;
const CACHE_KEY = 'okx.symbols.v1';

/** Timeframe -> OKX bar, which is also the suffix of the `candle<bar>` ws channel. */
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

const rowToCandle = (r: string[]): Candle => ({
  time: Math.floor(Number(r[0]) / 1000),
  open: Number(r[1]),
  high: Number(r[2]),
  low: Number(r[3]),
  close: Number(r[4]),
  volume: Number(r[5]),
});

/** Rows are [tsMs, open, high, low, close, vol, volCcy, volCcyQuote, confirm], newest first. */
export function parseOkxCandles(res: OkxResponse<string[][]>): Candle[] {
  if (res.code !== '0') throw new Error(res.msg || `OKX error ${res.code}`);
  return (res.data ?? []).map(rowToCandle);
}

type Instrument = { instId: string; baseCcy: string; quoteCcy: string; state: string };

export function parseOkxInstruments(res: OkxResponse<Instrument[]>): SymbolSuggestion[] {
  if (res.code !== '0') throw new Error(res.msg || `OKX error ${res.code}`);
  return sortSuggestions(
    (res.data ?? [])
      .filter((i) => i.state === 'live')
      .map((i) => ({ symbol: i.instId, label: `${i.baseCcy} / ${i.quoteCcy}`, exchange: 'OKX', type: 'crypto' })),
  );
}

/** Frame from the `candle<bar>` channel; the last field of a row is `confirm` ('1' = closed). */
export function parseOkxWs(raw: string): ParsedKline[] {
  if (raw === 'pong') return [];
  const msg = JSON.parse(raw) as { arg?: { channel?: string }; data?: string[][] };
  if (!msg.arg?.channel?.startsWith('candle') || !Array.isArray(msg.data)) return [];
  return msg.data.map((r) => ({ candle: rowToCandle(r), closed: r[8] === '1' }));
}

const POPULAR_SYMBOLS: SymbolSuggestion[] = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'].map((b) => ({
  symbol: `${b}-USDT`,
  label: `${b} / USDT`,
  exchange: 'OKX',
  type: 'crypto',
}));

export const okxProvider: DataProvider = {
  id: 'okx',
  name: 'OKX',
  description: 'Free public crypto spot data from OKX - REST history candles (100 per request) + live websocket. No key needed.',
  supportsLive: true,
  needsProxy: true,
  timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'],
  defaultTimeframe: '1h',
  defaultSymbol: 'BTC-USDT',
  popularSymbols: POPULAR_SYMBOLS,

  async searchSymbols(query, signal) {
    if (!query.trim()) return POPULAR_SYMBOLS;
    const all = await loadCachedSymbols(CACHE_KEY, async () =>
      parseOkxInstruments(await fetchJson(`${HOST}/api/v5/public/instruments?instType=SPOT`, { signal })),
    );
    return filterSymbols(all, query);
  },

  async fetchHistory(req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]> {
    const bar = OKX_BARS[req.timeframe];
    if (!bar) throw new Error(`OKX does not support timeframe ${req.timeframe}`);
    const symbol = req.symbol.trim().toUpperCase();
    const candles = await paginateBackwards(
      Math.max(1, req.bars),
      async (before) => {
        const after = before === undefined ? '' : `&after=${before * 1000}`;
        return parseOkxCandles(
          await fetchJson(`${HOST}/api/v5/market/history-candles?instId=${encodeURIComponent(symbol)}&bar=${bar}&limit=${MAX_PER_REQUEST}${after}`, { signal }),
        );
      },
      signal,
    );
    if (candles.length === 0) throw new Error(`No data returned for ${symbol}. Check the symbol (e.g. BTC-USDT).`);
    return candles;
  },

  startLive(opts: LiveOptions) {
    const bar = OKX_BARS[opts.timeframe];
    if (!bar) return unsupportedLive(opts, opts.timeframe);
    const sub = { op: 'subscribe', args: [{ channel: `candle${bar}`, instId: opts.symbol.trim().toUpperCase() }] };
    return startLiveSocket({
      url: 'wss://ws.okx.com:8443/ws/v5/business',
      onOpen: (ws) => ws.send(JSON.stringify(sub)),
      parse: parseOkxWs,
      pingMs: 20000,
      ping: () => 'ping',
      onKline: opts.onKline,
      onStatus: opts.onStatus,
    });
  },
};
