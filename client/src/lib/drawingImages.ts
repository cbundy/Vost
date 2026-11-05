/**
 * The pictures of the Image drawing live on the Vost server (`/api/images`), keyed by the SHA-256 hex of their bytes,
 * so the same bytes are stored once and every browser on the server shows them. Drawings only keep the key and the
 * natural size. A picture is removed only by the server's sweep, which never removes one that something may still
 * need. The only code that touches the old browser picture store (IndexedDB `vost-images`) is
 * {@link migrateBrowserImages}, which moves its pictures to the server once. No React and no chart here.
 */
import { isImageType, sniffType } from '../../../shared/imageType.ts';

export { sniffType };

/** The Image tool's id. */
export const IMAGE_TOOL = 'image';

/** The old browser picture store, read only by the migration. */
export const DB_NAME = 'vost-images';
const STORE = 'images';
const API = '/api/images';

/** Largest picture, and largest store, in bytes. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_STORE_BYTES = 50 * 1024 * 1024;
/** Largest side of a picture in pixels (what a drawing may store). */
export const MAX_SIDE = 16384;
/** An unreferenced picture is kept this long after it was last seen referenced (another open tab's undo history may need it). */
export const GRACE_MS = 24 * 60 * 60 * 1000;

export const MESSAGES = {
  type: 'Only PNG, JPEG, GIF or WebP pictures can be added.',
  size: 'That picture is over the 5 MB limit.',
  store: 'The picture store is full (50 MB limit). Delete pictures you no longer use and try again.',
  decode: 'That picture could not be read.',
  unavailable: "Pictures can't be saved: the Vost server cannot store them right now.",
} as const;

export type ImageErrorCode = keyof typeof MESSAGES;

/** A refusal with a message fit to show the user. */
export class ImageError extends Error {
  constructor(readonly code: ImageErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ImageError';
  }
}

export type ImageRecord = { key: string; blob: Blob; type: string; size: number };
export type StoredImage = { key: string; w: number; h: number };

/** A stored key is 64 lowercase hex characters. */
export const isImageKey = (k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k);

/* ------------------------------- transport ------------------------------- */

export interface ImageResponse {
  status: number;
  json: () => Promise<unknown>;
  blob: () => Promise<Blob>;
}
/** `fetch`, narrowed to what this module needs; tests inject their own. */
export type ImageTransport = (url: string, init?: RequestInit) => Promise<ImageResponse>;

let transport: ImageTransport = (url, init) => fetch(url, init);

/** Replaces the transport (tests); `null` restores `fetch`. */
export function setImageTransport(t: ImageTransport | null): void {
  transport = t ?? ((url, init) => fetch(url, init));
}

async function jsonOf(res: ImageResponse): Promise<Record<string, unknown>> {
  try {
    const v = await res.json();
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The natural size of a picture, from the browser. */
async function browserDecode(blob: Blob): Promise<{ w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const size = { w: bmp.width, h: bmp.height };
  bmp.close();
  return size;
}

type Stats = { count: number; bytes: number; writable: boolean };

async function stats(): Promise<Stats> {
  let res: ImageResponse;
  try {
    res = await transport(API);
  } catch {
    throw new ImageError('unavailable');
  }
  const body = await jsonOf(res);
  if (res.status !== 200 || typeof body.count !== 'number' || typeof body.bytes !== 'number') throw new ImageError('unavailable');
  return { count: body.count, bytes: body.bytes, writable: body.writable === true };
}

/** Whether the server can store pictures now (it answers and its data folder is writable). */
export async function available(): Promise<boolean> {
  try {
    return (await stats()).writable;
  } catch {
    return false;
  }
}

/** A stored picture, or null when the server has none (or cannot be reached). */
export async function getImage(key: string): Promise<ImageRecord | null> {
  if (!isImageKey(key)) return null;
  try {
    const res = await transport(`${API}/${key}`);
    if (res.status !== 200) return null;
    const blob = await res.blob();
    return { key, blob, type: blob.type, size: blob.size };
  } catch {
    return null;
  }
}

/** The bytes the server's picture store holds. */
export async function totalSize(): Promise<number> {
  return (await stats()).bytes;
}

/** How many pictures the server's picture store holds. */
export async function count(): Promise<number> {
  return (await stats()).count;
}

export type PutOpts = {
  /** Reads a picture's natural size; defaults to the browser's decoder. */
  decode?: (blob: Blob) => Promise<{ w: number; h: number }>;
  /** Runs once when the server says its store is full, to free room before the upload is tried again. */
  sweep?: () => Promise<unknown>;
};

const sha256Hex = async (bytes: ArrayBuffer): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** One upload; the status and the parsed body. A network failure is `unavailable`. */
async function upload(key: string, body: Blob | ArrayBuffer, type: string, w: number, h: number): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: ImageResponse;
  try {
    res = await transport(`${API}/${key}?w=${w}&h=${h}`, { method: 'PUT', headers: { 'content-type': type }, body });
  } catch {
    throw new ImageError('unavailable');
  }
  return { status: res.status, body: await jsonOf(res) };
}

/**
 * Validates a file (its type and its leading bytes must both say PNG, JPEG, GIF or WebP; at most 5 MB; it must
 * decode), uploads it under the hash of its bytes (the same bytes once) and returns its key and natural size. When
 * the server's store is full it runs `opts.sweep` once and tries again. Throws an {@link ImageError} with the message
 * to show.
 */
export async function putImage(file: Blob, opts: PutOpts = {}): Promise<StoredImage> {
  const declared = file.type;
  if (!isImageType(declared)) throw new ImageError('type');
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (sniffType(head) !== declared) throw new ImageError('type');
  if (file.size > MAX_IMAGE_BYTES) throw new ImageError('size');
  const bytes = await file.arrayBuffer();
  const key = await sha256Hex(bytes);
  let size: { w: number; h: number };
  try {
    size = await (opts.decode ?? browserDecode)(new Blob([bytes], { type: declared }));
  } catch {
    throw new ImageError('decode');
  }
  if (![size.w, size.h].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE)) throw new ImageError('decode');
  let out = await upload(key, bytes, declared, size.w, size.h);
  if (out.status === 507) {
    await opts.sweep?.().catch(() => undefined);
    out = await upload(key, bytes, declared, size.w, size.h);
  }
  if (out.status === 200 || out.status === 201) {
    const { w, h } = out.body;
    return typeof w === 'number' && typeof h === 'number' ? { key, w, h } : { key, w: size.w, h: size.h };
  }
  if (out.status === 507) throw new ImageError('store');
  if (out.status === 413) throw new ImageError('size');
  if (out.status === 415) throw new ImageError('type');
  if (out.status === 400) throw new ImageError('decode');
  throw new ImageError('unavailable');
}

/* ----------------------- one-time move from the browser ----------------------- */

type OldRecord = { key: string; blob: Blob; type?: string; w: number; h: number };

const idbDone = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('request failed'));
  });

/** Opens the old database only when it exists (never creates it); null when there is none. */
function openOldDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    let created = false;
    req.onupgradeneeded = () => {
      // The database did not exist: undo the creation instead of leaving an empty one behind.
      created = true;
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) return resolve(db);
      db.close();
      resolve(null);
    };
    req.onerror = () => (created ? resolve(null) : reject(req.error ?? new Error('open failed')));
    req.onblocked = () => reject(new Error('open blocked'));
  });
}

async function oldDbExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases === 'function') return (await indexedDB.databases()).some((d) => d.name === DB_NAME);
  return true; // no way to ask: opening it tells (and creates nothing)
}

let migrating: Promise<void> | null = null;

/**
 * Moves the pictures an older version kept in this browser (IndexedDB `vost-images`) to the server, then deletes that
 * database. It does nothing when there is no such database, and never creates one. A picture the server will always
 * refuse (400, 413, 415) is logged and skipped; any other failure (network, 503, 507) leaves the database as it is, so
 * the next call tries again. Concurrent calls share one run. Never throws.
 */
export function migrateBrowserImages(): Promise<void> {
  migrating ??= run().finally(() => (migrating = null));
  return migrating;

  async function run(): Promise<void> {
    let db: IDBDatabase | null = null;
    try {
      if (!(await oldDbExists())) return;
      db = await openOldDb();
      if (!db) return;
      const records = (await idbDone(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as OldRecord[];
      let allDone = true;
      for (const rec of records) {
        const type = rec.type ?? rec.blob?.type ?? '';
        let status: number;
        try {
          status = (await upload(rec.key, rec.blob, type, rec.w, rec.h)).status;
        } catch {
          allDone = false;
          break; // the server is away: try again next start
        }
        if (status === 200 || status === 201) continue;
        if (status === 400 || status === 413 || status === 415) console.warn(`Vost: picture ${rec.key} could not be moved to the server (${status}) and was skipped`);
        else {
          allDone = false;
          if (status === 503 || status === 507) break;
        }
      }
      if (!allDone) {
        db.close();
        return;
      }
      db.close();
      const name = DB_NAME;
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error('delete failed'));
        req.onblocked = () => reject(new Error('delete blocked'));
      });
    } catch {
      try {
        db?.close();
      } catch {
        /* already closed */
      }
    }
  }
}

/* --------------------------- references and sweep --------------------------- */

const refSources = new Set<() => Iterable<string>>();

/** Registers something in this tab that may still need pictures (a panel's undo history, the clipboard, a pending placement); returns the unregister. */
export function registerImageRefs(source: () => Iterable<string>): () => void {
  refSources.add(source);
  return () => void refSources.delete(source);
}

/** Every picture key the registered in-tab sources hold now. */
export function inTabRefs(): Set<string> {
  const keys = new Set<string>();
  for (const s of [...refSources]) for (const k of s()) keys.add(k);
  return keys;
}

/**
 * Sends the references to the server, which stamps each referenced picture, also counts every picture the stored
 * settings name, and removes the pictures nothing uses that were last seen over a day ago. Returns the removed keys.
 * (The server's clock decides what is old; `now` is accepted for the callers' sake.)
 */
export async function sweep(refs: ReadonlySet<string>, now: number): Promise<string[]> {
  void now;
  let res: ImageResponse;
  try {
    res = await transport(`${API}/sweep`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [...refs] }) });
  } catch {
    throw new ImageError('unavailable');
  }
  const body = await jsonOf(res);
  if (res.status !== 200 || !Array.isArray(body.removed)) throw new ImageError('unavailable');
  return body.removed.filter((k): k is string => typeof k === 'string');
}

export type Persisted = { keys: ReadonlySet<string>; newer: boolean } | null;

/**
 * One sweep with every reference: the persisted drawings of every source plus the in-tab sources. It does nothing
 * (returns null) when the persisted drawings could not be read or come from a newer app, since their references are
 * then unknown.
 */
export async function sweepAll(readPersisted: () => Persisted, now: number): Promise<string[] | null> {
  const persisted = readPersisted();
  if (!persisted || persisted.newer) return null;
  const refs = new Set<string>([...persisted.keys, ...inTabRefs()]);
  return sweep(refs, now);
}

/** A debounced, never concurrent sweeper: `schedule` after a save or a load. */
export function createSweeper(readPersisted: () => Persisted, wait = 2000, clock: () => number = Date.now) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> | null = null;
  let again = false;
  const run = async (): Promise<string[] | null> => {
    if (running) {
      again = true;
      return null;
    }
    const p = sweepAll(readPersisted, clock()).catch(() => null);
    running = p;
    const out = await p;
    running = null;
    if (again) {
      again = false;
      schedule();
    }
    return out;
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, wait);
  };
  return { schedule, run };
}
