/**
 * REST payloads in each provider's real format. A handler gets the request
 * URL (the original path and query, host already stripped) and returns the body.
 */
import { bars, TIMEFRAME_SECONDS, type Bar } from './data.ts';
import { indicatorFacade, indicatorSearch, scriptPage } from './pine-indicators.ts';
import { tradingViewFacade, tradingViewSearch } from './pine-libraries.ts';

export interface RestReply {
  status?: number;
  type?: string;
  body: unknown;
}

type Handler = (url: URL, nowSec: number, headers?: Record<string, string | string[] | undefined>) => RestReply;

const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
const json = (body: unknown): RestReply => ({ body });
const notFound = (url: URL): RestReply => ({ status: 404, body: { error: `the fake upstream has nothing at ${url.pathname}` } });
const num = (v: string | null): number | undefined => (v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

/* --------------------------------- Binance -------------------------------- */

const BINANCE_STEPS: Record<string, number> = TIMEFRAME_SECONDS;

const binance: Handler = (url, nowSec) => {
  if (url.pathname === '/api/v3/exchangeInfo') {
    const symbols = [...COINS.map((c) => [c, 'USDT']), ['ETH', 'BTC']].map(([base, quote]) => ({ symbol: `${base}${quote}`, baseAsset: base, quoteAsset: quote, status: 'TRADING' }));
    return json({ symbols });
  }
  if (url.pathname === '/api/v3/klines') {
    const step = BINANCE_STEPS[url.searchParams.get('interval') ?? ''];
    if (!step) return { status: 400, body: { code: -1120, msg: 'Invalid interval.' } };
    const endMs = num(url.searchParams.get('endTime'));
    const rows = bars(url.searchParams.get('symbol') ?? '', {
      step,
      to: endMs === undefined ? undefined : Math.floor(endMs / 1000),
      limit: num(url.searchParams.get('limit')) ?? 500,
      nowSec,
    });
    return json(rows.map((b) => [b.time * 1000, String(b.open), String(b.high), String(b.low), String(b.close), String(b.volume), b.time * 1000 + step * 1000 - 1, '0', 0, '0', '0', '0']));
  }
  return notFound(url);
};

/* ------------------------ CoinGecko and CoinMarketCap ----------------------- */

/** Coins in cap order; the volume order is the reverse. USDT and NOPE show the exclusion and skip rules. */
const RANKED: Array<[string, string]> = [['BTC', 'Bitcoin'], ['ETH', 'Ethereum'], ['USDT', 'Tether'], ['XRP', 'XRP'], ['BNB', 'BNB'], ['SOL', 'Solana'], ['NOPE', 'No Binance Pair Coin'], ['DOGE', 'Dogecoin']];
const rankedFor = (volume: boolean) => {
  const rows = RANKED.map(([symbol, name], i) => ({ symbol, name, cap: 1_000_000_000_000 / (i + 1), vol: 50_000_000_000 / (i + 1) }));
  return volume ? [...rows].reverse() : rows;
};

const coingecko: Handler = (url) => {
  if (url.pathname !== '/api/v3/coins/markets') return notFound(url);
  const volume = url.searchParams.get('order') === 'volume_desc';
  return json(rankedFor(volume).map((c) => ({ id: c.name.toLowerCase(), symbol: c.symbol.toLowerCase(), name: c.name, market_cap: c.cap, total_volume: c.vol })));
};

/** Like the real site: 401 without the key header, the listing with any key. */
const coinmarketcap: Handler = (url, _nowSec, headers) => {
  if (!headers?.['x-cmc_pro_api_key']) return { status: 401, body: { status: { error_code: 1002, error_message: 'API key missing.' } } };
  if (url.pathname !== '/v1/cryptocurrency/listings/latest') return notFound(url);
  const volume = url.searchParams.get('sort') === 'volume_24h';
  return json({ data: rankedFor(volume).map((c) => ({ symbol: c.symbol, name: c.name, quote: { USD: { market_cap: c.cap, volume_24h: c.vol } } })) });
};

/* --------------------------------- Coinbase -------------------------------- */

const coinbase: Handler = (url, nowSec) => {
  if (url.pathname === '/products') {
    return json(COINS.map((c) => ({ id: `${c}-USD`, base_currency: c, quote_currency: 'USD', status: 'online', trading_disabled: false })));
  }
  const m = /^\/products\/([^/]+)\/candles$/.exec(url.pathname);
  if (m) {
    const step = num(url.searchParams.get('granularity'));
    if (!step) return { status: 400, body: { message: 'Unsupported granularity' } };
    const start = Date.parse(url.searchParams.get('start') ?? '');
    const end = Date.parse(url.searchParams.get('end') ?? '');
    const rows = bars(decodeURIComponent(m[1]), {
      step,
      from: Number.isFinite(start) ? start / 1000 : undefined,
      to: Number.isFinite(end) ? end / 1000 : undefined,
      limit: 300,
      nowSec,
    });
    // [time, low, high, open, close, volume], newest first
    return json(rows.reverse().map((b) => [b.time, b.low, b.high, b.open, b.close, b.volume]));
  }
  return notFound(url);
};

/* --------------------------------- Kraken --------------------------------- */

const KRAKEN_PAIRS: Array<[string, string, string]> = [
  ['XXBTZUSD', 'XBTUSD', 'XBT/USD'],
  ['XETHZUSD', 'ETHUSD', 'ETH/USD'],
  ['SOLUSD', 'SOLUSD', 'SOL/USD'],
  ['XXRPZUSD', 'XRPUSD', 'XRP/USD'],
  ['XDGUSD', 'XDGUSD', 'XDG/USD'],
];

const kraken: Handler = (url, nowSec) => {
  if (url.pathname === '/0/public/AssetPairs') {
    return json({ error: [], result: Object.fromEntries(KRAKEN_PAIRS.map(([key, altname, wsname]) => [key, { altname, wsname, status: 'online' }])) });
  }
  if (url.pathname === '/0/public/OHLC') {
    const pair = url.searchParams.get('pair') ?? '';
    const step = (num(url.searchParams.get('interval')) ?? 1) * 60;
    const rows = bars(pair, { step, limit: 720, nowSec });
    // [time, open, high, low, close, vwap, volume, count]
    return json({ error: [], result: { [pair]: rows.map((b) => [b.time, String(b.open), String(b.high), String(b.low), String(b.close), String(b.close), String(b.volume), 10]), last: rows.at(-1)?.time ?? 0 } });
  }
  return notFound(url);
};

/* ---------------------------------- Bybit --------------------------------- */

const BYBIT_STEPS: Record<string, number> = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, '240': 14400, D: 86400, W: 604800, M: 2592000 };
export const bybitStep = (interval: string): number | undefined => BYBIT_STEPS[interval];

const bybit: Handler = (url, nowSec) => {
  if (url.pathname === '/v5/market/instruments-info') {
    return json({ retCode: 0, retMsg: 'OK', result: { category: 'spot', list: COINS.map((c) => ({ symbol: `${c}USDT`, baseCoin: c, quoteCoin: 'USDT', status: 'Trading' })) } });
  }
  if (url.pathname === '/v5/market/kline') {
    const step = BYBIT_STEPS[url.searchParams.get('interval') ?? ''];
    if (!step) return json({ retCode: 10001, retMsg: 'Invalid interval', result: {} });
    const endMs = num(url.searchParams.get('end'));
    const rows = bars(url.searchParams.get('symbol') ?? '', { step, to: endMs === undefined ? undefined : Math.floor(endMs / 1000), limit: num(url.searchParams.get('limit')) ?? 200, nowSec });
    // [startMs, open, high, low, close, volume, turnover], newest first
    return json({ retCode: 0, retMsg: 'OK', result: { category: 'spot', symbol: url.searchParams.get('symbol'), list: rows.reverse().map((b) => [String(b.time * 1000), String(b.open), String(b.high), String(b.low), String(b.close), String(b.volume), String(b.volume * b.close)]) } });
  }
  return notFound(url);
};

/* ----------------------------------- OKX ---------------------------------- */

const OKX_STEPS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1H': 3600, '4H': 14400, '1D': 86400, '1W': 604800, '1M': 2592000 };
export const okxStep = (bar: string): number | undefined => OKX_STEPS[bar];

export const okxRow = (b: Bar, confirm: '0' | '1'): string[] => [String(b.time * 1000), String(b.open), String(b.high), String(b.low), String(b.close), String(b.volume), String(b.volume), String(b.volume * b.close), confirm];

const okx: Handler = (url, nowSec) => {
  if (url.pathname === '/api/v5/public/instruments') {
    return json({ code: '0', msg: '', data: COINS.map((c) => ({ instId: `${c}-USDT`, baseCcy: c, quoteCcy: 'USDT', state: 'live' })) });
  }
  if (url.pathname === '/api/v5/market/history-candles') {
    const step = OKX_STEPS[url.searchParams.get('bar') ?? ''];
    if (!step) return json({ code: '51000', msg: 'Parameter bar error', data: [] });
    const afterMs = num(url.searchParams.get('after')); // exclusive
    const rows = bars(url.searchParams.get('instId') ?? '', {
      step,
      to: afterMs === undefined ? undefined : Math.ceil(afterMs / 1000) - 1,
      limit: num(url.searchParams.get('limit')) ?? 100,
      nowSec,
    });
    return json({ code: '0', msg: '', data: rows.reverse().map((b) => okxRow(b, '1')) });
  }
  return notFound(url);
};

/* ---------------------------------- Yahoo --------------------------------- */

const YAHOO_STEPS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '60m': 3600, '1d': 86400, '1wk': 604800, '1mo': 2592000 };
const YAHOO_QUOTES = [
  { symbol: 'AAPL', shortname: 'Apple Inc.', exchDisp: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'MSFT', shortname: 'Microsoft Corp.', exchDisp: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'NVDA', shortname: 'NVIDIA Corp.', exchDisp: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'TSLA', shortname: 'Tesla Inc.', exchDisp: 'NASDAQ', quoteType: 'EQUITY' },
  { symbol: 'SPY', shortname: 'SPDR S&P 500 ETF', exchDisp: 'NYSE', quoteType: 'ETF' },
];

/** Symbols Yahoo has no chart for (it answers 404 "No data found"), so a market search shows a skipped market. */
const NO_DATA_SYMBOLS = new Set(['^STOXX50E']);

const yahoo: Handler = (url, nowSec) => {
  if (url.pathname === '/v1/finance/search') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    return json({ quotes: YAHOO_QUOTES.filter((x) => x.symbol.toLowerCase().includes(q) || x.shortname.toLowerCase().includes(q)) });
  }
  const m = /^\/v8\/finance\/chart\/([^/]+)$/.exec(url.pathname);
  if (m && NO_DATA_SYMBOLS.has(decodeURIComponent(m[1]))) {
    return { status: 404, body: { chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } } };
  }
  if (m) {
    const step = YAHOO_STEPS[url.searchParams.get('interval') ?? ''];
    if (!step) return json({ chart: { result: null, error: { code: 'Bad Request', description: 'Invalid interval' } } });
    const p1 = num(url.searchParams.get('period1'));
    const p2 = num(url.searchParams.get('period2'));
    const rows = bars(decodeURIComponent(m[1]), { step, from: p1, to: p2 === undefined ? undefined : p2 - 1, nowSec });
    return json({
      chart: {
        result: [
          {
            timestamp: rows.map((b) => b.time),
            indicators: { quote: [{ open: rows.map((b) => b.open), high: rows.map((b) => b.high), low: rows.map((b) => b.low), close: rows.map((b) => b.close), volume: rows.map((b) => b.volume) }] },
          },
        ],
        error: null,
      },
    });
  }
  return notFound(url);
};

/** Handlers by the original host name (no port). */
export const REST_HOSTS: Record<string, Handler> = {
  'api.binance.com': binance,
  'data-api.binance.vision': binance,
  'api.exchange.coinbase.com': coinbase,
  'api.kraken.com': kraken,
  'api.bybit.com': bybit,
  'www.okx.com': okx,
  'query1.finance.yahoo.com': yahoo,
  'api.coingecko.com': coingecko,
  'pro-api.coinmarketcap.com': coinmarketcap,
  // Search answers libraries for type=3 and indicators otherwise; /script/<id>/ is the script page.
  'www.tradingview.com': (url) => (url.pathname.startsWith('/script/') ? scriptPage(url) : url.searchParams.get('type') === '3' || url.pathname !== '/pubscripts-suggest-json/' ? tradingViewSearch(url) : indicatorSearch(url)),
  // A library is fetched by version number, an indicator as `last`.
  'pine-facade.tradingview.com': (url) => (url.pathname.endsWith('/last') ? indicatorFacade(url) : tradingViewFacade(url)),
};
