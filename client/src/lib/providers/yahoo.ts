/**
 * Yahoo Finance public chart API — free, no key. Covers stocks, ETFs, indices,
 * forex and crypto. Requires the self-hosted proxy (Yahoo sends no CORS
 * headers), so this provider is marked `needsProxy`.
 */
import type { Candle, Timeframe } from '../../types';
import { fetchJson, HttpError, type DataProvider, type HistoryRequest, type SymbolSuggestion } from './http';

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

interface YahooSearchResponse {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchDisp?: string;
    quoteType?: string;
  }>;
}

/** Yahoo interval codes. Yahoo has no 4h interval. */
const YAHOO_INTERVALS: Partial<Record<Timeframe, string>> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '60m',
  '1d': '1d',
  '1w': '1wk',
  '1M': '1mo',
};

const BAR_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '1d': 86400,
  '1w': 7 * 86400,
  '1M': 30 * 86400,
};

/** Allowed `range` values per interval, in increasing order, with their span in seconds. */
const RANGE_STEPS: Array<{ range: string; seconds: number }> = [
  { range: '1d', seconds: 86400 },
  { range: '5d', seconds: 5 * 86400 },
  { range: '1mo', seconds: 31 * 86400 },
  { range: '3mo', seconds: 93 * 86400 },
  { range: '6mo', seconds: 186 * 86400 },
  { range: '1y', seconds: 366 * 86400 },
  { range: '2y', seconds: 732 * 86400 },
  { range: '5y', seconds: 1830 * 86400 },
  { range: '10y', seconds: 3660 * 86400 },
  { range: 'max', seconds: Number.MAX_SAFE_INTEGER },
];

const INTRADAY_MAX_RANGE: Record<string, string> = {
  '1m': '7d', // ~8 days is Yahoo's 1m limit
  '5m': '1mo',
  '15m': '1mo',
  '30m': '1mo',
  '1h': '2y',
};

function pickRange(interval: string, bars: number): string {
  const needed = bars * (BAR_SECONDS[interval] ?? 86400);
  let range = 'max';
  for (const step of RANGE_STEPS) {
    if (needed <= step.seconds) {
      range = step.range;
      break;
    }
  }
  const cap = INTRADAY_MAX_RANGE[interval];
  if (cap) {
    const capIdx = RANGE_STEPS.findIndex((s) => s.range === cap);
    const idx = Math.min(RANGE_STEPS.findIndex((s) => s.range === range), capIdx);
    return RANGE_STEPS[Math.max(0, idx)].range;
  }
  return range;
}

const POPULAR_SYMBOLS: SymbolSuggestion[] = [
  { symbol: 'AAPL', label: 'Apple Inc.', exchange: 'NASDAQ', type: 'stock' },
  { symbol: 'MSFT', label: 'Microsoft Corp.', exchange: 'NASDAQ', type: 'stock' },
  { symbol: 'NVDA', label: 'NVIDIA Corp.', exchange: 'NASDAQ', type: 'stock' },
  { symbol: 'TSLA', label: 'Tesla Inc.', exchange: 'NASDAQ', type: 'stock' },
  { symbol: 'SPY', label: 'SPDR S&P 500 ETF', exchange: 'NYSE', type: 'etf' },
  { symbol: 'QQQ', label: 'Invesco QQQ Trust', exchange: 'NASDAQ', type: 'etf' },
  { symbol: '^GSPC', label: 'S&P 500 Index', exchange: 'INDEX', type: 'index' },
  { symbol: '^IXIC', label: 'Nasdaq Composite', exchange: 'INDEX', type: 'index' },
  { symbol: 'BTC-USD', label: 'Bitcoin / USD', exchange: 'CCC', type: 'crypto' },
  { symbol: 'ETH-USD', label: 'Ethereum / USD', exchange: 'CCC', type: 'crypto' },
  { symbol: 'EURUSD=X', label: 'EUR / USD', exchange: 'FX', type: 'forex' },
  { symbol: 'GC=F', label: 'Gold Futures', exchange: 'COMEX', type: 'future' },
];

const TYPE_LABELS: Record<string, string> = {
  EQUITY: 'stock',
  ETF: 'etf',
  INDEX: 'index',
  CURRENCY: 'forex',
  FUTURE: 'future',
  CRYPTOCURRENCY: 'crypto',
  MUTUALFUND: 'fund',
};

function typeLabel(quoteType: string | undefined): string | undefined {
  if (!quoteType) return undefined;
  return TYPE_LABELS[quoteType.toUpperCase()] ?? quoteType.toLowerCase();
}

export const yahooProvider: DataProvider = {
  id: 'yahoo',
  name: 'Yahoo Finance',
  description: 'Free delayed data for stocks, ETFs, indices, forex and crypto. No key needed.',
  needsProxy: true,
  timeframes: ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'],
  defaultTimeframe: '1d',
  defaultSymbol: 'AAPL',
  popularSymbols: POPULAR_SYMBOLS,

  async searchSymbols(query: string, signal?: AbortSignal): Promise<SymbolSuggestion[]> {
    const q = query.trim();
    if (!q) return POPULAR_SYMBOLS;
    try {
      const data = await fetchJson<YahooSearchResponse>(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=50&newsCount=0&listsCount=0`,
        { signal },
      );
      const out: SymbolSuggestion[] = (data.quotes ?? [])
        .filter((x) => x.symbol)
        .map((x) => ({
          symbol: x.symbol as string,
          label: x.shortname ?? x.longname ?? undefined,
          exchange: x.exchDisp ?? undefined,
          type: typeLabel(x.quoteType),
        }));
      return out.length > 0 ? out : POPULAR_SYMBOLS;
    } catch {
      return POPULAR_SYMBOLS;
    }
  },

  async fetchHistory(req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]> {
    const interval = YAHOO_INTERVALS[req.timeframe];
    if (!interval) throw new Error(`Yahoo Finance does not support timeframe ${req.timeframe}`);
    const range = pickRange(interval, req.bars);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      req.symbol.trim(),
    )}?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit`;

    const data = await fetchJson<YahooChartResponse>(url, { signal }).catch((err: unknown) => {
      if (err instanceof HttpError && err.status === 429) {
        throw new Error(
          'Yahoo Finance is rate-limiting this server (HTTP 429). Wait a minute and retry, or use Binance / CSV import.',
        );
      }
      throw err;
    });
    const err = data.chart?.error;
    if (err) throw new Error(err.description ?? err.code ?? 'Yahoo Finance error');
    const result = data.chart?.result?.[0];
    if (!result?.timestamp || !result.indicators?.quote?.[0]) {
      throw new Error(`No data for "${req.symbol}". Try symbols like AAPL, ^GSPC, BTC-USD, EURUSD=X.`);
    }
    const quote = result.indicators.quote[0];
    const candles: Candle[] = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = quote.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      candles.push({
        time: Math.floor(result.timestamp[i]),
        open: o,
        high: h,
        low: l,
        close: c,
        volume: quote.volume?.[i] ?? 0,
      });
    }
    if (candles.length === 0) throw new Error(`No usable bars for "${req.symbol}" at ${req.timeframe}.`);
    return candles.slice(-req.bars);
  },
};
