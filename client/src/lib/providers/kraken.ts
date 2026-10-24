/**
 * Kraken public market data - free, no API key.
 * The OHLC endpoint only ever returns the latest 720 candles, so history depth
 * is limited. Live candles come from the websocket v2 `ohlc` channel.
 */
import type { Candle } from '../../types';
import { loadJson } from '../storage';
import { startLiveSocket, unsupportedLive, type ParsedKline } from '../liveSocket';
import { filterSymbols, loadCachedSymbols, sortSuggestions } from './exchange';
import { fetchJson, sortCandles, type DataProvider, type HistoryRequest, type LiveOptions, type SymbolSuggestion } from './http';

const HOST = 'https://api.kraken.com';
export const KRAKEN_MAX_CANDLES = 720;
const CACHE_KEY = 'kraken.symbols.v1';

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

/** Rows are [time(s), open, high, low, close, vwap, volume, count]. */
export function parseKrakenOhlc(res: KrakenResponse<Record<string, unknown>>): Candle[] {
  if (res.error && res.error.length > 0) throw new Error(res.error.join(', '));
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
  if (res.error && res.error.length > 0) throw new Error(res.error.join(', '));
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

/** Websocket v2 symbol (`BTC/USD`) for a REST pair name (`XBTUSD`). */
export function krakenWsSymbol(pair: string): string {
  const cached = loadJson<{ symbols: SymbolSuggestion[] } | null>(CACHE_KEY, null);
  const hit = cached?.symbols.find((s) => s.symbol === pair);
  if (hit?.label) return hit.label.replace(' / ', '/');
  const p = pair.replace(/^XBT/, 'BTC').replace(/XBT$/, 'BTC');
  const m = /^(.+?)(USDT|USDC|USD|EUR|GBP|CAD|AUD|JPY|CHF|BTC|ETH)$/.exec(p);
  return m ? `${m[1]}/${m[2]}` : p;
}

/** One frame of the v2 ohlc channel -> candles (`interval_begin` is ISO time). */
export function parseKrakenWs(raw: string): ParsedKline[] {
  const msg = JSON.parse(raw) as { channel?: string; data?: Array<Record<string, unknown>> };
  if (msg.channel !== 'ohlc' || !Array.isArray(msg.data)) return [];
  return msg.data.map((d) => ({
    candle: {
      time: Math.floor(Date.parse(String(d.interval_begin)) / 1000),
      open: Number(d.open),
      high: Number(d.high),
      low: Number(d.low),
      close: Number(d.close),
      volume: Number(d.volume),
    },
    closed: false, // the channel carries no close flag
  }));
}

const POPULAR_SYMBOLS: SymbolSuggestion[] = [
  { symbol: 'XBTUSD', label: 'BTC / USD', exchange: 'Kraken', type: 'crypto' },
  { symbol: 'ETHUSD', label: 'ETH / USD', exchange: 'Kraken', type: 'crypto' },
  { symbol: 'SOLUSD', label: 'SOL / USD', exchange: 'Kraken', type: 'crypto' },
  { symbol: 'XRPUSD', label: 'XRP / USD', exchange: 'Kraken', type: 'crypto' },
  { symbol: 'XDGUSD', label: 'DOGE / USD', exchange: 'Kraken', type: 'crypto' },
];

export const krakenProvider: DataProvider = {
  id: 'kraken',
  name: 'Kraken',
  description: 'Free public crypto spot data from Kraken. History is limited to the latest 720 candles per timeframe. No key needed.',
  supportsLive: true,
  needsProxy: true,
  timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
  defaultTimeframe: '1h',
  defaultSymbol: 'XBTUSD',
  popularSymbols: POPULAR_SYMBOLS,

  async searchSymbols(query, signal) {
    if (!query.trim()) return POPULAR_SYMBOLS;
    const all = await loadCachedSymbols(CACHE_KEY, async () =>
      parseKrakenPairs(await fetchJson(`${HOST}/0/public/AssetPairs`, { signal })),
    );
    return filterSymbols(all, query);
  },

  async fetchHistory(req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]> {
    const interval = KRAKEN_INTERVALS[req.timeframe];
    if (!interval) throw new Error(`Kraken does not support timeframe ${req.timeframe}`);
    const symbol = req.symbol.trim().toUpperCase();
    const res = await fetchJson<KrakenResponse<Record<string, unknown>>>(
      `${HOST}/0/public/OHLC?pair=${encodeURIComponent(symbol)}&interval=${interval}`,
      { signal },
    );
    const candles = sortCandles(parseKrakenOhlc(res)).slice(-Math.min(Math.max(1, req.bars), KRAKEN_MAX_CANDLES));
    if (candles.length === 0) throw new Error(`No data returned for ${symbol}. Check the symbol (e.g. XBTUSD).`);
    return candles;
  },

  startLive(opts: LiveOptions) {
    const interval = KRAKEN_INTERVALS[opts.timeframe];
    if (!interval) return unsupportedLive(opts, opts.timeframe);
    const symbol = krakenWsSymbol(opts.symbol.trim().toUpperCase());
    return startLiveSocket({
      url: 'wss://ws.kraken.com/v2',
      onOpen: (ws) => ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ohlc', symbol: [symbol], interval } })),
      parse: parseKrakenWs,
      onKline: opts.onKline,
      onStatus: opts.onStatus,
    });
  },
};
