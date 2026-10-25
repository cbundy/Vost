import { describe, expect, it } from 'vitest';
import { createSymbolCache, SYMBOL_CACHE_MS } from './symbolCache.ts';

const list = [{ symbol: 'A' }];

describe('symbol cache', () => {
  it('loads once for two reads, and again after 24 h', async () => {
    let t = 1000;
    const cache = createSymbolCache(() => t);
    let loads = 0;
    const load = async () => (loads++, list);
    await cache.get('k', load);
    await cache.get('k', load);
    expect(loads).toBe(1);
    t += SYMBOL_CACHE_MS - 1;
    await cache.get('k', load);
    expect(loads).toBe(1);
    t += 1;
    await cache.get('k', load);
    expect(loads).toBe(2);
  });
  it('keeps keys apart', async () => {
    const cache = createSymbolCache();
    let loads = 0;
    const load = async () => (loads++, list);
    await cache.get('a', load);
    await cache.get('b', load);
    expect(loads).toBe(2);
  });
  it('does not cache a failed load', async () => {
    const cache = createSymbolCache();
    let loads = 0;
    const flaky = async () => {
      if (loads++ === 0) throw new Error('boom');
      return list;
    };
    await expect(cache.get('k', flaky)).rejects.toThrow('boom');
    expect(await cache.get('k', flaky)).toBe(list);
    expect(loads).toBe(2);
  });
  it('shares one in-flight load between concurrent misses', async () => {
    const cache = createSymbolCache();
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const load = async () => {
      loads++;
      await gate;
      return list;
    };
    const both = Promise.all([cache.get('k', load), cache.get('k', load)]);
    release();
    const [a, b] = await both;
    expect(loads).toBe(1);
    expect(a).toBe(b);
  });
});
