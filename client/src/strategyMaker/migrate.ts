/**
 * One-time move of the strategy maker's data from the browser's own IndexedDB database (where older
 * versions kept it) to the Vost server. Every set and both settings records are sent with
 * `POST /api/strategy-maker/migrate` in batches that keep each body well under the server's cap; only
 * after every batch answered 200 is the browser database deleted. Any failure leaves it whole, and the
 * next visit tries again (the server adopts only what it lacks, so a retry adds nothing twice).
 * With no database nothing is requested and none is created.
 */

/** The browser database older versions kept their data in. */
export const DB_NAME = 'vost-strategy-maker';
export const SETS = 'highlightSets';
export const SETTINGS = 'settings';
const INPUTS_KEY = 'find-inputs';
const MODEL_KEY = 'model';

/** A batch of sets stays under this many bytes of JSON (the server accepts 128 MB per request). */
export const BATCH_BYTES = 16 * 1024 * 1024;
export const MIGRATE_URL = '/api/strategy-maker/migrate';

export interface MigrateResponse {
  status: number;
  json: () => Promise<unknown>;
}
export type MigrateTransport = (url: string, init: RequestInit) => Promise<MigrateResponse>;

export interface MoveNotice {
  /** How many sets were moved. */
  sets: number;
  /** The archive files the server wrote for records it already held differently (usually none). */
  files: string[];
}

interface OldData {
  sets: unknown[];
  inputs: unknown;
  model: unknown;
}

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** Opens the old database only when it exists: never creates one. */
async function openExisting(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  if (typeof indexedDB.databases === 'function') {
    const known = await indexedDB.databases();
    if (!known.some((d) => d.name === DB_NAME)) return null;
  }
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME);
    let created = false;
    // An upgrade on a versionless open means the database did not exist: abort it so none is made.
    open.onupgradeneeded = () => {
      created = true;
      open.transaction?.abort();
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => (created ? resolve(null) : reject(open.error));
  });
}

async function readAll(db: IDBDatabase): Promise<OldData> {
  const names = db.objectStoreNames;
  const sets = names.contains(SETS) ? ((await req(db.transaction(SETS).objectStore(SETS).getAll())) as unknown[]) : [];
  let inputs: unknown = null;
  let model: unknown = null;
  if (names.contains(SETTINGS)) {
    const store = db.transaction(SETTINGS).objectStore(SETTINGS);
    inputs = (await req(store.get(INPUTS_KEY))) ?? null;
    model = (await req(store.get(MODEL_KEY))) ?? null;
  }
  return { sets, inputs, model };
}

/** Groups the sets into batches under `BATCH_BYTES`; one set bigger than that goes alone. */
export function batchSets(sets: unknown[], limit = BATCH_BYTES): unknown[][] {
  const batches: unknown[][] = [];
  let current: unknown[] = [];
  let size = 0;
  for (const s of sets) {
    const bytes = JSON.stringify(s).length;
    if (current.length > 0 && size + bytes > limit) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(s);
    size += bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    // Another tab still holds it open: the browser deletes it as soon as that tab lets go.
    r.onblocked = () => resolve();
  });
}

/** Moves the browser's old data to the server; the notice when something was moved, else null (also on any failure). */
export async function migrateBrowserData(transport: MigrateTransport): Promise<MoveNotice | null> {
  try {
    const db = await openExisting();
    if (!db) return null;
    let data: OldData;
    try {
      data = await readAll(db);
    } finally {
      db.close();
    }
    const empty = data.sets.length === 0 && data.inputs === null && data.model === null;
    const files: string[] = [];
    if (!empty) {
      const batches = batchSets(data.sets);
      if (batches.length === 0) batches.push([]);
      for (let i = 0; i < batches.length; i += 1) {
        const last = i === batches.length - 1;
        const body = { sets: batches[i], inputs: last ? data.inputs : null, model: last ? data.model : null };
        const res = await transport(MIGRATE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (res.status !== 200) throw new Error(`The server answered ${res.status}`);
        const answer = (await res.json()) as { file?: string | null };
        if (typeof answer.file === 'string') files.push(answer.file);
      }
    }
    await deleteDatabase();
    return empty ? null : { sets: data.sets.length, files };
  } catch (e) {
    console.warn('Strategy maker: could not move the browser data to the server yet', e);
    return null;
  }
}
