/** Small filesystem helpers shared by the file-backed stores. */
import { access, stat, constants } from 'node:fs/promises';
import path from 'node:path';

/** Walks up to the nearest existing path: the dir is writable when that is a writable directory. */
export async function canWrite(dir: string): Promise<boolean> {
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
