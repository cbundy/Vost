import { mkdtemp, readdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newAlert } from './model.ts';
import { LAZY_FLUSH_MS, createAlertStore } from './store.ts';

let dir = '';
let clock = 1_000_000;
const logs: string[] = [];
const mk = (d = dir) => createAlertStore({ dir: d, now: () => clock, log: (l) => logs.push(l) });
const alert = (id: string) => newAlert({ provider: 'binance', symbol: 'BTCUSDT', condition: 'crossing', level: 1, note: '' }, id, 1);

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-store-'));
  clock = 1_000_000;
  logs.length = 0;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('alert store', () => {
  it('a missing file is an empty list', async () => {
    expect(await mk().load()).toEqual([]);
  });

  it('round trips and leaves no temp file', async () => {
    const s = mk();
    await s.load();
    await s.save([alert('a'), alert('b')]);
    expect((await mk().load()).map((a) => a.id)).toEqual(['a', 'b']);
    expect(await readdir(dir)).toEqual(['alerts.json']);
    expect(JSON.parse(await readFile(path.join(dir, 'alerts.json'), 'utf8')).version).toBe(1);
  });

  it('creates the dir on first write', async () => {
    const nested = path.join(dir, 'a', 'b');
    const s = mk(nested);
    await s.load();
    expect(s.writable).toBe(true);
    await s.save([alert('a')]);
    expect(await readdir(nested)).toEqual(['alerts.json']);
  });

  it('serializes concurrent saves: the last call wins and the file is whole', async () => {
    const s = mk();
    await s.load();
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.save(Array.from({ length: i + 1 }, (_, j) => alert(`x${j}`)))));
    expect(await readdir(dir)).toEqual(['alerts.json']);
    expect(JSON.parse(await readFile(path.join(dir, 'alerts.json'), 'utf8')).alerts).toHaveLength(20);
  });

  it.each([
    ['bad JSON', '{nope'],
    ['wrong version', JSON.stringify({ version: 2, alerts: [] })],
  ])('moves a file with %s aside and starts empty', async (_n, content) => {
    await writeFile(path.join(dir, 'alerts.json'), content);
    expect(await mk().load()).toEqual([]);
    expect(await readdir(dir)).toEqual([`alerts.json.bad-${clock}`]);
    expect(await readFile(path.join(dir, `alerts.json.bad-${clock}`), 'utf8')).toBe(content);
    expect(logs.join('\n')).toContain('moved bad file to alerts.json.bad-');
  });

  it('a dir under a file is not writable and saving rejects', async () => {
    await writeFile(path.join(dir, 'file'), 'x');
    const s = mk(path.join(dir, 'file', 'data'));
    expect(await s.load()).toEqual([]);
    expect(s.writable).toBe(false);
    await expect(s.save([])).rejects.toThrow();
  });

  it.skipIf(process.getuid?.() === 0)('a read-only dir is not writable', async () => {
    await chmod(dir, 0o500);
    const s = mk();
    await s.load();
    expect(s.writable).toBe(false);
    await chmod(dir, 0o700);
  });

  it('flush writes a held change at once', async () => {
    const s = mk();
    await s.load();
    await s.save([alert('a')]);
    clock += 1000;
    s.saveLazy([alert('a'), alert('b')]);
    await s.flush();
    expect(JSON.parse(await readFile(path.join(dir, 'alerts.json'), 'utf8')).alerts).toHaveLength(2);
  });

  it('flushes lastPrice at most once a minute: a change within a minute of the last write waits for the next call or flush', async () => {
    const s = mk();
    await s.load();
    await s.save([alert('a')]);
    const count = async () => JSON.parse(await readFile(path.join(dir, 'alerts.json'), 'utf8')).alerts.length;
    clock += 10_000;
    s.saveLazy([alert('a'), alert('b')]);
    await new Promise((r) => setTimeout(r, 30));
    expect(await count()).toBe(1);
    clock += LAZY_FLUSH_MS;
    s.saveLazy([alert('a'), alert('b'), alert('c')]);
    await s.flush();
    expect(await count()).toBe(3);
  });
});
