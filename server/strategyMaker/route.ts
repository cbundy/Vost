/**
 * `/api/strategy-maker`: the strategy maker's marked trades, find form and trained model. Same-origin
 * only, exactly like `/api/settings`: no CORS header on any reply (OPTIONS included), and every write
 * must be JSON from the Vost page itself.
 *
 *   GET    /api/strategy-maker/sets        { sets: HighlightSet[] }
 *   GET    /api/strategy-maker/sets/<id>   one set (the id URI-encoded), or 404
 *   PUT    /api/strategy-maker/sets/<id>   store the set; its `id` must equal the path id (204)
 *   DELETE /api/strategy-maker/sets/<id>   remove it (204, or 404)
 *   GET|PUT|DELETE /api/strategy-maker/inputs   the find form record
 *   GET|PUT|DELETE /api/strategy-maker/model    the trained model record
 *   GET|PUT|DELETE /api/strategy-maker/job      the server job the page is waiting for (reattach after a reload)
 *   POST   /api/strategy-maker/import      { sets, model } - overwrite, all or nothing
 *   POST   /api/strategy-maker/migrate     { sets, inputs, model } - adopt what is missing, archive what differs
 *
 * Storage is one doc-store folder: a set is `set-<sha256 hex of its id>.json` (an id is not a safe
 * file name), the other records are `inputs.json`, `model.json` and `job.json`.
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { ApiError } from '../../shared/market.ts';
import { crossSiteReason } from '../alerts/route.ts';
import { readBody } from '../body.ts';
import type { DocStore } from '../settings/store.ts';

export const MAX_SET_BYTES = 32 * 1024 * 1024;
export const MAX_BULK_BYTES = 128 * 1024 * 1024;
const BASE = '/api/strategy-maker';
const SETS = `${BASE}/sets`;
const INPUTS = 'inputs';
const MODEL = 'model';
const JOB = 'job';

export const isStrategyMakerPath = (pathname: string): boolean => pathname === BASE || pathname.startsWith(`${BASE}/`);

/** The doc-store name of a set. */
export const setName = (id: string): string => `set-${createHash('sha256').update(id).digest('hex')}`;

export interface StrategyMakerDeps {
  store: DocStore;
  /** Where `strategy-maker-imported-<ms>.json` goes (the data folder). */
  archiveDir: string;
  log: (line: string) => void;
  now?: () => number;
}

export interface MigrateResult {
  adopted: string[];
  present: string[];
  archived: string[];
  file: string | null;
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
const hasId = (v: unknown): v is Record<string, unknown> & { id: string } => isRecord(v) && typeof v.id === 'string';

/** Deep equality of two JSON values (object key order does not matter). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
  }
  return false;
}

/** Writes what the server kept its own copy of to a new file; the name never reuses an existing one. */
async function archive(deps: StrategyMakerDeps, leftover: Record<string, unknown>): Promise<string> {
  let ms = (deps.now ?? Date.now)();
  const text = JSON.stringify(leftover, null, 2);
  for (;;) {
    const file = `strategy-maker-imported-${ms}.json`;
    try {
      await writeFile(path.join(deps.archiveDir, file), text, { flag: 'wx' });
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      ms += 1;
    }
  }
}

export async function handleStrategyMaker(req: IncomingMessage, res: ServerResponse, url: URL, deps: StrategyMakerDeps): Promise<void> {
  const method = req.method ?? 'GET';
  const { store, log } = deps;
  const refuse = (status: number, reason: string): void => {
    if (status === 403 || status === 503) log(`[strategy-maker] ${status} ${method} ${url.pathname}: ${reason}`);
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
    if (why) return refuse(403, `Strategy maker changes are only accepted from the Vost page itself (${why})`), true;
    if (!isJson(req)) return refuse(415, 'Send content-type: application/json'), true;
    if (!(await store.writable)) return refuse(503, 'Strategy maker data cannot be saved: the data folder is not writable. Check VOST_DATA_DIR.'), true;
    return false;
  };
  const readJson = async (max: number): Promise<{ ok: true; value: unknown } | { ok: false }> => {
    const raw = await readBody(req, max);
    if (raw === 'too-large') return refuse(413, `Body must be at most ${max} bytes`), { ok: false };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return refuse(400, 'Body is not valid JSON'), { ok: false };
    }
  };
  const allSets = async (): Promise<Array<Record<string, unknown> & { id: string }>> =>
    Object.entries(await store.list())
      .filter(([name, v]) => name.startsWith('set-') && hasId(v) && setName(v.id) === name)
      .map(([, v]) => v as Record<string, unknown> & { id: string });

  if (method === 'OPTIONS') return reply(res, 204);

  try {
    const p = url.pathname;
    if (p === SETS || p === `${SETS}/`) {
      if (method !== 'GET') return methodNotAllowed(['GET']);
      return reply(res, 200, { sets: await allSets() });
    }

    if (p === `${BASE}/import`) {
      if (method !== 'POST') return methodNotAllowed(['POST']);
      if (await writeRefused()) return void req.resume();
      const body = await readJson(MAX_BULK_BYTES);
      if (!body.ok) return;
      const v = body.value;
      if (!isRecord(v) || !Array.isArray(v.sets) || !v.sets.every(hasId) || !(v.model === null || isRecord(v.model))) {
        return refuse(400, 'Body must be { "sets": [{ "id": ... }], "model": object or null }');
      }
      const entries: Array<[string, unknown]> = v.sets.map((s) => [setName((s as { id: string }).id), s]);
      if (v.model) entries.push([MODEL, v.model]);
      await store.putMany(entries);
      log(`[strategy-maker] import: ${v.sets.length} sets${v.model ? ' and the model' : ''}`);
      return reply(res, 204);
    }

    if (p === `${BASE}/migrate`) {
      if (method !== 'POST') return methodNotAllowed(['POST']);
      if (await writeRefused()) return void req.resume();
      const body = await readJson(MAX_BULK_BYTES);
      if (!body.ok) return;
      const v = body.value;
      if (!isRecord(v) || !Array.isArray(v.sets) || !v.sets.every(hasId) || !(v.inputs === null || isRecord(v.inputs)) || !(v.model === null || isRecord(v.model))) {
        return refuse(400, 'Body must be { "sets": [{ "id": ... }], "inputs": object or null, "model": object or null }');
      }
      const result: MigrateResult = { adopted: [], present: [], archived: [], file: null };
      const leftover: { sets: unknown[]; inputs: unknown; model: unknown } = { sets: [], inputs: null, model: null };
      const move = async (label: string, name: string, value: unknown, keep: (v: unknown) => void): Promise<void> => {
        if (await store.putIfAbsent(name, value)) return void result.adopted.push(label);
        if (sameJson(await store.get(name), value)) return void result.present.push(label);
        result.archived.push(label);
        keep(value);
      };
      for (const s of v.sets as Array<{ id: string }>) await move(s.id, setName(s.id), s, (x) => leftover.sets.push(x));
      if (v.inputs) await move(INPUTS, INPUTS, v.inputs, (x) => (leftover.inputs = x));
      if (v.model) await move(MODEL, MODEL, v.model, (x) => (leftover.model = x));
      if (result.archived.length > 0) result.file = await archive(deps, leftover);
      log(`[strategy-maker] migrate: adopted ${result.adopted.length}, present ${result.present.length}, archived ${result.archived.length} (${result.file ?? 'no file'})`);
      return reply(res, 200, result);
    }

    // The record kinds: a set (by id), the find form, the model, the job.
    let name: string;
    let setIdOfPath: string | null = null;
    if (p === `${BASE}/${INPUTS}` || p === `${BASE}/${MODEL}` || p === `${BASE}/${JOB}`) {
      name = p.slice(BASE.length + 1);
    } else if (p.startsWith(`${SETS}/`)) {
      try {
        setIdOfPath = decodeURIComponent(p.slice(SETS.length + 1));
      } catch {
        req.resume();
        return refuse(400, 'Bad set id');
      }
      name = setName(setIdOfPath);
    } else {
      req.resume();
      return refuse(404, 'No such strategy maker endpoint');
    }
    const what = setIdOfPath === null ? name : `set ${setIdOfPath}`;

    if (method === 'GET') {
      const value = await store.get(name);
      if (value === undefined || (setIdOfPath !== null && !(hasId(value) && value.id === setIdOfPath))) return refuse(404, `No ${what}`);
      return reply(res, 200, value);
    }
    if (method !== 'PUT' && method !== 'DELETE') return methodNotAllowed(['GET', 'PUT', 'DELETE']);
    if (await writeRefused()) return void req.resume();
    if (method === 'DELETE') {
      req.resume();
      if (setIdOfPath !== null) {
        const value = await store.get(name);
        if (!(hasId(value) && value.id === setIdOfPath)) return refuse(404, `No ${what}`);
      }
      return (await store.remove(name)) ? reply(res, 204) : refuse(404, `No ${what}`);
    }
    const body = await readJson(MAX_SET_BYTES);
    if (!body.ok) return;
    if (!isRecord(body.value)) return refuse(400, 'Body must be a JSON object');
    if (setIdOfPath !== null && body.value.id !== setIdOfPath) return refuse(400, 'The id in the body must equal the id in the path');
    await store.put(name, body.value);
    return reply(res, 204);
  } catch (err) {
    log(`[strategy-maker] ${method} ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`);
    const detail = err instanceof Error ? err.message : String(err);
    return method === 'GET' ? refuse(500, 'Internal error') : refuse(503, `Strategy maker data could not be saved (${detail}). Check VOST_DATA_DIR.`);
  }
}
