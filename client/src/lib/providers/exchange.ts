/**
 * Helpers shared by the keyless exchange providers (Coinbase, Kraken, Bybit,
 * OKX): backwards pagination, the 24h symbol-list cache and symbol search.
 */
import type { Candle } from '../../types';
import { loadJson, saveJson } from '../storage';
import { sortCandles, type SymbolSuggestion } from './http';

export const SYMBOL_CACHE_MS = 24 * 3600 * 1000;

interface SymbolCache {
  at: number;
  symbols: SymbolSuggestion[];
}

/**
 * Collect up to `bars` candles ending "now", paging backwards. `fetchPage`
 * receives the oldest candle time so far (unix seconds, undefined on the first
 * call) and returns one page of candles in any order. Stops when a page is
 * empty or reaches no further back (start of history).
 */
export async function paginateBackwards(
  bars: number,
  fetchPage: (beforeSec: number | undefined) => Promise<Candle[]>,
  signal?: AbortSignal,
): Promise<Candle[]> {
  const out: Candle[] = [];
  let before: number | undefined;
  while (out.length < bars) {
    const page = (await fetchPage(before)).filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close));
    if (page.length === 0) break;
    const oldest = Math.min(...page.map((c) => c.time));
    if (before !== undefined && oldest >= before) break;
    out.push(...page);
    before = oldest;
    signal?.throwIfAborted();
  }
  return sortCandles(out).slice(-bars);
}

/** Symbol list cached in localStorage for 24h under `key`. */
export async function loadCachedSymbols(key: string, load: () => Promise<SymbolSuggestion[]>): Promise<SymbolSuggestion[]> {
  const cached = loadJson<SymbolCache | null>(key, null);
  if (cached && Date.now() - cached.at < SYMBOL_CACHE_MS && cached.symbols.length > 0) return cached.symbols;
  const symbols = await load();
  saveJson(key, { at: Date.now(), symbols } satisfies SymbolCache);
  return symbols;
}

/** Prefix matches first, then substring matches; at most 12. */
export function filterSymbols(all: SymbolSuggestion[], query: string): SymbolSuggestion[] {
  const q = query.trim().toUpperCase();
  const direct: SymbolSuggestion[] = [];
  const rest: SymbolSuggestion[] = [];
  for (const s of all) {
    if (s.symbol.startsWith(q)) direct.push(s);
    else if (s.symbol.includes(q) || (s.label ?? '').toUpperCase().includes(q)) rest.push(s);
    if (direct.length >= 12) break;
  }
  return [...direct, ...rest].slice(0, 12);
}

const QUOTE_PRIORITY = ['USDT', 'USD', 'USDC', 'EUR', 'BTC', 'ETH'];

/** Sort so common quote currencies come first, then alphabetically. */
export function sortSuggestions(list: SymbolSuggestion[]): SymbolSuggestion[] {
  const rank = (s: SymbolSuggestion): number => {
    const i = QUOTE_PRIORITY.indexOf((s.label ?? '').split(' / ')[1]);
    return i === -1 ? 99 : i;
  };
  return list.slice().sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));
}
