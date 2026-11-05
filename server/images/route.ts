/**
 * `/api/images`: the pictures of the Image drawing, stored by the SHA-256 of their bytes. Same-origin only:
 * no CORS header on any reply, and every write must come from the Vost page itself.
 *
 *   GET  /api/images             { count, bytes, writable }
 *   PUT  /api/images/<key>?w=&h= the raw bytes (201 new, 200 already stored)
 *   GET  /api/images/<key>       the bytes, or 404
 *   POST /api/images/sweep       { refs } - stamp what is used, remove what nothing uses for a day
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isImageType, sniffType } from '../../shared/imageType.ts';
import { crossSiteReason } from '../alerts/route.ts';
import { readBody, readBytes } from '../body.ts';
import type { DocStore } from '../settings/store.ts';
import { isImageKey, MAX_IMAGE_BYTES, type ImageStore } from './store.ts';

const BASE = '/api/images';
const SWEEP = `${BASE}/sweep`;
export const MAX_SWEEP_BYTES = 1024 * 1024;
const MAX_SIDE = 16384;

export const isImagesPath = (pathname: string): boolean => pathname === BASE || pathname.startsWith(`${BASE}/`);

export interface ImagesDeps {
  store: ImageStore;
  /** The settings documents; a sweep keeps every picture one of them names. */
  settings: Pick<DocStore, 'list'>;
  log: (line: string) => void;
  now?: () => number;
}

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
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Adds every string value inside `value` that looks like a picture key to `into`. */
function collectKeys(value: unknown, into: Set<string>): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') {
      if (isImageKey(v)) into.add(v);
    } else if (Array.isArray(v)) stack.push(...v);
    else if (isRecord(v)) stack.push(...Object.values(v));
  }
}

const parseSide = (raw: string | null): number | null => {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_SIDE ? n : null;
};

export async function handleImages(req: IncomingMessage, res: ServerResponse, url: URL, deps: ImagesDeps): Promise<void> {
  const method = req.method ?? 'GET';
  const { store, log } = deps;
  const now = deps.now ?? Date.now;
  const refuse = (status: number, reason: string, code?: string): void => {
    if (status === 403 || status === 503) log(`[images] ${status} ${method} ${url.pathname}: ${reason}`);
    reply(res, status, code ? { error: reason, code } : { error: reason });
  };
  const methodNotAllowed = (allowed: string[]): void => {
    req.resume();
    res.setHeader('allow', allowed.join(', '));
    refuse(405, `Use ${allowed.join(' or ')}`);
  };
  /** The checks every write passes before its body is read; true when it was refused. */
  const writeRefused = async (): Promise<boolean> => {
    const why = crossSiteReason(req);
    if (why) return refuse(403, `Pictures are only accepted from the Vost page itself (${why})`), true;
    if (!(await store.writable)) return refuse(503, 'Pictures cannot be saved: the data folder is not writable. Check VOST_DATA_DIR.'), true;
    return false;
  };

  if (method === 'OPTIONS') return reply(res, 204);

  try {
    if (url.pathname === BASE || url.pathname === `${BASE}/`) {
      if (method !== 'GET') return methodNotAllowed(['GET']);
      return reply(res, 200, { ...store.stats(), writable: await store.writable });
    }

    if (url.pathname === SWEEP) {
      if (method !== 'POST') return methodNotAllowed(['POST']);
      if (await writeRefused()) return void req.resume();
      if (!isJson(req)) return req.resume(), refuse(415, 'Send content-type: application/json');
      const raw = await readBody(req, MAX_SWEEP_BYTES);
      if (raw === 'too-large') return refuse(413, `Body must be at most ${MAX_SWEEP_BYTES} bytes`);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return refuse(400, 'Body is not valid JSON');
      }
      if (!isRecord(body) || !Array.isArray(body.refs) || !body.refs.every((r) => typeof r === 'string')) return refuse(400, 'Body must be { "refs": [key, ...] }');
      const refs = new Set<string>(body.refs as string[]);
      let removable = true;
      try {
        for (const doc of Object.values(await deps.settings.list())) collectKeys(doc, refs);
      } catch (err) {
        removable = false; // what the settings name is unknown: stamp what the caller named and remove nothing
        log(`[images] settings could not be read, nothing is removed (${err instanceof Error ? err.message : String(err)})`);
      }
      const removed = await store.sweep(refs, now(), removable);
      return reply(res, 200, { removed });
    }

    let key: string;
    try {
      key = decodeURIComponent(url.pathname.slice(BASE.length + 1));
    } catch {
      return refuse(400, 'Bad picture key');
    }

    if (method === 'GET') {
      const meta = isImageKey(key) ? store.meta(key) : undefined;
      const bytes = meta ? await store.read(key) : null;
      if (!meta || !bytes) return refuse(404, 'No such picture');
      res.writeHead(200, {
        'content-type': meta.type,
        'content-length': bytes.length,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      });
      return void res.end(bytes);
    }
    if (method !== 'PUT') return methodNotAllowed(['GET', 'PUT']);

    if (await writeRefused()) return void req.resume();
    if (!isImageKey(key)) return req.resume(), refuse(400, 'The key must be 64 lowercase hex characters (the SHA-256 of the picture)');
    const w = parseSide(url.searchParams.get('w'));
    const h = parseSide(url.searchParams.get('h'));
    if (w === null || h === null) return req.resume(), refuse(400, `w and h must be integers from 1 to ${MAX_SIDE}`);
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!isImageType(type)) return req.resume(), refuse(415, 'Only PNG, JPEG, GIF or WebP pictures are accepted', 'type');
    const bytes = await readBytes(req, MAX_IMAGE_BYTES);
    if (bytes === 'too-large') return refuse(413, `A picture is at most ${MAX_IMAGE_BYTES} bytes`, 'size');
    if (createHash('sha256').update(bytes).digest('hex') !== key) return refuse(400, 'The key is not the SHA-256 of the body');
    if (sniffType(bytes.subarray(0, 12)) !== type) return refuse(415, 'The bytes are not the declared picture type', 'type');
    const result = await store.put(key, bytes, type, w, h, now());
    if (result.status === 'full') return refuse(507, 'The picture store is full', 'store');
    return reply(res, result.status === 'created' ? 201 : 200, { key, w: result.w, h: result.h });
  } catch (err) {
    log(`[images] ${method} ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
    const detail = err instanceof Error ? err.message : String(err);
    return method === 'GET' ? refuse(500, 'Internal error') : refuse(503, `Pictures could not be saved (${detail}). Check VOST_DATA_DIR.`);
  }
}
