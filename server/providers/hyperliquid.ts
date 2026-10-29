/**
 * Hyperliquid public market data - free, no API key. One POST endpoint
 * (`/info`) serves everything: `meta` (perps), `spotMeta` (spot pairs) and
 * `candleSnapshot` (at most 5000 candles per call; only the latest 5000 per
 * timeframe are kept). Coin names are case-sensitive and spot pairs go by
 * internal ids (`@107`), so each market has a resolver from the readable Vost
 * symbol (any letter case) to the exact Hyperliquid coin.
 */
import type { Candle, SymbolSuggestion } from '../../shared/market.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import { InputError, NotFoundError } from './errors.ts';
import { paginateBackwards } from './exchange.ts';
import { noDataInSpan } from './range.ts';
import { createSymbolCache, type SymbolCache } from './symbolCache.ts';
import type { AdapterContext, ProviderAdapter } from './types.ts';
import { upstreamJson, type UpstreamContext } from './upstream.ts';

export type HyperliquidKind = 'perps' | 'spot';

export const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
export const HYPERLIQUID_MAX_CANDLES = 5000;
const MAX_SEARCH = 12;

/** Timeframe -> Hyperliquid interval (the strings are the same), also the ws `interval`. */
export const HYPERLIQUID_INTERVALS: Record<string, string> = {
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

const MINUTE_MS = 60_000;
/** Candle length in ms; a month is sized as 31 days so a window never falls short. */
const INTERVAL_MS: Record<string, number> = {
  '1m': MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '30m': 30 * MINUTE_MS,
  '1h': 60 * MINUTE_MS,
  '4h': 240 * MINUTE_MS,
  '1d': 1440 * MINUTE_MS,
  '1w': 10080 * MINUTE_MS,
  '1M': 31 * 1440 * MINUTE_MS,
};

const KINDS: Record<HyperliquidKind, { id: string; provider: string }> = {
  perps: { id: 'hyperliquid-perps', provider: 'Hyperliquid Perps' },
  spot: { id: 'hyperliquid-spot', provider: 'Hyperliquid Spot' },
};

/** A tradable market: the Vost-facing suggestion plus the exact coin the API wants. */
export type HyperliquidMarket = SymbolSuggestion & { symbol: string; coin: string; delisted?: boolean };

type PerpMeta = { universe?: Array<{ name: string; isDelisted?: boolean }> };
type SpotMeta = {
  tokens?: Array<{ name: string; index: number }>;
  universe?: Array<{ name: string; tokens: [number, number]; index: number }>;
};

export function parsePerpMeta(res: PerpMeta): HyperliquidMarket[] {
  return (res.universe ?? []).map((u) => ({
    symbol: u.name,
    coin: u.name,
    label: `${u.name} / USDC perp`,
    exchange: 'Hyperliquid',
    type: 'crypto',
    ...(u.isDelisted ? { delisted: true } : {}),
  }));
}

/** Tokens are looked up by their `index` field: it is not their position in the array. */
export function parseSpotMeta(res: SpotMeta): HyperliquidMarket[] {
  const tokens = new Map((res.tokens ?? []).map((t) => [t.index, t.name]));
  const out: HyperliquidMarket[] = [];
  for (const u of res.universe ?? []) {
    const base = tokens.get(u.tokens[0]);
    const quote = tokens.get(u.tokens[1]);
    if (!base || !quote) continue;
    out.push({ symbol: `${base}/${quote}`, coin: u.name, label: `${base} / ${quote}`, exchange: 'Hyperliquid', type: 'crypto' });
  }
  return out;
}

function post<T>(ctx: UpstreamContext, kind: HyperliquidKind, body: unknown): Promise<T> {
  return upstreamJson<T>(KINDS[kind].provider, HYPERLIQUID_INFO_URL, ctx, { method: 'POST', body });
}

/** The market list of `kind`, loaded once per cache lifetime (24 h) through `symbols`. */
export async function loadMarkets(kind: HyperliquidKind, ctx: UpstreamContext, symbols: SymbolCache): Promise<HyperliquidMarket[]> {
  const list = await symbols.get(KINDS[kind].id, async () =>
    kind === 'perps'
      ? parsePerpMeta(await post<PerpMeta>(ctx, kind, { type: 'meta' }))
      : parseSpotMeta(await post<SpotMeta>(ctx, kind, { type: 'spotMeta' })),
  );
  return list as HyperliquidMarket[];
}

/**
 * The market for a Vost symbol in any letter case (spot also accepts `@<index>`).
 * Unknown symbols are a 404 that names the provider and the symbol.
 */
export async function resolveMarket(kind: HyperliquidKind, symbol: string, ctx: UpstreamContext, symbols: SymbolCache): Promise<HyperliquidMarket> {
  const q = symbol.trim().toUpperCase();
  const markets = await loadMarkets(kind, ctx, symbols);
  const hit = markets.find((m) => m.symbol.toUpperCase() === q) ?? markets.find((m) => m.coin.toUpperCase() === q);
  if (!hit) throw new NotFoundError(`${KINDS[kind].provider} has no market "${symbol.trim()}". Check the symbol (e.g. ${catalogEntry(KINDS[kind].id)!.defaultSymbol}).`);
  return hit;
}

/** Live feeds share one symbol cache across subscriptions (24 h per market list). */
export const liveSymbols = createSymbolCache();

type HlCandle = { t: number; o: string; h: string; l: string; c: string; v: string };

export function parseHyperliquidCandle(r: HlCandle): Candle {
  return { time: Math.floor(Number(r.t) / 1000), open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c), volume: Number(r.v) };
}

/** Case-insensitive search on symbol and label; delisted markets are left out. Prefix matches first. */
export function searchMarkets(all: HyperliquidMarket[], query: string): SymbolSuggestion[] {
  const q = query.trim().toUpperCase();
  const direct: HyperliquidMarket[] = [];
  const rest: HyperliquidMarket[] = [];
  for (const m of all) {
    if (m.delisted) continue;
    if (m.symbol.toUpperCase().startsWith(q)) direct.push(m);
    else if (m.symbol.toUpperCase().includes(q) || (m.label ?? '').toUpperCase().includes(q)) rest.push(m);
  }
  return [...direct, ...rest].slice(0, MAX_SEARCH).map(({ symbol, label, exchange, type }) => ({ symbol, label, exchange, type }));
}

function makeAdapter(kind: HyperliquidKind): ProviderAdapter {
  const { id, provider } = KINDS[kind];
  const popular = catalogEntry(id)!.popularSymbols;
  return {
    id,

    async search(ctx, query) {
      if (!query.trim()) return popular;
      return searchMarkets(await loadMarkets(kind, ctx, ctx.symbols), query);
    },

    async history(ctx: AdapterContext, req) {
      const interval = HYPERLIQUID_INTERVALS[req.timeframe];
      if (!interval) throw new InputError(`${provider} does not support timeframe ${req.timeframe}`);
      const { coin, symbol } = await resolveMarket(kind, req.symbol, ctx, ctx.symbols);
      const bars = Math.max(1, req.bars);
      const range = req.from !== undefined;
      const span = INTERVAL_MS[req.timeframe];
      const candles = await paginateBackwards(
        { bars, from: req.from, to: req.to },
        async (before) => {
          const count = range ? HYPERLIQUID_MAX_CANDLES : Math.min(HYPERLIQUID_MAX_CANDLES, bars);
          // `endTime` is inclusive in ms: +999 keeps the candle opening at `to`.
          const endTime = before !== undefined ? before * 1000 - 1 : req.to !== undefined ? req.to * 1000 + 999 : Date.now();
          const startTime = Math.max(0, endTime - count * span);
          const rows = await post<HlCandle[]>(ctx, kind, { type: 'candleSnapshot', req: { coin, interval, startTime, endTime } });
          return (Array.isArray(rows) ? rows : []).map(parseHyperliquidCandle);
        },
        ctx.signal,
      );
      if (candles.length === 0 && range) throw noDataInSpan(provider, symbol, req.timeframe, req.from!, req.to!);
      if (candles.length === 0) throw new NotFoundError(`No data returned for ${symbol}. Check the symbol (e.g. ${catalogEntry(id)!.defaultSymbol}).`);
      return candles;
    },
  };
}

export const hyperliquidPerpsAdapter = makeAdapter('perps');
export const hyperliquidSpotAdapter = makeAdapter('spot');
