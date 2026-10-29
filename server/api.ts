/**
 * The market-data API: `GET /api/providers`, `/api/history`, `/api/symbols`
 * and `/api/search`. Handlers take their dependencies as a parameter so tests
 * can inject a fake fetch and never touch the network.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_BARS, rangeBarCount, type ApiError, type Candle, type ProviderInfo, type Timeframe } from '../shared/market.ts';
import { PROVIDER_CATALOG, catalogEntry } from '../shared/providerCatalog.ts';
import { InputError, NotFoundError, UpstreamError } from './providers/errors.ts';
import { adapters } from './providers/index.ts';
import { createSymbolCache, type SymbolCache } from './providers/symbolCache.ts';
import type { AdapterContext, HistoryRequest, ProviderAdapter } from './providers/types.ts';
import type { FetchFn } from './providers/upstream.ts';
import type { CheckResult } from './status/registry.ts';
import { sendJson } from './respond.ts';
import type { CandleStore } from './candles/store.ts';
import { readThroughHistory } from './candles/history.ts';
import { builtHistory } from './providers/built.ts';
import type { Calendar } from '../shared/timeframes.ts';

export interface ApiDeps {
  /** Defaults to `globalThis.fetch`. */
  fetch?: FetchFn;
  symbols: SymbolCache;
  /** Told how each real history, symbols or search request went, for the status page (provider failures only, never a bad request). */
  onOutcome?(provider: string, feed: 'history' | 'symbols', result: CheckResult): void;
  /** The on-disk candle store; with `isRecorded` it answers history for the series the server records. */
  candles?: CandleStore;
  /** Whether the server records this series. Default: nothing is recorded, so every request goes to the exchange. */
  isRecorded?: (provider: string, symbol: string, timeframe: Timeframe) => boolean;
}

export function createApiDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return { symbols: createSymbolCache(), ...overrides };
}

const ROUTES = ['/api/health', '/api/providers', '/api/history', '/api/symbols', '/api/search', '/api/live', '/api/status', '/api/alerts'];

function provider(url: URL) {
  const id = url.searchParams.get('provider') ?? '';
  const info = catalogEntry(id);
  const adapter = adapters.get(id);
  if (!info || !adapter) {
    throw new InputError(`Unknown provider "${id}". Use one of: ${PROVIDER_CATALOG.map((p) => p.id).join(', ')}.`);
  }
  return { info, adapter };
}

function parseBars(raw: string | null): number {
  const n = raw !== null && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_BARS) {
    throw new InputError(`bars must be an integer from 1 to ${MAX_BARS}`);
  }
  return n;
}

function parseTime(name: string, raw: string | null): number | undefined {
  if (raw === null) return undefined;
  if (!/^\d+$/.test(raw.trim())) throw new InputError(`${name} must be a unix time in seconds (a non-negative integer)`);
  return Number(raw);
}

/** Runs a provider call and reports its outcome: a success, or an `UpstreamError` (a caller's mistake is not the provider's health). */
async function tracked<T>(deps: ApiDeps, provider: string, feed: 'history' | 'symbols', call: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const out = await call();
    deps.onOutcome?.(provider, feed, { ok: true, latencyMs: Date.now() - started });
    return out;
  } catch (err) {
    if (err instanceof UpstreamError) deps.onOutcome?.(provider, feed, { ok: false, error: err.message, latencyMs: Date.now() - started });
    throw err;
  }
}

/** One history request: through the candle store for a recorded series, else straight to the exchange. */
function history(deps: ApiDeps, id: string, ctx: AdapterContext, adapter: ProviderAdapter, req: HistoryRequest): Promise<Candle[]> {
  return readThroughHistory(
    { store: deps.candles, isRecorded: deps.isRecorded, fetch: (r) => tracked(deps, id, 'history', () => adapter.history(ctx, r)) },
    id,
    req,
  );
}

/** The calendar each built series last reported (`provider:symbol`), for when the base bars come from the candle store and no fetch reports one. */
const calendars = new Map<string, Calendar>();

/** One history request for `timeframe`: native as it is, built from the provider's lower native timeframe. */
function timeframeHistory(deps: ApiDeps, info: ProviderInfo, ctx: AdapterContext, adapter: ProviderAdapter, req: HistoryRequest): Promise<Candle[]> {
  if (info.timeframes.includes(req.timeframe)) return history(deps, info.id, ctx, adapter, req);
  const key = `${info.id}:${req.symbol}`;
  return builtHistory(
    {
      fetchBase: (baseReq, onCalendar) =>
        history(deps, info.id, { ...ctx, onCalendar: (c) => { calendars.set(key, c); onCalendar(c); } }, adapter, baseReq),
      calendar: calendars.get(key),
    },
    info.timeframes,
    req,
  );
}

async function route(url: URL, deps: ApiDeps, signal: AbortSignal): Promise<unknown> {
  const base = { fetch: deps.fetch, symbols: deps.symbols, signal };
  switch (url.pathname) {
    case '/api/providers':
      return PROVIDER_CATALOG;
    case '/api/history': {
      const { info, adapter } = provider(url);
      const symbol = (url.searchParams.get('symbol') ?? '').trim();
      if (!symbol) throw new InputError('Missing symbol');
      const timeframe = url.searchParams.get('timeframe') ?? '';
      // Neither native nor buildable from a lower native timeframe: refused before any upstream call.
      if (![...info.timeframes, ...info.builtTimeframes].some((tf) => tf === timeframe)) {
        throw new InputError(`${info.name} does not support timeframe ${timeframe || '(none)'}`);
      }
      const from = parseTime('from', url.searchParams.get('from'));
      let to = parseTime('to', url.searchParams.get('to'));
      if (from === undefined) {
        const bars = parseBars(url.searchParams.get('bars'));
        if (to !== undefined) to = Math.min(to, Math.floor(Date.now() / 1000));
        return timeframeHistory(deps, info, base, adapter, { symbol, timeframe: timeframe as Timeframe, bars, ...(to === undefined ? {} : { to }) });
      }
      to = Math.min(to ?? Infinity, Math.floor(Date.now() / 1000));
      if (from > to) throw new InputError('from must not be after to (or in the future)');
      const count = rangeBarCount(timeframe as Timeframe, from, to);
      if (count > MAX_BARS) {
        throw new InputError(`That span is about ${count} ${timeframe} bars, above the limit of ${MAX_BARS}; pick a shorter span or a larger timeframe`);
      }
      return timeframeHistory(deps, info, base, adapter, { symbol, timeframe: timeframe as Timeframe, bars: count, from, to });
    }
    case '/api/symbols': {
      const { info, adapter } = provider(url);
      if (!info.hasSymbolList || !adapter.listSymbols) throw new InputError(`${info.name} has no symbol list; use /api/search`);
      const list = adapter.listSymbols;
      return tracked(deps, info.id, 'symbols', () => list.call(adapter, base));
    }
    case '/api/search': {
      const { info, adapter } = provider(url);
      return tracked(deps, info.id, 'symbols', () => adapter.search(base, url.searchParams.get('q') ?? ''));
    }
    default:
      throw new NotFoundError(`Unknown API route. Try ${ROUTES.join(', ')}`);
  }
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, deps: ApiDeps): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Only GET is supported' } satisfies ApiError);
  }
  // Abort the upstream calls when the browser goes away before we answered.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  try {
    sendJson(res, 200, await route(url, deps, controller.signal));
  } catch (err) {
    if (controller.signal.aborted) return;
    const where = `${url.pathname}${url.search}`;
    if (err instanceof InputError) return sendJson(res, 400, { error: err.message } satisfies ApiError);
    if (err instanceof NotFoundError) return sendJson(res, 404, { error: err.message } satisfies ApiError);
    if (err instanceof UpstreamError) {
      console.warn(`[api] 502 ${where}: ${err.message}`);
      return sendJson(res, 502, { error: err.message } satisfies ApiError);
    }
    console.error(`[api] 500 ${where}:`, err);
    return sendJson(res, 500, { error: 'Internal server error' } satisfies ApiError);
  }
}
