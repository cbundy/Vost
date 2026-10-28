/**
 * The alerts file: `alerts.json` = `{ version: 1, alerts }` under the data dir.
 * Saves are serialized and atomic (temp file, then rename). A bad file is moved
 * aside, never overwritten.
 */
import { access, mkdir, readFile, rename, stat, writeFile, constants } from 'node:fs/promises';
import path from 'node:path';
import type { Alert } from '../../shared/alerts.ts';

export const FILE_VERSION = 1;
export const LAZY_FLUSH_MS = 60_000;

export interface AlertStore {
  /** Reads the file; a missing file is an empty list, a bad one is moved aside. */
  load(): Promise<Alert[]>;
  /** False when the data dir cannot be written (checked on load). */
  readonly writable: boolean;
  /** Writes now (serialized). Rejects when the dir cannot be written. */
  save(alerts: Alert[]): Promise<void>;
  /** For `lastPrice`-only changes: written at most once a minute, the rest on `flush`. */
  saveLazy(alerts: Alert[]): void;
  /** Writes a held lazy change. */
  flush(): Promise<void>;
}

export interface StoreDeps {
  dir: string;
  now?: () => number;
  log?: (line: string) => void;
}

/** Walks up to the nearest existing path: the dir is writable when that is a writable directory. */
async function canWrite(dir: string): Promise<boolean> {
  let p = path.resolve(dir);
  for (;;) {
    try {
      const st = await stat(p);
      if (!st.isDirectory()) return false;
      await access(p, constants.W_OK);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      const parent = path.dirname(p);
      if (parent === p) return false;
      p = parent;
    }
  }
}

export function createAlertStore(deps: StoreDeps): AlertStore {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const file = path.join(deps.dir, 'alerts.json');
  let writable = true;
  let queue: Promise<void> = Promise.resolve();
  let held: Alert[] | null = null;
  let lastWrite = -Infinity;

  const write = (alerts: Alert[]): Promise<void> => {
    const run = async (): Promise<void> => {
      await mkdir(deps.dir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      await writeFile(tmp, JSON.stringify({ version: FILE_VERSION, alerts }, null, 2));
      await rename(tmp, file);
      lastWrite = now();
      if (held === alerts) held = null;
    };
    const result = queue.then(run);
    queue = result.catch(() => undefined);
    return result;
  };

  return {
    get writable() {
      return writable;
    },
    async load() {
      writable = await canWrite(deps.dir);
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`[alerts] cannot read ${file}: ${(err as Error).message}`);
        return [];
      }
      try {
        const data = JSON.parse(text) as { version?: unknown; alerts?: unknown };
        if (data?.version !== FILE_VERSION || !Array.isArray(data.alerts)) throw new Error('unexpected version or shape');
        return data.alerts as Alert[];
      } catch (err) {
        const name = `alerts.json.bad-${now()}`;
        try {
          await rename(file, path.join(deps.dir, name));
          log(`[alerts] moved bad file to ${name} (${(err as Error).message})`);
        } catch (moveErr) {
          log(`[alerts] bad alerts file could not be moved aside: ${(moveErr as Error).message}`);
          writable = false;
        }
        return [];
      }
    },
    save: write,
    saveLazy(alerts) {
      if (!writable) return;
      held = alerts;
      if (now() - lastWrite >= LAZY_FLUSH_MS) void write(alerts).catch((err) => log(`[alerts] save failed: ${(err as Error).message}`));
    },
    async flush() {
      if (held && writable) await write(held).catch((err) => log(`[alerts] save failed: ${(err as Error).message}`));
      await queue;
    },
  };
}
