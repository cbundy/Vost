import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Candle } from '../../shared/market.ts';
import { openCandleStore, type Series } from './store.ts';

const S: Series = { provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h' };
const H = 3600;
const NOW = 1_000_000 * H; // seconds; the last closed 1h bar is NOW - H
const candle = (time: number, close = 1): Candle => ({ time, open: 1, high: 2, low: 0.5, close, volume: 3 });
const bars = (from: number, n: number): Candle[] => Array.from({ length: n }, (_, i) => candle(from + i * H));

let dir: string;
const logs: string[] = [];
const open = () => openCandleStore({ dir, now: () => NOW * 1000, log: (l) => logs.push(l) });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-candles-'));
  logs.length = 0;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('candle store', () => {
  it('upsert twice is idempotent and a later write replaces OHLCV', async () => {
    const store = await open();
    expect(store.on).toBe(true);
    store.upsert(S, bars(0, 3), 0, 2 * H);
    store.upsert(S, bars(0, 3), 0, 2 * H);
    expect(store.stats()).toMatchObject({ on: true, series: 1, rows: 3 });
    store.upsert(S, [candle(H, 9)]);
    expect(store.range(S, 0, 2 * H).map((c) => c.close)).toEqual([1, 9, 1]);
    store.close();
  });

  it('range is ascending and inclusive; lastN returns the newest ascending', async () => {
    const store = await open();
    store.upsert(S, [candle(2 * H), candle(0), candle(H), candle(3 * H)]);
    expect(store.range(S, H, 2 * H).map((c) => c.time)).toEqual([H, 2 * H]);
    expect(store.lastN(S, 2 * H, 2).map((c) => c.time)).toEqual([H, 2 * H]);
    expect(store.range({ ...S, symbol: 'ETHUSDT' }, 0, 9 * H)).toEqual([]);
    store.close();
  });

  it('merges adjacent and overlapping coverage, keeps a hole apart', async () => {
    const store = await open();
    store.upsert(S, [], 0, 10 * H);
    store.upsert(S, [], 20 * H, 30 * H);
    expect(store.covered(S, 0, 30 * H)).toEqual([{ from: 10 * H + 1, to: 20 * H - 1 }]);
    store.upsert(S, [], 10 * H + 1, 20 * H - 1); // adjacent on both sides: one interval
    expect(store.covered(S, 0, 30 * H)).toEqual([]);
    store.upsert(S, [], 5 * H, 15 * H); // overlapping
    expect(store.covered(S, 0, 30 * H)).toEqual([]);
    expect(store.covered(S, 0, 40 * H)).toEqual([{ from: 30 * H + 1, to: 40 * H }]);
    expect(store.covered({ ...S, timeframe: '5m' }, 0, 5)).toEqual([{ from: 0, to: 5 }]);
    store.close();
  });

  it('never covers the forming bar', async () => {
    const store = await open();
    store.upsert(S, [candle(NOW - H), candle(NOW)], NOW - 5 * H, NOW + 10 * H);
    expect(store.covered(S, NOW - 5 * H, NOW)).toEqual([{ from: NOW - H + 1, to: NOW }]);
    expect(store.range(S, 0, NOW + H).map((c) => c.time)).toEqual([NOW - H]); // the forming bar is not stored
    store.close();
  });

  it('prune removes rows and trims coverage, for one series or all', async () => {
    const store = await open();
    const other = { ...S, symbol: 'ETHUSDT' };
    store.upsert(S, bars(0, 10), 0, 9 * H);
    store.upsert(other, bars(0, 10), 0, 9 * H);
    store.prune(S, 5 * H);
    expect(store.range(S, 0, 20 * H).map((c) => c.time)).toEqual(bars(5 * H, 5).map((c) => c.time));
    expect(store.covered(S, 5 * H, 9 * H)).toEqual([]);
    expect(store.covered(S, 0, 5 * H)).toEqual([{ from: 0, to: 5 * H - 1 }]);
    expect(store.range(other, 0, 20 * H)).toHaveLength(10);
    store.prune('all', 8 * H);
    expect(store.stats().rows).toBe(4);
    store.close();
  });

  it('keeps data across a reopen', async () => {
    const a = await open();
    a.upsert(S, bars(0, 3), 0, 2 * H);
    a.close();
    const b = await open();
    expect(b.range(S, 0, 2 * H)).toHaveLength(3);
    expect(b.covered(S, 0, 2 * H)).toEqual([]);
    b.close();
  });

  it('moves a file of another schema version aside and starts fresh', async () => {
    const file = path.join(dir, 'candles.sqlite');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE old (x); PRAGMA user_version = 99');
    db.close();
    const store = await open();
    expect(store.on).toBe(true);
    expect(store.stats().rows).toBe(0);
    expect((await readdir(dir)).some((n) => n.startsWith('candles.sqlite.bad-'))).toBe(true);
    expect(logs.join('\n')).toMatch(/\[candles\] moved bad file/);
    store.close();
  });

  it('moves a file of garbage aside and starts fresh', async () => {
    await writeFile(path.join(dir, 'candles.sqlite'), Buffer.from('this is not a database '.repeat(100)));
    const store = await open();
    expect(store.on).toBe(true);
    store.upsert(S, [candle(0)]);
    expect(store.range(S, 0, 0)).toHaveLength(1);
    expect((await readdir(dir)).some((n) => n.startsWith('candles.sqlite.bad-'))).toBe(true);
    store.close();
  });

  it('is off and a safe no-op when the dir cannot be written', async () => {
    await writeFile(path.join(dir, 'file'), 'x');
    const store = await openCandleStore({ dir: path.join(dir, 'file', 'data'), log: (l) => logs.push(l) });
    expect(store.on).toBe(false);
    expect(logs.filter((l) => l.startsWith('[candles]'))).toHaveLength(1);
    store.upsert(S, [candle(0)], 0, 0);
    expect(store.range(S, 0, H)).toEqual([]);
    expect(store.lastN(S, H, 5)).toEqual([]);
    expect(store.covered(S, 0, H)).toEqual([{ from: 0, to: H }]);
    store.prune('all', H);
    expect(store.stats()).toEqual({ on: false, series: 0, rows: 0, bytes: 0 });
    store.close();
  });
});
