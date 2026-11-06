/**
 * `GET /api/market-lists`: the lists the market search offers. The two crypto
 * lists (top 30 by market cap and by 24h volume) are fetched live from
 * CoinMarketCap (only when VOST_COINMARKETCAP_API_KEY is set, tried first) or
 * CoinGecko, mapped to Binance USDT pairs and cached for a day; the stock and
 * index lists are fixed (shared/marketLists.ts).
 */
import { FIXED_MARKET_LISTS, MARKET_LIST_SIZE, type MarketList, type MarketListEntry, type MarketListSkip } from '../../shared/marketLists.ts';
import { UpstreamError } from '../providers/errors.ts';
import { binanceAdapter } from '../providers/binance.ts';
import type { SymbolCache } from '../providers/symbolCache.ts';
import { upstreamJson, type FetchFn } from '../providers/upstream.ts';

export const MARKET_LIST_TTL_MS = 24 * 3600 * 1000;
/** A failed load is not tried again sooner than this. */
export const MARKET_LIST_RETRY_MS = 60 * 1000;

const STABLE = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDS', 'BUSD', 'PYUSD', 'USD1', 'USDD', 'FRAX', 'EURI', 'AEUR', 'USDP', 'GUSD', 'XUSD', 'RLUSD', 'BFUSD', 'USDG', 'USDF', 'USDTB', 'SUSDE', 'SUSDS', 'USYC', 'BUIDL', 'EUR', 'EURC', 'GBP', 'TRY', 'BRL', 'XAUT', 'PAXG', 'U', 'RWUSD']);
const WRAPPED = new Set(['WBTC', 'WETH', 'WBETH', 'WSTETH', 'WEETH', 'STETH', 'CBBTC', 'BTCB', 'WBNB', 'RETH', 'CBETH', 'METH', 'LBTC', 'SOLVBTC', 'JITOSOL', 'BNSOL', 'MSOL', 'ETHFI']);
const NAME_EXCLUDE = /wrapped|staked|bridged|restaked|liquid staking|stablecoin|tokenized|usd coin|^usd|\busd\b/i;

/** Why a coin is not a candidate (stablecoin, wrapped, staked, leveraged), or null. */
export function exclusionReason(symbol: string, name: string): string | null {
  const s = symbol.toUpperCase();
  if (STABLE.has(s)) return 'stablecoin or pegged to a fiat currency or gold';
  if (WRAPPED.has(s)) return 'wrapped, bridged or staked token (tracks another coin)';
  if (s.length > 3 && s.endsWith('USD')) return 'pegged to the dollar';
  if (/(UP|DOWN|BULL|BEAR)$/.test(s) && s.length > 5) return 'leveraged token';
  if (NAME_EXCLUDE.test(name)) return 'wrapped, staked or pegged by name';
  return null;
}

type Order = 'cap' | 'volume';

interface Coin {
  symbol: string;
  name: string;
  metric: number | undefined;
}

interface Loaded {
  source: string;
  coins: Coin[];
}

const LIST_META: Record<'crypto-cap' | 'crypto-volume', { title: string; order: Order; metricName: string }> = {
  'crypto-cap': { title: 'Top crypto by market cap', order: 'cap', metricName: 'market cap' },
  'crypto-volume': { title: 'Top crypto by 24h volume', order: 'volume', metricName: '24h volume' },
};

export interface MarketListsContext {
  fetch?: FetchFn;
  symbols: SymbolCache;
  /** The optional CoinMarketCap key; blank counts as unset. */
  coinMarketCapKey?: string;
}

export interface MarketListCache {
  /** The five lists, in order. Never throws: a crypto list that cannot be built carries `error`. */
  get(ctx: MarketListsContext): Promise<MarketList[]>;
  clear(): void;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function coinGeckoCoins(body: unknown, order: Order): Coin[] {
  if (!Array.isArray(body)) throw new Error('unexpected CoinGecko answer');
  return body.flatMap((c: Record<string, unknown>) =>
    typeof c?.symbol === 'string' ? [{ symbol: c.symbol.toUpperCase(), name: String(c.name ?? ''), metric: num(order === 'cap' ? c.market_cap : c.total_volume) }] : [],
  );
}

function coinMarketCapCoins(body: unknown, order: Order): Coin[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error('unexpected CoinMarketCap answer');
  return data.flatMap((c: { symbol?: unknown; name?: unknown; quote?: { USD?: { market_cap?: unknown; volume_24h?: unknown } } }) =>
    typeof c?.symbol === 'string' ? [{ symbol: c.symbol.toUpperCase(), name: String(c.name ?? ''), metric: num(order === 'cap' ? c.quote?.USD?.market_cap : c.quote?.USD?.volume_24h) }] : [],
  );
}

/** Applies the exclusion rules and the Binance mapping: the first 30 tradable coins in upstream order. */
export function buildCryptoEntries(coins: Coin[], tradable: ReadonlySet<string>, metricName: string): { entries: MarketListEntry[]; excluded: MarketListSkip[]; skipped: MarketListSkip[] } {
  const entries: MarketListEntry[] = [];
  const excluded: MarketListSkip[] = [];
  const skipped: MarketListSkip[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < coins.length && entries.length < MARKET_LIST_SIZE; i++) {
    const { symbol, name, metric } = coins[i];
    const rank = i + 1;
    const why = exclusionReason(symbol, name);
    if (why) {
      excluded.push({ symbol, reason: `${why} (${name}, ${metricName} rank ${rank})` });
      continue;
    }
    const pair = `${symbol}USDT`;
    if (!tradable.has(pair)) {
      skipped.push({ symbol, reason: `no TRADING ${pair} pair on Binance (${name}, ${metricName} rank ${rank})` });
      continue;
    }
    if (seen.has(pair)) {
      skipped.push({ symbol, reason: `${pair} already listed for a higher ranked coin (${name}, ${metricName} rank ${rank})` });
      continue;
    }
    seen.add(pair);
    entries.push({ provider: 'binance', symbol: pair, name, rank, ...(metric === undefined ? {} : { metric }) });
  }
  return { entries, excluded, skipped };
}

/** Removes the key from text that may carry an upstream body. */
function scrub(text: string, key: string | undefined): string {
  return key ? text.split(key).join('***') : text;
}

function describe(err: unknown, key: string | undefined): string {
  if (err instanceof UpstreamError) return scrub(err.status === null ? err.body : String(err.status), key);
  return scrub(err instanceof Error ? err.message : String(err), key);
}

function hostOf(err: unknown, fallback: string): string {
  return err instanceof UpstreamError ? err.host : fallback;
}

const CG_HOST = 'api.coingecko.com';
const CMC_HOST = 'pro-api.coinmarketcap.com';

async function loadCoins(ctx: MarketListsContext, id: 'crypto-cap' | 'crypto-volume', key: string | undefined): Promise<Loaded> {
  const { order } = LIST_META[id];
  const base = { fetch: ctx.fetch };
  if (key) {
    try {
      const url = `https://${CMC_HOST}/v1/cryptocurrency/listings/latest?limit=100&sort=${order === 'cap' ? 'market_cap' : 'volume_24h'}`;
      const body = await upstreamJson<unknown>('coinmarketcap', url, base, { headers: { 'X-CMC_PRO_API_KEY': key } });
      return { source: `CoinMarketCap ${CMC_HOST} /v1/cryptocurrency/listings/latest (sort=${order === 'cap' ? 'market_cap' : 'volume_24h'}, first 100)`, coins: coinMarketCapCoins(body, order) };
    } catch (err) {
      console.warn(`[market-lists] ${id} ${hostOf(err, CMC_HOST)} ${describe(err, key)}`);
    }
  }
  const url = `https://${CG_HOST}/api/v3/coins/markets?vs_currency=usd&order=${order === 'cap' ? 'market_cap_desc' : 'volume_desc'}&per_page=100&page=1`;
  const body = await upstreamJson<unknown>('coingecko', url, base);
  return { source: `CoinGecko ${CG_HOST} /api/v3/coins/markets (order=${order === 'cap' ? 'market_cap_desc' : 'volume_desc'}, first 100)`, coins: coinGeckoCoins(body, order) };
}

async function loadList(ctx: MarketListsContext, id: 'crypto-cap' | 'crypto-volume', key: string | undefined, date: string): Promise<MarketList> {
  const meta = LIST_META[id];
  const loaded = await loadCoins(ctx, id, key);
  const symbols = await binanceAdapter.listSymbols!({ fetch: ctx.fetch, symbols: ctx.symbols });
  const tradable = new Set(symbols.map((s) => s.symbol));
  if (loaded.coins.length === 0) throw new Error('the ranking was empty');
  const built = buildCryptoEntries(loaded.coins, tradable, meta.metricName);
  return {
    id,
    title: meta.title,
    source: `${loaded.source}, mapped to Binance USDT pairs (api.binance.com /api/v3/exchangeInfo, TRADING)`,
    date,
    live: true,
    ...built,
  };
}

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

interface Slot {
  good?: { at: number; list: MarketList };
  failedAt?: number;
  lastError?: string;
  inflight?: Promise<void>;
}

export function createMarketListCache(now: () => number = Date.now, ttlMs: number = MARKET_LIST_TTL_MS, retryMs: number = MARKET_LIST_RETRY_MS): MarketListCache {
  const slots = new Map<string, Slot>();

  async function refresh(ctx: MarketListsContext, id: 'crypto-cap' | 'crypto-volume', slot: Slot): Promise<void> {
    const key = ctx.coinMarketCapKey?.trim() || undefined;
    const started = now();
    try {
      const list = await loadList(ctx, id, key, isoDate(started));
      slot.good = { at: started, list };
      slot.failedAt = undefined;
      slot.lastError = undefined;
    } catch (err) {
      slot.failedAt = now();
      slot.lastError = `${hostOf(err, 'api.binance.com')} ${describe(err, key)}`;
      console.warn(`[market-lists] ${id} ${slot.lastError}`);
    }
  }

  async function one(ctx: MarketListsContext, id: 'crypto-cap' | 'crypto-volume'): Promise<MarketList> {
    let slot = slots.get(id);
    if (!slot) slots.set(id, (slot = {}));
    const t = now();
    const fresh = slot.good && t - slot.good.at < ttlMs;
    const backingOff = slot.failedAt !== undefined && t - slot.failedAt < retryMs;
    if (!fresh && !backingOff) {
      const s = slot;
      s.inflight ??= refresh(ctx, id, s).finally(() => {
        s.inflight = undefined;
      });
      await s.inflight;
    }
    if (slot.good) {
      const stale = slot.failedAt !== undefined || now() - slot.good.at >= ttlMs;
      return stale ? { ...slot.good.list, stale: true } : slot.good.list;
    }
    const meta = LIST_META[id];
    return { id, title: meta.title, source: 'unavailable', date: isoDate(now()), live: true, error: slot.lastError ?? 'unavailable', entries: [], excluded: [], skipped: [] };
  }

  return {
    async get(ctx) {
      const [cap, volume] = await Promise.all([one(ctx, 'crypto-cap'), one(ctx, 'crypto-volume')]);
      return [cap, volume, ...FIXED_MARKET_LISTS];
    },
    clear() {
      slots.clear();
    },
  };
}
