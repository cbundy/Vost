/**
 * The lists the market search offers (`GET /api/market-lists`), and the fixed
 * stock and index lists. The crypto lists are built live by the server
 * (server/marketLists/); the stock and index tables below were copied from
 * docs/spikes/strategy-search/universe.json (dated 2026-11-05) and change only
 * by editing this file.
 */

export type MarketListId = 'crypto-cap' | 'crypto-volume' | 'stocks-cap' | 'stocks-volume' | 'indices';

export interface MarketListEntry {
  provider: 'binance' | 'yahoo';
  symbol: string;
  name: string;
  /** The upstream rank (1 is the largest). */
  rank: number;
  /** Market cap (USD) or 24h volume, as the upstream gave it. */
  metric?: number;
}

export interface MarketListSkip {
  symbol: string;
  reason: string;
}

export interface MarketList {
  id: MarketListId;
  title: string;
  /** Plain text naming the site and endpoint that answered. */
  source: string;
  /** YYYY-MM-DD of the data. */
  date: string;
  /** True for the lists the server builds live (the crypto lists). */
  live: boolean;
  /** The list is the last good copy: the latest refresh failed. */
  stale?: true;
  /** Why the list has no entries (no good copy and the refresh failed). */
  error?: string;
  /** At most MARKET_LIST_SIZE entries. */
  entries: MarketListEntry[];
  /** Coins left out as stablecoins, wrapped, staked or leveraged tokens. */
  excluded: MarketListSkip[];
  /** Coins that rank but have no tradable pair. */
  skipped: MarketListSkip[];
}

export const MARKET_LIST_SIZE = 30;
export const MARKET_LIST_IDS: readonly MarketListId[] = ['crypto-cap', 'crypto-volume', 'stocks-cap', 'stocks-volume', 'indices'];

const STOCKS_CAP: MarketListEntry[] = [
  { provider: 'yahoo', symbol: "AAPL", name: "Apple", rank: 1, metric: 5044701757440 },
  { provider: 'yahoo', symbol: "NVDA", name: "NVIDIA", rank: 2, metric: 4532874510336 },
  { provider: 'yahoo', symbol: "MSFT", name: "Microsoft", rank: 3, metric: 4038030262272 },
  { provider: 'yahoo', symbol: "GOOG", name: "Alphabet (Google)", rank: 4, metric: 3492971020288 },
  { provider: 'yahoo', symbol: "AMZN", name: "Amazon", rank: 5, metric: 2817693057024 },
  { provider: 'yahoo', symbol: "SPCX", name: "SpaceX", rank: 6, metric: 1715424198656 },
  { provider: 'yahoo', symbol: "META", name: "Meta Platforms (Facebook)", rank: 7, metric: 1566111432704 },
  { provider: 'yahoo', symbol: "AVGO", name: "Broadcom", rank: 8, metric: 1460635303936 },
  { provider: 'yahoo', symbol: "TSLA", name: "Tesla", rank: 9, metric: 1389997326336 },
  { provider: 'yahoo', symbol: "LLY", name: "Eli Lilly", rank: 10, metric: 1250864398336 },
  { provider: 'yahoo', symbol: "BRK-B", name: "Berkshire Hathaway", rank: 11, metric: 1243998584832 },
  { provider: 'yahoo', symbol: "WMT", name: "Walmart", rank: 12, metric: 1025833435136 },
  { provider: 'yahoo', symbol: "JPM", name: "JPMorgan Chase", rank: 13, metric: 908351242240 },
  { provider: 'yahoo', symbol: "MU", name: "Micron Technology", rank: 14, metric: 805648007168 },
  { provider: 'yahoo', symbol: "V", name: "Visa", rank: 15, metric: 803476275200 },
  { provider: 'yahoo', symbol: "AMD", name: "AMD", rank: 16, metric: 702301798400 },
  { provider: 'yahoo', symbol: "XOM", name: "Exxon Mobil", rank: 17, metric: 695283089408 },
  { provider: 'yahoo', symbol: "JNJ", name: "Johnson & Johnson", rank: 18, metric: 664387518464 },
  { provider: 'yahoo', symbol: "MA", name: "Mastercard", rank: 19, metric: 578530639872 },
  { provider: 'yahoo', symbol: "ABBV", name: "AbbVie", rank: 20, metric: 519794065408 },
  { provider: 'yahoo', symbol: "COST", name: "Costco", rank: 21, metric: 472874385408 },
  { provider: 'yahoo', symbol: "CVX", name: "Chevron", rank: 22, metric: 427444600832 },
  { provider: 'yahoo', symbol: "KO", name: "Coca-Cola", rank: 23, metric: 412208267264 },
  { provider: 'yahoo', symbol: "PG", name: "Procter & Gamble", rank: 24, metric: 387498541056 },
  { provider: 'yahoo', symbol: "CSCO", name: "Cisco", rank: 25, metric: 386886041600 },
  { provider: 'yahoo', symbol: "PLTR", name: "Palantir", rank: 26, metric: 380405678080 },
  { provider: 'yahoo', symbol: "MRK", name: "Merck", rank: 27, metric: 370433490944 },
  { provider: 'yahoo', symbol: "UNH", name: "UnitedHealth", rank: 28, metric: 362987683840 },
  { provider: 'yahoo', symbol: "ORCL", name: "Oracle", rank: 29, metric: 360765587456 },
  { provider: 'yahoo', symbol: "HD", name: "Home Depot", rank: 30, metric: 351805308928 },
];

const STOCKS_VOLUME: MarketListEntry[] = [
  { provider: 'yahoo', symbol: "NVDA", name: "NVIDIA Corporation", rank: 1, metric: 113170456 },
  { provider: 'yahoo', symbol: "INTC", name: "Intel Corporation", rank: 2, metric: 111770006 },
  { provider: 'yahoo', symbol: "SPCX", name: "Space Exploration Technologies", rank: 3, metric: 101273221 },
  { provider: 'yahoo', symbol: "NU", name: "Nu Holdings Ltd.", rank: 4, metric: 80545723 },
  { provider: 'yahoo', symbol: "NOK", name: "Nokia Corporation Sponsored", rank: 5, metric: 77900904 },
  { provider: 'yahoo', symbol: "AAL", name: "American Airlines Group, Inc.", rank: 6, metric: 63450006 },
  { provider: 'yahoo', symbol: "ONDS", name: "Ondas Inc", rank: 7, metric: 59780962 },
  { provider: 'yahoo', symbol: "GRAB", name: "Grab Holdings Limited", rank: 8, metric: 59479470 },
  { provider: 'yahoo', symbol: "SOFI", name: "SoFi Technologies, Inc.", rank: 9, metric: 48091040 },
  { provider: 'yahoo', symbol: "IREN", name: "IREN LIMITED", rank: 10, metric: 46239046 },
  { provider: 'yahoo', symbol: "F", name: "Ford Motor Company", rank: 11, metric: 43884148 },
  { provider: 'yahoo', symbol: "BBD", name: "Banco Bradesco Sa", rank: 12, metric: 43794815 },
  { provider: 'yahoo', symbol: "MARA", name: "MARA Holdings, Inc.", rank: 13, metric: 43227417 },
  { provider: 'yahoo', symbol: "SMCI", name: "Super Micro Computer, Inc.", rank: 14, metric: 43220089 },
  { provider: 'yahoo', symbol: "RIG", name: "Transocean Ltd (Switzerland)", rank: 15, metric: 42899529 },
  { provider: 'yahoo', symbol: "T", name: "AT&T Inc.", rank: 16, metric: 42359448 },
  { provider: 'yahoo', symbol: "AAPL", name: "Apple Inc.", rank: 17, metric: 42257173 },
  { provider: 'yahoo', symbol: "CIFR", name: "Cipher Digital Inc.", rank: 18, metric: 41382765 },
  { provider: 'yahoo', symbol: "PCG", name: "Pacific Gas & Electric Co.", rank: 19, metric: 39796035 },
  { provider: 'yahoo', symbol: "CRWV", name: "CoreWeave, Inc.", rank: 20, metric: 39505976 },
  { provider: 'yahoo', symbol: "AMZN", name: "Amazon.com, Inc.", rank: 21, metric: 37723882 },
  { provider: 'yahoo', symbol: "SNAP", name: "Snap Inc.", rank: 22, metric: 37229751 },
  { provider: 'yahoo', symbol: "BMNR", name: "BitMine Immersion Technologies,", rank: 23, metric: 36976357 },
  { provider: 'yahoo', symbol: "TSLA", name: "Tesla, Inc.", rank: 24, metric: 36963582 },
  { provider: 'yahoo', symbol: "BAC", name: "Bank of America Corporation", rank: 25, metric: 36698559 },
  { provider: 'yahoo', symbol: "CDE", name: "Coeur Mining, Inc.", rank: 26, metric: 36619154 },
  { provider: 'yahoo', symbol: "NFLX", name: "Netflix, Inc.", rank: 27, metric: 36152523 },
  { provider: 'yahoo', symbol: "WULF", name: "TeraWulf Inc.", rank: 28, metric: 34943685 },
  { provider: 'yahoo', symbol: "HL", name: "Hecla Mining Company", rank: 29, metric: 34614418 },
  { provider: 'yahoo', symbol: "RKT", name: "Rocket Companies, Inc.", rank: 30, metric: 34553779 },
];

const INDICES: MarketListEntry[] = [
  { provider: 'yahoo', symbol: "^GSPC", name: "S&P 500", rank: 1 },
  { provider: 'yahoo', symbol: "^NDX", name: "Nasdaq 100", rank: 2 },
  { provider: 'yahoo', symbol: "^DJI", name: "Dow Jones Industrial Average", rank: 3 },
  { provider: 'yahoo', symbol: "^RUT", name: "Russell 2000", rank: 4 },
  { provider: 'yahoo', symbol: "^FTSE", name: "FTSE 100", rank: 5 },
  { provider: 'yahoo', symbol: "^GDAXI", name: "DAX", rank: 6 },
  { provider: 'yahoo', symbol: "^FCHI", name: "CAC 40", rank: 7 },
  { provider: 'yahoo', symbol: "^N225", name: "Nikkei 225", rank: 8 },
  { provider: 'yahoo', symbol: "^HSI", name: "Hang Seng", rank: 9 },
  { provider: 'yahoo', symbol: "^STOXX50E", name: "Euro Stoxx 50", rank: 10 },
];

function fixed(id: MarketListId, title: string, source: string, entries: MarketListEntry[]): MarketList {
  return { id, title, source, date: '2026-11-05', live: false, entries, excluded: [], skipped: [] };
}

/** The stock and index lists, fixed and dated. */
export const FIXED_MARKET_LISTS: MarketList[] = [
  fixed('stocks-cap', 'Top stocks by market cap', "companiesmarketcap.com, largest companies in the USA by market cap (US-listed; tickers as Yahoo writes them)", STOCKS_CAP),
  fixed('stocks-volume', 'Top stocks by volume', "Yahoo Finance screener \"most_actives\" (US equities, the 100 most traded that day), ranked by 3-month average daily volume", STOCKS_VOLUME),
  fixed('indices', 'Indices', "Fixed list of major tradable indices, via Yahoo Finance", INDICES),
];
