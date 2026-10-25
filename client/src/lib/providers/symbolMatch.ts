/** Pure helper to group symbol suggestions for the symbol search. */
import type { SymbolSuggestion } from './http';

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
