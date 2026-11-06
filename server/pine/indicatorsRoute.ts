/**
 * `/api/pine/indicators`: the TradingView indicators kept on the server. Reads (list, one
 * indicator, search) carry the same CORS grant as the other GET routes; writes (POST,
 * DELETE) are same-origin only, with no CORS header, like the library writes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiError } from '../../shared/market.ts';
import { readBody } from '../body.ts';
import { crossSiteReason } from '../alerts/route.ts';
import { InputError, UpstreamError } from '../providers/errors.ts';
import { sendJson } from '../respond.ts';
import { IndicatorError, isScriptId, type Indicators } from './indicators.ts';

export const MAX_BODY_BYTES = 16 * 1024;
const BASE = '/api/pine/indicators';

export const isPineIndicatorsPath = (pathname: string): boolean => pathname === BASE || pathname.startsWith(`${BASE}/`);

/** JSON reply without any CORS grant. */
function replyPlain(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

export async function handlePineIndicators(req: IncomingMessage, res: ServerResponse, url: URL, store: Indicators, log: (line: string) => void): Promise<void> {
  const method = req.method ?? 'GET';
  const isRead = method === 'GET' || method === 'HEAD';
  const fail = (status: number, error: string, extra: Record<string, unknown> = {}): void => {
    if (status >= 500) log(`[pine-indicators] ${status} ${method} ${url.pathname}: ${error}`);
    const body = { error, ...extra } satisfies ApiError;
    if (isRead) sendJson(res, status, body);
    else replyPlain(res, status, body);
  };

  if (method === 'OPTIONS') return replyPlain(res, 204);

  const rest = url.pathname.slice(BASE.length + 1);
  const kind: 'list' | 'search' | 'one' = url.pathname === BASE ? 'list' : rest === 'search' ? 'search' : 'one';
  let scriptId = '';
  if (kind === 'one') {
    try {
      scriptId = decodeURIComponent(rest);
    } catch {
      return fail(400, 'Not a script id');
    }
    if (!isScriptId(scriptId)) return fail(400, `"${scriptId}" is not a TradingView script id (PUB;...)`);
  }

  const allowed = kind === 'list' ? ['GET', 'POST'] : kind === 'search' ? ['GET'] : ['GET', 'DELETE'];
  if (!allowed.includes(method) && method !== 'HEAD') {
    res.setHeader('allow', allowed.join(', '));
    req.resume();
    return fail(405, `Use ${allowed.join(' or ')}`);
  }

  if (isRead) {
    if (kind === 'list') return sendJson(res, 200, { indicators: store.list() });
    if (kind === 'search') {
      const q = url.searchParams.get('q') ?? '';
      try {
        return sendJson(res, 200, { results: await store.search(q) });
      } catch (err) {
        if (err instanceof InputError) return fail(400, err.message);
        if (err instanceof UpstreamError) return fail(502, `TradingView could not be reached: ${err.message}`);
        log(`[pine-indicators] search "${q}": ${err instanceof Error ? err.message : String(err)}`);
        return fail(500, 'Internal error');
      }
    }
    const found = store.get(scriptId);
    return found ? sendJson(res, 200, found) : fail(404, `No stored indicator ${scriptId}`, { reason: 'not-found' });
  }

  // Writes.
  const why = crossSiteReason(req);
  if (why) {
    req.resume();
    return fail(403, `Indicator changes are only accepted from the Vost page itself (${why})`);
  }
  if (method === 'POST' && !/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
    req.resume();
    return fail(415, 'Send content-type: application/json');
  }
  if (!store.writable) {
    req.resume();
    return fail(503, 'Indicators cannot be saved: the data folder is not writable. Check VOST_DATA_DIR.');
  }
  try {
    if (method === 'DELETE') {
      req.resume();
      return (await store.remove(scriptId)) ? replyPlain(res, 204) : fail(404, `No stored indicator ${scriptId}`, { reason: 'not-found' });
    }
    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === 'too-large') return fail(413, `Body must be at most ${MAX_BODY_BYTES} bytes`);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new InputError('Body is not valid JSON');
    }
    const { scriptId: id, link } = (body ?? {}) as { scriptId?: unknown; link?: unknown };
    if (typeof link === 'string' && link !== '' && id === undefined) return replyPlain(res, 200, await store.add({ link }));
    if (typeof id === 'string' && id !== '' && link === undefined) return replyPlain(res, 200, await store.add({ scriptId: id }));
    throw new InputError('Body must be {"scriptId": "PUB;..."} or {"link": "https://www.tradingview.com/script/..."}');
  } catch (err) {
    if (err instanceof InputError) return fail(400, err.message);
    if (err instanceof IndicatorError) return fail(404, err.message, { reason: err.reason });
    if (err instanceof UpstreamError) return fail(502, `TradingView could not be reached: ${err.message}`);
    if ((err as { name?: string }).name === 'StoreError') return fail(503, `Indicators could not be saved (${(err as Error).message}). Check VOST_DATA_DIR.`);
    log(`[pine-indicators] ${method} ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
    return fail(500, 'Internal error');
  }
}
