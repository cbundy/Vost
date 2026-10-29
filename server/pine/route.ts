/**
 * `/api/pine/libraries`: the Pine libraries a script can import. Reads carry the
 * same CORS grant as the other GET routes; writes (PUT, DELETE) are same-origin
 * only, with no CORS header, like alerts.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiError } from '../../shared/market.ts';
import { crossSiteReason } from '../alerts/route.ts';
import { InputError, UpstreamError } from '../providers/errors.ts';
import { sendJson } from '../respond.ts';
import { MAX_SOURCE_BYTES, parseLibraryPath, type Libraries } from './libraries.ts';

/** The JSON body wraps the source, so leave room for the escaping. */
export const MAX_BODY_BYTES = MAX_SOURCE_BYTES;
const BASE = '/api/pine/libraries';

export const isPineLibrariesPath = (pathname: string): boolean => pathname === BASE || pathname.startsWith(`${BASE}/`);

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

function readBody(req: IncomingMessage): Promise<string | 'too-large'> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      req.resume();
      return resolve('too-large');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) over = true;
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(over ? 'too-large' : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function handlePineLibraries(req: IncomingMessage, res: ServerResponse, url: URL, libs: Libraries, log: (line: string) => void): Promise<void> {
  const method = req.method ?? 'GET';
  const isRead = method === 'GET' || method === 'HEAD';
  const fail = (status: number, error: string, extra: Record<string, unknown> = {}): void => {
    if (status >= 500) log(`[pine-libraries] ${status} ${method} ${url.pathname}: ${error}`);
    const body = { error, ...extra } satisfies ApiError;
    if (isRead) sendJson(res, status, body);
    else replyPlain(res, status, body);
  };

  if (method === 'OPTIONS') return replyPlain(res, 204);

  const list = url.pathname === BASE;
  let libPath = '';
  if (!list) {
    try {
      libPath = decodeURIComponent(url.pathname.slice(BASE.length + 1));
    } catch {
      return fail(400, 'Not a library path');
    }
    if (!parseLibraryPath(libPath)) return fail(400, `"${libPath}" is not a library path: use user/name/version (a positive whole version number)`);
  }

  const allowed = list ? ['GET'] : ['GET', 'PUT', 'DELETE'];
  if (!allowed.includes(method) && method !== 'HEAD') {
    res.setHeader('allow', allowed.join(', '));
    req.resume();
    return fail(405, `Use ${allowed.join(' or ')}`);
  }

  if (isRead) {
    if (list) return sendJson(res, 200, { libraries: libs.list() });
    try {
      const found = await libs.get(libPath);
      if (!found.ok) {
        return fail(
          404,
          found.reason === 'closed-source'
            ? `TradingView has no open-source copy of ${libPath}`
            : `TradingView has no library ${libPath}`,
          { reason: found.reason },
        );
      }
      const { ok: _ok, ...rest } = found;
      return sendJson(res, 200, rest);
    } catch (err) {
      if (err instanceof UpstreamError) return fail(502, `TradingView could not be reached for ${libPath}: ${err.message}`);
      log(`[pine-libraries] GET ${libPath}: ${err instanceof Error ? err.message : String(err)}`);
      return fail(500, 'Internal error');
    }
  }

  // Writes.
  const why = crossSiteReason(req);
  if (why) {
    req.resume();
    return fail(403, `Library changes are only accepted from the Vost page itself (${why})`);
  }
  if (method === 'PUT' && !/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
    req.resume();
    return fail(415, 'Send content-type: application/json');
  }
  if (!libs.writable) {
    req.resume();
    return fail(503, 'Libraries cannot be saved: the data folder is not writable. Check VOST_DATA_DIR.');
  }
  try {
    if (method === 'DELETE') {
      req.resume();
      return (await libs.remove(libPath)) ? replyPlain(res, 204) : fail(404, `No stored library ${libPath}`);
    }
    req.resume();
    const raw = await readBody(req);
    if (raw === 'too-large') return fail(413, `Body must be at most ${MAX_BODY_BYTES} bytes`);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new InputError('Body is not valid JSON');
    }
    const source = (body as { source?: unknown } | null)?.source;
    if (typeof source !== 'string') throw new InputError('Body must be {"source": "..."}');
    return replyPlain(res, 200, await libs.put(libPath, source));
  } catch (err) {
    if (err instanceof InputError) return fail(400, err.message);
    if ((err as { name?: string }).name === 'StoreError') return fail(503, `Libraries could not be saved (${(err as Error).message}). Check VOST_DATA_DIR.`);
    log(`[pine-libraries] ${method} ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
    return fail(500, 'Internal error');
  }
}
