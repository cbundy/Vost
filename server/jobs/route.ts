/**
 * `/api/jobs`: start, follow, cancel and read heavy jobs run on the server. Same-origin only: no CORS header
 * on any reply, and every write must be JSON from the Vost page itself.
 *
 *   POST   /api/jobs          { kind, request, scope, placement? } -> 201 { id, state, ...summary }
 *   GET    /api/jobs          { jobs: [summary] }, newest first; ?scope= filters
 *   GET    /api/jobs/events   SSE: a `job` event (the summary) on every state change and, throttled, on progress
 *   GET    /api/jobs/<id>     the summary, plus `result` when done
 *   DELETE /api/jobs/<id>     cancels a queued or running job (200 summary), removes a finished one (204)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiError } from '../../shared/market.ts';
import { crossSiteReason } from '../alerts/route.ts';
import { readBody } from '../body.ts';
import { HEARTBEAT_MS } from '../live/route.ts';
import type { DocStore } from '../settings/store.ts';
import type { Jobs } from './jobs.ts';

export const MAX_BODY_BYTES = 64 * 1024 * 1024;
const BASE = '/api/jobs';

export const isJobsPath = (pathname: string): boolean => pathname === BASE || pathname.startsWith(`${BASE}/`);

export interface JobsRouteDeps {
  jobs: Jobs;
  /** The jobs folder, to refuse a write when it cannot be saved. */
  store: Pick<DocStore, 'writable'>;
  log: (line: string) => void;
  heartbeatMs?: number;
}

/** JSON reply without any CORS grant. */
function reply(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const isJson = (req: IncomingMessage): boolean => /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '');

export async function handleJobs(req: IncomingMessage, res: ServerResponse, url: URL, deps: JobsRouteDeps): Promise<void> {
  const method = req.method ?? 'GET';
  const { jobs, log } = deps;
  const refuse = (status: number, reason: string): void => {
    if (status === 403 || status === 503) log(`[jobs] ${status} ${method} ${url.pathname}: ${reason}`);
    reply(res, status, { error: reason } satisfies ApiError);
  };
  const methodNotAllowed = (allowed: string[]): void => {
    req.resume();
    res.setHeader('allow', allowed.join(', '));
    refuse(405, `Use ${allowed.join(' or ')}`);
  };
  /** The checks every write passes before its body is read; true when it was refused. */
  const writeRefused = async (): Promise<boolean> => {
    const why = crossSiteReason(req);
    if (why) return refuse(403, `Job changes are only accepted from the Vost page itself (${why})`), true;
    if (method === 'POST' && !isJson(req)) return refuse(415, 'Send content-type: application/json'), true;
    if (!(await deps.store.writable)) return refuse(503, 'Jobs cannot be saved: the data folder is not writable. Check VOST_DATA_DIR.'), true;
    return false;
  };

  if (method === 'OPTIONS') return reply(res, 204);

  try {
    const scope = url.searchParams.get('scope') ?? undefined;

    if (url.pathname === BASE || url.pathname === `${BASE}/`) {
      if (method === 'GET') return reply(res, 200, { jobs: jobs.list(scope) });
      if (method !== 'POST') return methodNotAllowed(['GET', 'POST']);
      if (await writeRefused()) return void req.resume();
      const raw = await readBody(req, MAX_BODY_BYTES);
      if (raw === 'too-large') return refuse(413, `Body must be at most ${MAX_BODY_BYTES} bytes`);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return refuse(400, 'Body is not valid JSON');
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return refuse(400, 'Body must be { kind, request, scope, placement? }');
      const made = await jobs.create(body as Record<string, unknown> as { kind: unknown; request: unknown; scope: unknown; placement?: unknown });
      return made.ok ? reply(res, 201, made.summary) : refuse(made.status, made.error);
    }

    if (url.pathname === `${BASE}/events`) {
      if (method !== 'GET') return methodNotAllowed(['GET']);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no', connection: 'keep-alive' });
      res.flushHeaders();
      const off = jobs.subscribe((summary) => {
        if (scope !== undefined && summary.scope !== scope) return;
        if (!res.writableEnded && !res.destroyed) res.write(`event: job\ndata: ${JSON.stringify(summary)}\n\n`);
      });
      const heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
      }, deps.heartbeatMs ?? HEARTBEAT_MS);
      res.on('close', () => {
        clearInterval(heartbeat);
        off();
      });
      return;
    }

    let id: string;
    try {
      id = decodeURIComponent(url.pathname.slice(BASE.length + 1));
    } catch {
      req.resume();
      return refuse(404, 'No such job');
    }
    if (method === 'GET') {
      const job = await jobs.get(id);
      return job ? reply(res, 200, job) : refuse(404, `No job ${id}`);
    }
    if (method !== 'DELETE') return methodNotAllowed(['GET', 'DELETE']);
    req.resume();
    if (await writeRefused()) return;
    const removed = await jobs.remove(id);
    if (removed === undefined) return refuse(404, `No job ${id}`);
    return removed === 'removed' ? reply(res, 204) : reply(res, 200, removed);
  } catch (err) {
    log(`[jobs] ${method} ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
    return refuse(method === 'GET' ? 500 : 503, method === 'GET' ? 'Internal error' : `Jobs could not be saved (${err instanceof Error ? err.message : String(err)}). Check VOST_DATA_DIR.`);
  }
}
