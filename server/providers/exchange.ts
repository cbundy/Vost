/**
 * Helpers shared by the keyless exchange adapters (Coinbase, Kraken, Bybit,
 * OKX): backwards pagination, symbol search and sorting.
 */
import type { Candle, SymbolSuggestion } from '../../shared/market.ts';

/** One candle per time (the last one wins), ascending. Drops rows without a finite time and close. */
export function sortCandles(candles: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of candles) {
    if (Number.isFinite(c.time) && Number.isFinite(c.close)) map.set(c.time, c);
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
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
