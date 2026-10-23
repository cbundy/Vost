/**
 * Fetch helper. By default every remote request goes through the small
 * self-hosted proxy (`/api/proxy?url=...`) which whitelists known public
 * market-data hosts. If the app was deployed as a static site without the
 * proxy, requests fall back to direct calls (works only when the upstream
 * sends permissive CORS headers, e.g. Binance).
 */
import type { Candle, Timeframe } from '../../types';

const env = import.meta.env ?? {};
const PROXY_PREFIX = env.VITE_PROXY_PREFIX ?? '/api/proxy';
const DIRECT_ONLY = env.VITE_DIRECT === 'true';

export function proxiedUrl(url: string): string {
  return `${PROXY_PREFIX}?url=${encodeURIComponent(url)}`;
}

async function attempt(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const short = body.slice(0, 180).replace(/\s+/g, ' ').trim();
    throw new HttpError(res.status, short || res.statusText, url);
  }
  return res;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public url: string,
  ) {
    super(`HTTP ${status}${message ? ` — ${message}` : ''}`);
    this.name = 'HttpError';
  }
}

export async function fetchWithProxy(url: string, init: RequestInit = {}): Promise<Response> {
  if (DIRECT_ONLY) return attempt(url, init);
  try {
    return await attempt(proxiedUrl(url), init);
  } catch (proxyErr) {
    try {
      return await attempt(url, init);
    } catch {
      throw proxyErr;
    }
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithProxy(url, init);
  return (await res.json()) as T;
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const res = await fetchWithProxy(url, init);
  return await res.text();
}

/* ------------------------------------------------------------------ */
/* Provider contract                                                   */
/* ------------------------------------------------------------------ */

export interface HistoryRequest {
  symbol: string;
  timeframe: Timeframe;
  /** Target number of bars (the provider may return fewer). */
  bars: number;
}

export interface SymbolSuggestion {
  symbol: string;
  label?: string;
  exchange?: string;
  type?: string;
}

export interface DataProvider {
  id: string;
  name: string;
  description: string;
  /** Works without any network connection. */
  offline?: boolean;
  /** Supports realtime websocket updates. */
  supportsLive?: boolean;
  /** Needs the Node proxy for CORS (true) — informational only. */
  needsProxy?: boolean;
  timeframes: Timeframe[];
  defaultTimeframe: Timeframe;
  defaultSymbol: string;
  popularSymbols: SymbolSuggestion[];
  /** The provider's full tradable list, when it has one (browsable in the symbol search). */
  listSymbols?(signal?: AbortSignal): Promise<SymbolSuggestion[]>;
  searchSymbols?(query: string, signal?: AbortSignal): Promise<SymbolSuggestion[]>;
  fetchHistory(req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]>;
}

export function sortCandles(candles: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of candles) {
    if (Number.isFinite(c.time) && Number.isFinite(c.close)) map.set(c.time, c);
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}
