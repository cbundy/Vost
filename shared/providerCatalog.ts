/**
 * One entry per remote data provider: everything the UI needs before it talks
 * to the server. The server serves it at `/api/providers` and the client bundles
 * it at build time, so the provider registry can stay synchronous. It holds no
 * host name: the REST adapters in `server/providers/` own those.
 */
import type { ProviderInfo, SymbolSuggestion } from './market.ts';

const crypto = (exchange: string, symbolOf: (base: string) => string, quote: string, bases: string[]): SymbolSuggestion[] =>
  bases.map((b) => ({ symbol: symbolOf(b), label: `${b} / ${quote}`, exchange, type: 'crypto' }));

const FIVE = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'];

export const PROVIDER_CATALOG: ProviderInfo[] = [
  {
    id: 'binance',
    name: 'Binance',
    description: 'Free public crypto market data — REST klines + live websocket. No key needed.',
    timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'],
    defaultTimeframe: '1h',
    defaultSymbol: 'BTCUSDT',
    popularSymbols: crypto('Binance', (b) => `${b}USDT`, 'USDT', ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']),
    supportsLive: true,
    hasSymbolList: true,
    hasSearch: true,
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    description: 'Free public crypto spot data from Coinbase Exchange (REST candles, 300 per request). No key needed. No live streaming.',
    timeframes: ['1m', '5m', '15m', '1h', '1d'],
    defaultTimeframe: '1h',
    defaultSymbol: 'BTC-USD',
    popularSymbols: crypto('Coinbase', (b) => `${b}-USD`, 'USD', FIVE),
    supportsLive: false,
    hasSymbolList: false,
    hasSearch: true,
  },
  {
    id: 'kraken',
    name: 'Kraken',
    description: 'Free public crypto spot data from Kraken. History is limited to the latest 720 candles per timeframe. No key needed.',
    timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
    defaultTimeframe: '1h',
    defaultSymbol: 'XBTUSD',
    popularSymbols: [
      { symbol: 'XBTUSD', label: 'BTC / USD', exchange: 'Kraken', type: 'crypto' },
      { symbol: 'ETHUSD', label: 'ETH / USD', exchange: 'Kraken', type: 'crypto' },
      { symbol: 'SOLUSD', label: 'SOL / USD', exchange: 'Kraken', type: 'crypto' },
      { symbol: 'XRPUSD', label: 'XRP / USD', exchange: 'Kraken', type: 'crypto' },
      { symbol: 'XDGUSD', label: 'DOGE / USD', exchange: 'Kraken', type: 'crypto' },
    ],
    supportsLive: true,
    hasSymbolList: false,
    hasSearch: true,
  },
  {
    id: 'bybit',
    name: 'Bybit',
    description: 'Free public crypto spot data from Bybit - REST klines (1000 per request) + live websocket. No key needed.',
    timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'],
    defaultTimeframe: '1h',
    defaultSymbol: 'BTCUSDT',
    popularSymbols: crypto('Bybit', (b) => `${b}USDT`, 'USDT', FIVE),
    supportsLive: true,
    hasSymbolList: false,
    hasSearch: true,
  },
  {
    id: 'okx',
    name: 'OKX',
    description: 'Free public crypto spot data from OKX - REST history candles (100 per request) + live websocket. No key needed.',
    timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'],
    defaultTimeframe: '1h',
    defaultSymbol: 'BTC-USDT',
    popularSymbols: crypto('OKX', (b) => `${b}-USDT`, 'USDT', FIVE),
    supportsLive: true,
    hasSymbolList: false,
    hasSearch: true,
  },
  {
    id: 'yahoo',
    name: 'Yahoo Finance',
    description: 'Free delayed data for stocks, ETFs, indices, forex and crypto. No key needed.',
    timeframes: ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'],
    defaultTimeframe: '1d',
    defaultSymbol: 'AAPL',
    popularSymbols: [
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
    ],
    supportsLive: false,
    hasSymbolList: false,
    hasSearch: true,
  },
  {
    id: 'stooq',
    name: 'Stooq',
    description: 'Free historical data (stocks / indices / FX / crypto) downloadable as CSV. No key needed.',
    timeframes: ['1d', '1w', '1M'],
    defaultTimeframe: '1d',
    defaultSymbol: 'aapl.us',
    popularSymbols: [
      { symbol: 'aapl.us', label: 'Apple (US)', exchange: 'US', type: 'stock' },
      { symbol: 'msft.us', label: 'Microsoft (US)', exchange: 'US', type: 'stock' },
      { symbol: 'tsla.us', label: 'Tesla (US)', exchange: 'US', type: 'stock' },
      { symbol: 'spy.us', label: 'SPDR S&P 500 ETF', exchange: 'US', type: 'etf' },
      { symbol: '^spx', label: 'S&P 500 Index', exchange: 'US', type: 'index' },
      { symbol: '^ndq', label: 'Nasdaq 100 Index', exchange: 'US', type: 'index' },
      { symbol: 'btcusd', label: 'Bitcoin / USD', exchange: 'CRYPT', type: 'crypto' },
      { symbol: 'ethusd', label: 'Ethereum / USD', exchange: 'CRYPT', type: 'crypto' },
      { symbol: 'eurusd', label: 'EUR / USD', exchange: 'FX', type: 'forex' },
      { symbol: 'usdjpy', label: 'USD / JPY', exchange: 'FX', type: 'forex' },
      { symbol: 'xauusd', label: 'Gold / USD', exchange: 'XAU', type: 'commodity' },
    ],
    supportsLive: false,
    hasSymbolList: true,
    hasSearch: true,
  },
];

export function catalogEntry(id: string): ProviderInfo | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
