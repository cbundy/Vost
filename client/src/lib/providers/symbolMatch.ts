/** Pure helpers to rank and group symbol suggestions. */
import type { SymbolSuggestion } from './http';

export const DEFAULT_MATCH_LIMIT = 500;

function baseQuote(s: SymbolSuggestion): string[] {
  return (s.label ?? '').toUpperCase().split(' / ').map((p) => p.trim());
}

/** Lower is a better match; -1 when it does not match at all. */
function rank(s: SymbolSuggestion, q: string): number {
  const sym = s.symbol.toUpperCase();
  if (sym === q) return 0;
  if (sym.startsWith(q)) return 1;
  const parts = baseQuote(s);
  if (parts.length > 1 && parts.some((p) => p === q)) return 2;
  if (parts.length > 1 && parts.some((p) => p.startsWith(q))) return 3;
  if (sym.includes(q)) return 4;
  if ((s.label ?? '').toUpperCase().includes(q)) return 5;
  return -1;
}

/**
 * Filters `all` by `query` and orders: exact symbol, symbol prefix, base/quote
 * match, then substring in symbol or name. Ties keep the input order. An empty
 * query returns everything (up to `limit`).
 */
export function matchSymbols(all: SymbolSuggestion[], query: string, limit: number = DEFAULT_MATCH_LIMIT): SymbolSuggestion[] {
  const q = query.trim().toUpperCase();
  if (!q) return all.slice(0, limit);
  const buckets: SymbolSuggestion[][] = [[], [], [], [], [], []];
  for (const s of all) {
    const r = rank(s, q);
    if (r >= 0) buckets[r].push(s);
  }
  return buckets.flat().slice(0, limit);
}

export interface SymbolGroup {
  title: string;
  items: SymbolSuggestion[];
}

/** Group key: quote asset when the label is "BASE / QUOTE", else the type. */
export function groupSymbols(items: SymbolSuggestion[], by: 'quote' | 'type'): SymbolGroup[] {
  const groups = new Map<string, SymbolSuggestion[]>();
  for (const s of items) {
    const parts = (s.label ?? '').split(' / ');
    const key = by === 'quote' && parts.length > 1 ? parts[parts.length - 1].trim() : (s.type ?? 'other');
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  return Array.from(groups, ([title, list]) => ({ title, items: list }));
}
