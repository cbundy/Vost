/**
 * The only REST client: every remote provider reads its data from the Vost
 * server's `/api/*` (same origin, relative URLs only). The server owns the
 * upstream calls, so the browser never meets an upstream host or its CORS rules.
 */
import type { ApiError, Candle, ProviderInfo, SymbolSuggestion } from '../../../../shared/market.ts';
import type { HistoryRequest } from './http';

async function getJson<T>(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const res = await fetch(`/api/${path}?${qs}`, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Partial<ApiError> | null;
    throw new Error(typeof body?.error === 'string' && body.error ? body.error : `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchHistoryApi(provider: string, req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]> {
  return getJson<Candle[]>('history', { provider, symbol: req.symbol, timeframe: req.timeframe, bars: req.bars }, signal);
}

export function searchSymbolsApi(provider: string, q: string, signal?: AbortSignal): Promise<SymbolSuggestion[]> {
  return getJson<SymbolSuggestion[]>('search', { provider, q }, signal);
}

export function listSymbolsApi(provider: string, signal?: AbortSignal): Promise<SymbolSuggestion[]> {
  return getJson<SymbolSuggestion[]>('symbols', { provider }, signal);
}

export function fetchProvidersApi(signal?: AbortSignal): Promise<ProviderInfo[]> {
  return getJson<ProviderInfo[]>('providers', {}, signal);
}
