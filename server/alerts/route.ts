/**
 * `/api/alerts`: list, create, edit and delete price alerts, and the
 * `/api/alerts/events` stream. Same-origin only: no CORS header on any reply,
 * and every write must be JSON from the Vost page itself.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AlertList } from '../../shared/alerts.ts';
import type { ApiError } from '../../shared/market.ts';
import { HEARTBEAT_MS } from '../live/route.ts';
import { InputError } from '../providers/errors.ts';
import type { AlertsService } from './index.ts';
import { CHAT_VAR, TOKEN_VAR } from './telegram.ts';

export const MAX_BODY_BYTES = 16 * 1024;

export const isAlertsPath = (pathname: string): boolean => pathname === '/api/alerts' || pathname.startsWith('/api/alerts/');

/** JSON reply without any CORS grant. */
function reply(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

/** A reason to refuse a cross-site write, or null. */
export function crossSiteReason(req: IncomingMessage): string | null {
  if (req.headers['sec-fetch-site'] === 'cross-site') return 'cross-site request';
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      /* "null" and the like fall through to the refusal */
    }
    if (!host || host !== req.headers.host) return `origin ${origin} is not this server`;
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<string | 'too-large'> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return resolve('too-large');
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

export async function handleAlerts(req: IncomingMessage, res: ServerResponse, url: URL, alerts: AlertsService, log: (line: string) => void, heartbeatMs = HEARTBEAT_MS): Promise<void> {
  const method = req.method ?? 'GET';
  const refuse = (status: number, reason: string): void => {
    if (status === 403 || status === 503) log(`[alerts] ${status} ${method} ${url.pathname}: ${reason}`);
    reply(res, status, { error: reason } satisfies ApiError);
  };

  if (method === 'OPTIONS') return reply(res, 204);

  if (url.pathname === '/api/alerts/events') {
    if (method !== 'GET') return refuse(405, 'Only GET is supported');
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' });
    res.flushHeaders();
    const send = (event: string, data: unknown): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const off = alerts.subscribe({ onAlerts: (list) => send('alerts', { alerts: list }), onTriggered: (a) => send('triggered', a), onEnd: () => res.end() });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
    }, heartbeatMs);
    res.on('close', () => {
      clearInterval(heartbeat);
      off();
    });
    return;
  }

  if (url.pathname === '/api/alerts/telegram-test') {
    if (method !== 'POST') {
      res.setHeader('allow', 'POST');
      return refuse(405, 'Use POST');
    }
    req.resume();
    const why = crossSiteReason(req);
    if (why) return refuse(403, `Alert changes are only accepted from the Vost page itself (${why})`);
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) return refuse(415, 'Send content-type: application/json');
    if (!alerts.telegram.configured) return refuse(503, `Telegram is not set up: set ${TOKEN_VAR} and ${CHAT_VAR} on the server`);
    const result = await alerts.telegram.send('Vost: test message');
    return result.ok ? reply(res, 200, { ok: true }) : refuse(502, `Telegram did not accept the message: ${result.reason}`);
  }

  let id: string | null = null;
  if (url.pathname !== '/api/alerts') {
    try {
      id = decodeURIComponent(url.pathname.slice('/api/alerts/'.length));
    } catch {
      return refuse(404, 'No such alert');
    }
  }
  const allowed = id === null ? ['GET', 'POST'] : ['PUT', 'DELETE'];
  if (!allowed.includes(method)) {
    res.setHeader('allow', allowed.join(', '));
    return refuse(405, `Use ${allowed.join(' or ')}`);
  }
  if (method === 'GET') return reply(res, 200, { alerts: alerts.list(), telegram: { configured: alerts.telegram.configured } } satisfies AlertList);

  // Writes.
  const reason = crossSiteReason(req);
  if (reason) return refuse(403, `Alert changes are only accepted from the Vost page itself (${reason})`);
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) return refuse(415, 'Send content-type: application/json');
  if (!alerts.writable) return refuse(503, 'Alerts cannot be saved: the data folder is not writable. Check VOST_DATA_DIR.');

  try {
    if (method === 'DELETE') {
      req.resume();
      return (await alerts.remove(id!)) ? reply(res, 204) : refuse(404, `No alert ${id}`);
    }
    const raw = await readBody(req);
    if (raw === 'too-large') return refuse(413, `Body must be at most ${MAX_BODY_BYTES} bytes`);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new InputError('Body is not valid JSON');
    }
    if (method === 'POST') return reply(res, 201, await alerts.create(body));
    const edited = await alerts.edit(id!, body);
    return edited ? reply(res, 200, edited) : refuse(404, `No alert ${id}`);
  } catch (err) {
    if (err instanceof InputError) return refuse(400, err.message);
    if ((err as { name?: string }).name === 'StoreError') return refuse(503, `Alerts could not be saved (${(err as Error).message}). Check VOST_DATA_DIR.`);
    log(`[alerts] ${method} ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
    return refuse(500, 'Internal error');
  }
}
