/**
 * The market-data API: `GET /api/providers`, `/api/history`, `/api/symbols`
 * and `/api/search`. Handlers take their dependencies as a parameter so tests
 * can inject a fake fetch and never touch the network.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_BARS, TIMEFRAMES, rangeBarCount, type ApiError, type Timeframe } from '../shared/market.ts';
import { PROVIDER_CATALOG, catalogEntry } from '../shared/providerCatalog.ts';
import { InputError, NotFoundError, UpstreamError } from './providers/errors.ts';
import { adapters } from './providers/index.ts';
import { createSymbolCache, type SymbolCache } from './providers/symbolCache.ts';
import type { FetchFn } from './providers/upstream.ts';
import { sendJson } from './respond.ts';

export interface ApiDeps {
  /** Defaults to `globalThis.fetch`. */
  fetch?: FetchFn;
  symbols: SymbolCache;
}

export function createApiDeps(overrides: Partial<ApiDeps> = {}): ApiDeps {
  return { symbols: createSymbolCache(), ...overrides };
}

const ROUTES = ['/api/health', '/api/providers', '/api/history', '/api/symbols', '/api/search', '/api/live'];

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
      // A known timeframe the provider lacks is refused by its adapter, with its own wording.
      if (!(TIMEFRAMES as readonly string[]).includes(timeframe)) {
        throw new InputError(`${info.name} does not support timeframe ${timeframe || '(none)'}`);
      }
      const from = parseTime('from', url.searchParams.get('from'));
      let to = parseTime('to', url.searchParams.get('to'));
      if (from === undefined) {
        const bars = parseBars(url.searchParams.get('bars'));
        if (to !== undefined) to = Math.min(to, Math.floor(Date.now() / 1000));
        return adapter.history(base, { symbol, timeframe: timeframe as Timeframe, bars, ...(to === undefined ? {} : { to }) });
      }
      to = Math.min(to ?? Infinity, Math.floor(Date.now() / 1000));
      if (from > to) throw new InputError('from must not be after to (or in the future)');
      const count = rangeBarCount(timeframe as Timeframe, from, to);
      if (count > MAX_BARS) {
        throw new InputError(`That span is about ${count} ${timeframe} bars, above the limit of ${MAX_BARS}; pick a shorter span or a larger timeframe`);
      }
      return adapter.history(base, { symbol, timeframe: timeframe as Timeframe, bars: count, from, to });
    }
    case '/api/symbols': {
      const { info, adapter } = provider(url);
      if (!info.hasSymbolList || !adapter.listSymbols) throw new InputError(`${info.name} has no symbol list; use /api/search`);
      return adapter.listSymbols(base);
    }
    case '/api/search': {
      const { adapter } = provider(url);
      return adapter.search(base, url.searchParams.get('q') ?? '');
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
