import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoProvider } from '../lib/providers/demo';
import type { DataProvider } from '../lib/providers/http';
import { seedStorageForTest } from '../lib/storage';
import { loadFromCsv, loadFromDataset, loadFromProvider, readLibrary } from './data';

function stubStorage(value: string | null) {
  seedStorageForTest();
  // raw text, so a corrupt value can be seeded
  if (value !== null) (globalThis as { __vostStorageCache?: Map<string, string> }).__vostStorageCache!.set('datasets.v1', value);
}

const candle = (time: number) => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });

describe('loadFromProvider', () => {
  it('loads demo candles', async () => {
    const r = await loadFromProvider(demoProvider, { symbol: demoProvider.defaultSymbol, timeframe: '1h', bars: 120 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.candles.length).toBeGreaterThan(50);
  });
  it('turns a provider error into a message', async () => {
    const bad: DataProvider = { ...demoProvider, fetchHistory: () => Promise.reject(new Error('boom')) };
    const r = await loadFromProvider(bad, { symbol: 'X', timeframe: '1h', bars: 10 });
    expect(r).toEqual({ ok: false, error: 'Could not load candles: boom' });
  });
  it('reports an empty answer', async () => {
    const empty: DataProvider = { ...demoProvider, fetchHistory: async () => [] };
    const r = await loadFromProvider(empty, { symbol: 'X', timeframe: '1h', bars: 10 });
    expect(r.ok).toBe(false);
  });
});

describe('readLibrary', () => {
  it('reads saved datasets', () => {
    const d = { id: 'a', name: 'A', source: 'csv', createdAt: 1, description: '', barSeconds: 60, barLabel: '1m', candles: [candle(1)] };
    stubStorage(JSON.stringify([d, { junk: true }]));
    const lib = readLibrary();
    expect(lib).toHaveLength(1);
    expect(loadFromDataset(lib[0])).toEqual({ ok: true, candles: d.candles, label: 'A' });
  });
  it('gives an empty list for a missing, empty or corrupt key', () => {
    for (const v of [null, '', '{not json', '{"a":1}']) {
      stubStorage(v);
      expect(readLibrary()).toEqual([]);
    }
  });
});

describe('loadFromCsv', () => {
  it('reads candles from CSV text', () => {
    const csv = 'time,open,high,low,close,volume\n' + [0, 1, 2, 3].map((i) => `${1700000000 + i * 3600},1,2,0.5,1.5,10`).join('\n');
    const r = loadFromCsv(csv, 'x.csv');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.candles).toHaveLength(4);
  });
  it('gives a message for text that is not candles', () => {
    const r = loadFromCsv('hello', 'x.csv');
    expect(r.ok).toBe(false);
  });
});
