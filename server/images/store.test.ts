import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createImageStore, GRACE_MS, MAX_STORE_BYTES } from './store.ts';

let dir = '';
let logs: string[] = [];
const K1 = 'a'.repeat(64);
const K2 = 'b'.repeat(64);
const open = () => createImageStore({ dir, log: (l) => logs.push(l), now: () => 5 });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-images-store-'));
  logs = [];
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('image store', () => {
  it('starts empty on a folder that does not exist yet', async () => {
    const s = await createImageStore({ dir: path.join(dir, 'nope'), log: () => undefined });
    expect(s.stats()).toEqual({ count: 0, bytes: 0 });
  });

  it('keeps its index across a reopen', async () => {
    const s = await open();
    expect(await s.put(K1, Buffer.from('abc'), 'image/png', 3, 4, 100)).toEqual({ status: 'created', w: 3, h: 4 });
    const again = await open();
    expect(again.meta(K1)).toEqual({ type: 'image/png', size: 3, w: 3, h: 4, addedAt: 100, seenAt: 100 });
    expect((await again.read(K1))!.toString()).toBe('abc');
    expect(again.stats()).toEqual({ count: 1, bytes: 3 });
  });

  it('drops an index entry without a file and removes a stray file and a temp file', async () => {
    const s = await open();
    await s.put(K1, Buffer.from('abc'), 'image/png', 1, 1, 1);
    await s.put(K2, Buffer.from('def'), 'image/png', 1, 1, 1);
    await rm(path.join(dir, K1));
    await writeFile(path.join(dir, 'c'.repeat(64)), 'stray');
    await writeFile(path.join(dir, `${K2}.tmp-1-1`), 'temp');
    await writeFile(path.join(dir, 'notes.txt'), 'not ours');
    const again = await open();
    expect(again.meta(K1)).toBeUndefined();
    expect(again.meta(K2)).toBeDefined();
    expect((await readdir(dir)).sort()).toEqual(['index.json', K2, 'notes.txt'].sort());
    expect(JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'))).not.toHaveProperty(K1);
  });

  it('renames a corrupt index aside, starts empty and logs it, leaving the picture files alone', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.json'), '{nope');
    await writeFile(path.join(dir, K1), 'bytes');
    const s = await open();
    expect(s.stats().count).toBe(0);
    expect(await readdir(dir)).toContain('index.json.bad-5');
    expect(logs.join('\n')).toMatch(/index\.json is unreadable/);
    expect(await readdir(dir)).toContain(K1);
  });

  it('stores concurrent puts of one key once', async () => {
    const s = await open();
    const results = await Promise.all([1, 2, 3].map(() => s.put(K1, Buffer.from('abc'), 'image/png', 1, 1, 1)));
    expect(results.map((r) => r.status).sort()).toEqual(['created', 'exists', 'exists']);
    expect(s.stats().count).toBe(1);
  });

  it('refuses a picture that would pass 50 MB', async () => {
    const s = await open();
    for (let i = 0; i < 10; i++) await s.put(i.toString(16).repeat(64).slice(0, 64), Buffer.alloc(5 * 1024 * 1024), 'image/png', 1, 1, 1);
    expect(s.stats().bytes).toBe(MAX_STORE_BYTES);
    expect(await s.put(K1, Buffer.from('x'), 'image/png', 1, 1, 1)).toEqual({ status: 'full' });
  });

  it('sweeps by reference and grace, and removes nothing when told not to', async () => {
    const s = await open();
    await s.put(K1, Buffer.from('abc'), 'image/png', 1, 1, 0);
    await s.put(K2, Buffer.from('def'), 'image/png', 1, 1, 0);
    expect(await s.sweep(new Set([K1]), GRACE_MS + 1, false)).toEqual([]);
    expect(s.meta(K1)!.seenAt).toBe(GRACE_MS + 1);
    expect(await s.sweep(new Set([K1]), GRACE_MS)).toEqual([]); // K2 is exactly at the grace
    expect(await s.sweep(new Set([K1]), GRACE_MS + 1)).toEqual([K2]);
    expect(await readdir(dir)).not.toContain(K2);
    expect(s.meta(K2)).toBeUndefined();
  });
});
