/**
 * In-memory symbol-list cache: 24 h per key, and concurrent misses share one
 * in-flight load. A failed load is not cached (the next call retries).
 */
import type { SymbolSuggestion } from '../../shared/market.ts';

export const SYMBOL_CACHE_MS = 24 * 3600 * 1000;

export interface SymbolCache {
  get(key: string, load: () => Promise<SymbolSuggestion[]>): Promise<SymbolSuggestion[]>;
  clear(): void;
}

export function createSymbolCache(now: () => number = Date.now, ttlMs: number = SYMBOL_CACHE_MS): SymbolCache {
  const done = new Map<string, { at: number; symbols: SymbolSuggestion[] }>();
  const inflight = new Map<string, Promise<SymbolSuggestion[]>>();
  return {
    async get(key, load) {
      const hit = done.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.symbols;
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = load()
        .then((symbols) => {
          if (symbols.length > 0) done.set(key, { at: now(), symbols });
          return symbols;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    clear() {
      done.clear();
      inflight.clear();
    },
  };
}
