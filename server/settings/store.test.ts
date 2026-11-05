import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocStore } from './store.ts';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-docs-'));
});
afterEach(async () => {
  await chmod(dir, 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe('createDocStore', () => {
  it('writes then reads back, lists all, and removes', async () => {
    const store = createDocStore({ dir: path.join(dir, 'sub'), log: () => undefined });
    expect(await store.list()).toEqual({});
    expect(await store.get('a')).toBeUndefined();
    await store.put('a', { x: 1 });
    await store.put('b.v2', [1, 2]);
    expect(await store.get('a')).toEqual({ x: 1 });
    expect(await store.list()).toEqual({ a: { x: 1 }, 'b.v2': [1, 2] });
    expect(await store.remove('a')).toBe(true);
    expect(await store.remove('a')).toBe(false);
    expect(await store.list()).toEqual({ 'b.v2': [1, 2] });
  });

  it('keeps valid JSON after many concurrent puts to one name, and leaves no temp files', async () => {
    const store = createDocStore({ dir, log: () => undefined });
    const values = Array.from({ length: 40 }, (_, i) => ({ i, pad: 'x'.repeat(5000) }));
    await Promise.all(values.map((v) => store.put('one', v)));
    expect(values).toContainEqual(await store.get('one'));
    expect(JSON.parse(await readFile(path.join(dir, 'one.json'), 'utf8'))).toEqual(await store.get('one'));
    expect(await readdir(dir)).toEqual(['one.json']);
  });

  it('putIfAbsent never overwrites', async () => {
    const store = createDocStore({ dir, log: () => undefined });
    expect(await store.putIfAbsent('a', 1)).toBe(true);
    expect(await store.putIfAbsent('a', 2)).toBe(false);
    expect(await store.get('a')).toBe(1);
    await store.put('n', null);
    expect(await store.putIfAbsent('n', 3)).toBe(false);
  });

  it('moves a corrupt file aside and reads it as missing', async () => {
    const logs: string[] = [];
    const store = createDocStore({ dir, now: () => 1234, log: (l) => logs.push(l) });
    await writeFile(path.join(dir, 'bad.json'), '{nope');
    expect(await store.get('bad')).toBeUndefined();
    expect((await readdir(dir)).sort()).toEqual(['bad.json.bad-1234']);
    expect(logs.join()).toContain('bad.json.bad-1234');
    await writeFile(path.join(dir, 'bad2.json'), '{nope');
    expect(await store.list()).toEqual({});
  });

  it('refuses bad names and accepts a 128-character one', async () => {
    const store = createDocStore({ dir, log: () => undefined });
    for (const bad of ['../x', 'a/b', '.x', '', '..', 'a'.repeat(129)]) {
      await expect(store.put(bad, 1)).rejects.toThrow();
      await expect(store.remove(bad)).rejects.toThrow();
      expect(() => store.get(bad)).rejects.toThrow();
    }
    await store.put('a'.repeat(128), 1);
    expect(await store.get('a'.repeat(128))).toBe(1);
    expect(await readdir(dir)).toEqual([`${'a'.repeat(128)}.json`]);
  });

  it.skipIf(process.getuid?.() === 0)('reports writable false for a read-only folder', async () => {
    const store = createDocStore({ dir, log: () => undefined });
    expect(await store.writable).toBe(true);
    await chmod(dir, 0o555);
    expect(await store.writable).toBe(false);
  });

  describe('putMany', () => {
    it('writes every document', async () => {
      const store = createDocStore({ dir, log: () => undefined });
      await store.put('a', 1);
      await store.putMany([['a', 2], ['b', 3]]);
      expect(await store.list()).toEqual({ a: 2, b: 3 });
      expect((await readdir(dir)).sort()).toEqual(['a.json', 'b.json']);
    });

    it('writes none when a temp file cannot be written, and leaves no temp behind', async () => {
      let calls = 0;
      const store = createDocStore({
        dir,
        log: () => undefined,
        writeFile: async (file, text) => {
          calls += 1;
          if (calls === 3) throw new Error('disk full');
          await writeFile(file, text);
        },
      });
      await store.put('a', 'old');
      calls = 0;
      await expect(store.putMany([['a', 'new'], ['b', 1], ['c', 2]])).rejects.toThrow('disk full');
      expect(await store.list()).toEqual({ a: 'old' });
      expect(await readdir(dir)).toEqual(['a.json']);
    });

    it('puts back what it replaced when a rename fails', async () => {
      const store = createDocStore({ dir, log: () => undefined });
      await store.put('a', 'old');
      // A non-empty folder where the third file belongs: its rename fails after two succeeded.
      await mkdir(path.join(dir, 'c.json'));
      await writeFile(path.join(dir, 'c.json', 'x'), '');
      await expect(store.putMany([['a', 'new'], ['b', 1], ['c', 2]])).rejects.toThrow();
      expect(await readFile(path.join(dir, 'a.json'), 'utf8')).toBe('"old"');
      expect((await readdir(dir)).sort()).toEqual(['a.json', 'c.json']);
    });

    it('refuses a bad name or a non-JSON value before writing anything', async () => {
      const store = createDocStore({ dir, log: () => undefined });
      await expect(store.putMany([['a', 1], ['bad/name', 2]])).rejects.toThrow('Invalid document name');
      await expect(store.putMany([['a', 1], ['b', undefined]])).rejects.toThrow('not JSON');
      expect(await readdir(dir)).toEqual([]);
    });
  });
});
