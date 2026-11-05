/**
 * The picture store: `<dir>/<sha256>` holds a picture's bytes and `<dir>/index.json` maps each key to
 * `{ type, size, w, h, addedAt, seenAt }`. The index is loaded at start and held in memory. Every change goes
 * through one serial queue and is atomic (temp file, then rename; bytes first, then the index). At start an index
 * entry without a file is dropped, and a file or temp file without an entry is removed. An unreadable index is
 * renamed `index.json.bad-<ms>` and the store starts empty (its files are then left alone, since nothing says
 * which of them are pictures to keep).
 */
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canWrite } from '../fsutil.ts';

export const KEY_PATTERN = /^[0-9a-f]{64}$/;
export const isImageKey = (k: unknown): k is string => typeof k === 'string' && KEY_PATTERN.test(k);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_STORE_BYTES = 50 * 1024 * 1024;
/** An unreferenced picture is kept this long after it was last seen referenced. */
export const GRACE_MS = 24 * 60 * 60 * 1000;

export interface ImageMeta {
  type: string;
  size: number;
  w: number;
  h: number;
  addedAt: number;
  seenAt: number;
}

export type PutResult = { status: 'created' | 'exists'; w: number; h: number } | { status: 'full' };

export interface ImageStore {
  /** The stored record, or undefined. */
  meta(key: string): ImageMeta | undefined;
  /** The picture's bytes, or null when there are none. */
  read(key: string): Promise<Buffer | null>;
  /** Stores a picture (the caller has validated it). A key already stored only gets `seenAt` stamped. */
  put(key: string, bytes: Buffer, type: string, w: number, h: number, now: number): Promise<PutResult>;
  /** Stamps `seenAt = now` on every referenced picture and removes each other one last seen over the grace period ago (unless `allowRemove` is false). */
  sweep(refs: ReadonlySet<string>, now: number, allowRemove?: boolean): Promise<string[]>;
  stats(): { count: number; bytes: number };
  readonly writable: Promise<boolean>;
}

export interface ImageStoreDeps {
  dir: string;
  log?: (line: string) => void;
  now?: () => number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMeta = (v: unknown): v is ImageMeta =>
  isRecord(v) && typeof v.type === 'string' && [v.size, v.w, v.h, v.addedAt, v.seenAt].every((n) => typeof n === 'number' && Number.isFinite(n));

export async function createImageStore(deps: ImageStoreDeps): Promise<ImageStore> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = deps.now ?? Date.now;
  const indexFile = path.join(deps.dir, 'index.json');
  const index = new Map<string, ImageMeta>();
  let queue: Promise<unknown> = Promise.resolve();
  let seq = 0;

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };

  async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
    await mkdir(deps.dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${seq++}`;
    try {
      await writeFile(tmp, data);
      await rename(tmp, file);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }
  const saveIndex = (): Promise<void> => atomicWrite(indexFile, JSON.stringify(Object.fromEntries(index)));

  /* ------------------------------ start-up ------------------------------ */
  let indexBad = false;
  let text: string | null = null;
  try {
    text = await readFile(indexFile, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`[images] cannot read ${indexFile}: ${(err as Error).message}`);
  }
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) throw new Error('not an object');
      for (const [k, v] of Object.entries(parsed)) if (isImageKey(k) && isMeta(v)) index.set(k, v);
    } catch (err) {
      indexBad = true;
      index.clear();
      const aside = `index.json.bad-${now()}`;
      try {
        await rename(indexFile, path.join(deps.dir, aside));
        log(`[images] index.json is unreadable (${(err as Error).message}): moved to ${aside}, starting empty`);
      } catch (moveErr) {
        log(`[images] index.json is unreadable and could not be moved aside: ${(moveErr as Error).message}`);
      }
    }
  }
  let files: string[] = [];
  try {
    files = await readdir(deps.dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`[images] cannot list ${deps.dir}: ${(err as Error).message}`);
  }
  const present = new Set(files);
  let dropped = 0;
  for (const k of [...index.keys()])
    if (!present.has(k)) {
      index.delete(k);
      dropped++;
    }
  if (dropped > 0) {
    log(`[images] dropped ${dropped} index entr${dropped === 1 ? 'y' : 'ies'} without a file`);
    await saveIndex().catch((err) => log(`[images] cannot write the index: ${(err as Error).message}`));
  }
  for (const f of files) {
    if (f === 'index.json' || index.has(f)) continue;
    const isPicture = KEY_PATTERN.test(f);
    if (indexBad && isPicture) continue;
    if (!isPicture && !f.includes('.tmp-')) continue; // not ours: leave it
    await unlink(path.join(deps.dir, f)).then(
      () => log(`[images] removed stray file ${f}`),
      (err) => log(`[images] cannot remove stray file ${f}: ${(err as Error).message}`),
    );
  }

  const total = (): number => [...index.values()].reduce((n, m) => n + m.size, 0);

  return {
    get writable() {
      return canWrite(deps.dir);
    },
    meta: (key) => index.get(key),
    async read(key) {
      if (!index.has(key)) return null;
      try {
        return await readFile(path.join(deps.dir, key));
      } catch {
        return null;
      }
    },
    stats: () => ({ count: index.size, bytes: total() }),
    put(key, bytes, type, w, h, at) {
      return serial(async (): Promise<PutResult> => {
        const have = index.get(key);
        if (have) {
          index.set(key, { ...have, seenAt: at });
          await saveIndex();
          return { status: 'exists', w: have.w, h: have.h };
        }
        if (total() + bytes.length > MAX_STORE_BYTES) return { status: 'full' };
        await atomicWrite(path.join(deps.dir, key), bytes);
        index.set(key, { type, size: bytes.length, w, h, addedAt: at, seenAt: at });
        try {
          await saveIndex();
        } catch (err) {
          index.delete(key);
          await unlink(path.join(deps.dir, key)).catch(() => undefined);
          throw err;
        }
        return { status: 'created', w, h };
      });
    },
    sweep(refs, at, allowRemove = true) {
      return serial(async () => {
        const removed: string[] = [];
        let changed = false;
        for (const [k, m] of [...index]) {
          if (refs.has(k)) {
            if (m.seenAt !== at) {
              index.set(k, { ...m, seenAt: at });
              changed = true;
            }
          } else if (allowRemove && at - m.seenAt > GRACE_MS) {
            index.delete(k);
            removed.push(k);
            changed = true;
          }
        }
        if (changed) await saveIndex(); // index first: an entry never points at a file that is gone
        for (const k of removed) await unlink(path.join(deps.dir, k)).catch((err) => log(`[images] cannot remove ${k}: ${(err as Error).message}`));
        return removed;
      });
    },
  };
}
