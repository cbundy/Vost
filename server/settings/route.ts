/**
 * `/api/settings`: the app's settings, one JSON document per name. Same-origin
 * only: no CORS header on any reply (reads and OPTIONS included), and every
 * write must be JSON from the Vost page itself.
 *
 *   GET    /api/settings          { values: { name: value } }
 *   GET    /api/settings/<name>   the value, or 404
 *   PUT    /api/settings/<name>   store the JSON body (204)
 *   DELETE /api/settings/<name>   remove it (204, or 404)
 *   POST   /api/settings/import   { values } - adopt the names not stored yet, archive the rest
 */
import { writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { ApiError } from '../../shared/market.ts';
import { crossSiteReason } from '../alerts/route.ts';
import { readBody } from '../body.ts';
import { isValidName, type DocStore } from './store.ts';

export const MAX_DOC_BYTES = 32 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const BASE = '/api/settings';
const IMPORT = `${BASE}/import`;

export const isSettingsPath = (pathname: string): boolean => pathname === BASE || pathname.startsWith(`${BASE}/`);

export interface SettingsDeps {
  store: DocStore;
  /** Where `settings-imported-<ms>.json` goes (the data folder). */
  archiveDir: string;
  log: (line: string) => void;
  now?: () => number;
}

export interface ImportResult {
  adopted: string[];
  archived: string[];
  file: string | null;
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
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Writes the values the server did not adopt to a new file; the name never reuses an existing one. */
async function archive(deps: SettingsDeps, values: Record<string, unknown>): Promise<string> {
  let ms = (deps.now ?? Date.now)();
  const text = JSON.stringify({ values }, null, 2);
  for (;;) {
    const file = `settings-imported-${ms}.json`;
    try {
      await writeFile(path.join(deps.archiveDir, file), text, { flag: 'wx' });
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      ms += 1;
    }
  }
}

export async function handleSettings(req: IncomingMessage, res: ServerResponse, url: URL, deps: SettingsDeps): Promise<void> {
  const method = req.method ?? 'GET';
  const { store, log } = deps;
  const refuse = (status: number, reason: string): void => {
    if (status === 403 || status === 503) log(`[settings] ${status} ${method} ${url.pathname}: ${reason}`);
    reply(res, status, { error: reason } satisfies ApiError);
  };
  const methodNotAllowed = (allowed: string[]): void => {
    req.resume();
    res.setHeader('allow', allowed.join(', '));
    refuse(405, `Use ${allowed.join(' or ')}`);
  };
  /** The checks every write passes before its body is read; a reason, or null. */
  const writeRefusal = async (): Promise<boolean> => {
    const why = crossSiteReason(req);
    if (why) return refuse(403, `Settings changes are only accepted from the Vost page itself (${why})`), true;
    if (!isJson(req)) return refuse(415, 'Send content-type: application/json'), true;
    if (!(await store.writable)) return refuse(503, 'Settings cannot be saved: the data folder is not writable. Check VOST_DATA_DIR.'), true;
    return false;
  };

  if (method === 'OPTIONS') return reply(res, 204);

  try {
    if (url.pathname === BASE || url.pathname === `${BASE}/`) {
      if (method !== 'GET') return methodNotAllowed(['GET']);
      return reply(res, 200, { values: await store.list() });
    }

    if (url.pathname === IMPORT) {
      if (method !== 'POST') return methodNotAllowed(['POST']);
      if (await writeRefusal()) return void req.resume();
      const raw = await readBody(req, MAX_IMPORT_BYTES);
      if (raw === 'too-large') return refuse(413, `Body must be at most ${MAX_IMPORT_BYTES} bytes`);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return refuse(400, 'Body is not valid JSON');
      }
      if (!isRecord(body) || !isRecord(body.values)) return refuse(400, 'Body must be { "values": { name: value } }');
      const result: ImportResult = { adopted: [], archived: [], file: null };
      const leftover: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(body.values)) {
        // "import" is the endpoint's own path, so a document of that name could not be read back.
        if (isValidName(name) && name !== 'import' && (await store.putIfAbsent(name, value))) result.adopted.push(name);
        else {
          result.archived.push(name);
          leftover[name] = value;
        }
      }
      if (result.archived.length > 0) result.file = await archive(deps, leftover);
      return reply(res, 200, result);
    }

    let name: string;
    try {
      name = decodeURIComponent(url.pathname.slice(BASE.length + 1));
    } catch {
      return refuse(400, 'Bad settings name');
    }
    if (!isValidName(name)) {
      req.resume();
      return refuse(400, 'Bad settings name: use letters, digits, ".", "_" and "-", at most 128, starting with a letter or digit');
    }
    if (method === 'GET') {
      const value = await store.get(name);
      return value === undefined ? refuse(404, `No setting ${name}`) : reply(res, 200, value);
    }
    if (method !== 'PUT' && method !== 'DELETE') return methodNotAllowed(['GET', 'PUT', 'DELETE']);
    if (await writeRefusal()) return void req.resume();
    if (method === 'DELETE') {
      req.resume();
      return (await store.remove(name)) ? reply(res, 204) : refuse(404, `No setting ${name}`);
    }
    const raw = await readBody(req, MAX_DOC_BYTES);
    if (raw === 'too-large') return refuse(413, `Body must be at most ${MAX_DOC_BYTES} bytes`);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return refuse(400, 'Body is not valid JSON');
    }
    await store.put(name, value);
    return reply(res, 204);
  } catch (err) {
    log(`[settings] ${method} ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
    const detail = err instanceof Error ? err.message : String(err);
    return method === 'GET' ? refuse(500, 'Internal error') : refuse(503, `Settings could not be saved (${detail}). Check VOST_DATA_DIR.`);
  }
}
