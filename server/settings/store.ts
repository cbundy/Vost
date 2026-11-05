/**
 * A folder of named JSON documents: `<dir>/<name>.json`, one file per name.
 * Generic: the settings API opens one, other features can open their own.
 * Writes are serialized and atomic (temp file, then rename). A file that is not
 * valid JSON is moved aside as `<name>.json.bad-<ms>` and reads as missing.
 */
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canWrite } from '../fsutil.ts';

export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const isValidName = (name: string): boolean => NAME_PATTERN.test(name);

export interface DocStore {
  /** Every document, by name. */
  list(): Promise<Record<string, unknown>>;
  /** The document, or undefined when absent. */
  get(name: string): Promise<unknown>;
  /** Stores a document (creating the folder on first write). Rejects on a bad name or a write error. */
  put(name: string, value: unknown): Promise<void>;
  /** Stores a document only when none exists, atomically with other writes; false when one does. */
  putIfAbsent(name: string, value: unknown): Promise<boolean>;
  /**
   * Stores several documents all or none: every temp file is written first and the renames start only
   * when all of them succeeded; a failure removes the temps and puts back any file already replaced.
   */
  putMany(entries: Array<[name: string, value: unknown]>): Promise<void>;
  /** Removes a document; false when there was none. */
  remove(name: string): Promise<boolean>;
  /** Whether the folder can be written (checked now). */
  readonly writable: Promise<boolean>;
}

export interface DocStoreDeps {
  dir: string;
  now?: () => number;
  log?: (line: string) => void;
  /** Test seam: writes a temp file (default `fs.writeFile`). */
  writeFile?: (file: string, text: string) => Promise<void>;
}

export function createDocStore(deps: DocStoreDeps): DocStore {
  const now = deps.now ?? Date.now;
  const writeText = deps.writeFile ?? ((file: string, text: string) => writeFile(file, text));
  const log = deps.log ?? ((line: string) => console.log(line));
  let queue: Promise<unknown> = Promise.resolve();
  let seq = 0;

  const fileOf = (name: string): string => {
    if (!isValidName(name)) throw new Error(`Invalid document name: ${JSON.stringify(name)}`);
    return path.join(deps.dir, `${name}.json`);
  };
  /** Runs `task` after every earlier write has settled. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };

  async function read(name: string): Promise<{ found: boolean; value?: unknown }> {
    const file = fileOf(name);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`[docs] cannot read ${file}: ${(err as Error).message}`);
      return { found: false };
    }
    try {
      return { found: true, value: JSON.parse(text) };
    } catch (err) {
      const aside = `${name}.json.bad-${now()}`;
      try {
        await rename(file, path.join(deps.dir, aside));
        log(`[docs] moved bad file to ${aside} (${(err as Error).message})`);
      } catch (moveErr) {
        log(`[docs] bad file ${file} could not be moved aside: ${(moveErr as Error).message}`);
      }
      return { found: false };
    }
  }

  async function write(name: string, value: unknown): Promise<void> {
    const file = fileOf(name);
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error('Value is not JSON');
    await mkdir(deps.dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${seq++}`;
    try {
      await writeText(tmp, text);
      await rename(tmp, file);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  async function writeAll(entries: Array<[string, unknown]>): Promise<void> {
    const items = entries.map(([name, value]) => {
      const file = fileOf(name);
      const text = JSON.stringify(value);
      if (text === undefined) throw new Error('Value is not JSON');
      return { file, text, tmp: `${file}.tmp-${process.pid}-${seq++}` };
    });
    if (items.length === 0) return;
    await mkdir(deps.dir, { recursive: true });
    const dropTemps = () => Promise.all(items.map((i) => unlink(i.tmp).catch(() => undefined)));
    try {
      for (const i of items) await writeText(i.tmp, i.text);
    } catch (err) {
      await dropTemps();
      throw err;
    }
    // What each file holds now, to put back if a later rename fails.
    const before = await Promise.all(items.map((i) => readFile(i.file, 'utf8').catch(() => null)));
    let renamed = 0;
    try {
      for (const i of items) {
        await rename(i.tmp, i.file);
        renamed += 1;
      }
    } catch (err) {
      await dropTemps();
      for (let k = 0; k < renamed; k += 1) {
        const old = before[k];
        if (old === null) await unlink(items[k].file).catch(() => undefined);
        else await writeFile(items[k].file, old).catch(() => undefined);
      }
      throw err;
    }
  }

  return {
    get writable() {
      return canWrite(deps.dir);
    },
    async list() {
      let files: string[];
      try {
        files = await readdir(deps.dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`[docs] cannot list ${deps.dir}: ${(err as Error).message}`);
        return {};
      }
      const out: Record<string, unknown> = {};
      for (const f of files.sort()) {
        if (!f.endsWith('.json')) continue;
        const name = f.slice(0, -'.json'.length);
        if (!isValidName(name)) continue;
        const doc = await read(name);
        if (doc.found) out[name] = doc.value;
      }
      return out;
    },
    async get(name) {
      return (await read(name)).value;
    },
    async put(name, value) {
      fileOf(name);
      return serial(() => write(name, value));
    },
    async putMany(entries) {
      for (const [name] of entries) fileOf(name);
      return serial(() => writeAll(entries));
    },
    async putIfAbsent(name, value) {
      fileOf(name);
      return serial(async () => {
        if ((await read(name)).found) return false;
        await write(name, value);
        return true;
      });
    },
    async remove(name) {
      const file = fileOf(name);
      return serial(async () => {
        try {
          await unlink(file);
          return true;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw err;
        }
      });
    },
  };
}
