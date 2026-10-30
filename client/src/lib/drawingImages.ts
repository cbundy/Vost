/**
 * The picture store of the Image drawing: one IndexedDB database (`vost-images`) with one object store keyed by the
 * SHA-256 hex of the picture's bytes, so the same bytes are stored once. Drawings only keep the key and the natural
 * size. A picture is removed only by {@link sweep}, which never removes one that something may still need.
 * No React and no chart here.
 */

/** The Image tool's id. */
export const IMAGE_TOOL = 'image';

export const DB_NAME = 'vost-images';
const STORE = 'images';

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
  unavailable: "Pictures can't be stored in this browser.",
} as const;

export type ImageErrorCode = keyof typeof MESSAGES;

/** A refusal with a message fit to show the user. */
export class ImageError extends Error {
  constructor(readonly code: ImageErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ImageError';
  }
}

export type ImageRecord = { key: string; blob: Blob; type: string; size: number; w: number; h: number; addedAt: number; seenAt: number };
export type StoredImage = { key: string; w: number; h: number };

/** A stored key is 64 lowercase hex characters. */
export const isImageKey = (k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k);

/* ------------------------------ file checks ------------------------------ */

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The picture type the leading bytes say, or null. */
export function sniffType(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

/** The natural size of a picture, from the browser. */
async function browserDecode(blob: Blob): Promise<{ w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const size = { w: bmp.width, h: bmp.height };
  bmp.close();
  return size;
}

/* ------------------------------- database ------------------------------- */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => (dbPromise = null);
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('open failed'));
      req.onblocked = () => reject(new Error('open blocked'));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

/** Closes the connection (tests, before deleting the database). */
export async function closeDb(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p.catch(() => null))?.close();
}

/** Whether pictures can be stored here (the database opens). */
export async function available(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('request failed'));
  });

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });

async function db(): Promise<IDBDatabase> {
  try {
    return await openDb();
  } catch {
    throw new ImageError('unavailable');
  }
}

/** A stored picture, or null when there is none (or the store cannot be read). */
export async function getImage(key: string): Promise<ImageRecord | null> {
  try {
    const d = await openDb();
    const rec = (await done(d.transaction(STORE, 'readonly').objectStore(STORE).get(key))) as ImageRecord | undefined;
    return rec ?? null;
  } catch {
    return null;
  }
}

/** The bytes the store holds. */
export async function totalSize(): Promise<number> {
  const d = await db();
  const all = (await done(d.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as ImageRecord[];
  return all.reduce((n, r) => n + r.size, 0);
}

/** How many pictures the store holds. */
export async function count(): Promise<number> {
  const d = await db();
  return done(d.transaction(STORE, 'readonly').objectStore(STORE).count());
}

export type PutOpts = {
  /** Reads a picture's natural size; defaults to the browser's decoder. */
  decode?: (blob: Blob) => Promise<{ w: number; h: number }>;
  /** Runs once when the store would pass its limit, to free room before the file is refused. */
  sweep?: () => Promise<unknown>;
  now?: number;
};

/**
 * Validates a file (its type and its leading bytes must both say PNG, JPEG, GIF or WebP; at most 5 MB; the store must
 * stay within 50 MB), stores it under the hash of its bytes (the same bytes once) and returns its key and natural
 * size. Throws an {@link ImageError} with the message to show.
 */
export async function putImage(file: Blob, opts: PutOpts = {}): Promise<StoredImage> {
  const now = opts.now ?? Date.now();
  const declared = file.type;
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(declared)) throw new ImageError('type');
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (sniffType(head) !== declared) throw new ImageError('type');
  if (file.size > MAX_IMAGE_BYTES) throw new ImageError('size');
  const bytes = await file.arrayBuffer();
  const key = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const d = await db();
  const existing = (await done(d.transaction(STORE, 'readonly').objectStore(STORE).get(key))) as ImageRecord | undefined;
  if (existing) {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...existing, seenAt: now });
    await finished(tx);
    return { key, w: existing.w, h: existing.h };
  }
  const blob = new Blob([bytes], { type: declared });
  let size: { w: number; h: number };
  try {
    size = await (opts.decode ?? browserDecode)(blob);
  } catch {
    throw new ImageError('decode');
  }
  if (![size.w, size.h].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE)) throw new ImageError('decode');
  if ((await totalSize()) + file.size > MAX_STORE_BYTES) {
    await opts.sweep?.().catch(() => undefined);
    if ((await totalSize()) + file.size > MAX_STORE_BYTES) throw new ImageError('store');
  }
  const rec: ImageRecord = { key, blob, type: declared, size: file.size, w: size.w, h: size.h, addedAt: now, seenAt: now };
  const tx = d.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(rec);
  await finished(tx);
  return { key, w: size.w, h: size.h };
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
 * Stamps `seenAt = now` on every referenced picture and removes each picture that is not referenced and was last seen
 * more than the grace period ago. Runs in one transaction. Returns the removed keys.
 */
export async function sweep(refs: ReadonlySet<string>, now: number): Promise<string[]> {
  const d = await db();
  const tx = d.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const all = (await done(store.getAll())) as ImageRecord[];
  const removed: string[] = [];
  for (const rec of all) {
    if (refs.has(rec.key)) store.put({ ...rec, seenAt: now });
    else if (now - rec.seenAt > GRACE_MS) {
      store.delete(rec.key);
      removed.push(rec.key);
    }
  }
  await finished(tx);
  return removed;
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
