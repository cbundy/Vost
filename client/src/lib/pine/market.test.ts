import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { createMarketProvider, estimateMintick, marketIdentity, pineTimeframe, pineTimeframeOfSeconds, toKlines } from './market';

const bar = (time: number, p = 100): Candle => ({ time, open: p, high: p + 1, low: p - 1, close: p, volume: 1 });

describe('pineTimeframe', () => {
  it.each([
    ['1m', '1'], ['15m', '15'], ['1h', '60'], ['2h', '120'], ['4h', '240'], ['1d', 'D'], ['3d', '3D'],
    ['1w', 'W'], ['2w', '2W'], ['1M', 'M'], ['3M', '3M'],
  ])('%s -> %s', (iv, tf) => expect(pineTimeframe(iv)).toBe(tf));
  it('rejects a bad interval', () => expect(pineTimeframe('7x')).toBeNull());
  it('maps a dataset bar length', () => {
    expect(pineTimeframeOfSeconds(900)).toBe('15');
    expect(pineTimeframeOfSeconds(7200)).toBe('120');
    expect(pineTimeframeOfSeconds(86400)).toBe('D');
    expect(pineTimeframeOfSeconds(3 * 86400)).toBe('3D');
    expect(pineTimeframeOfSeconds(604800)).toBe('W');
  });
});

describe('estimateMintick', () => {
  const at = (p: number) => [bar(0, p)];
  it('uses the largest decimal count', () => {
    expect(estimateMintick([{ time: 0, open: 100.5, high: 101.25, low: 99, close: 100, volume: 1 }])).toBe(0.01);
    expect(estimateMintick([{ time: 0, open: 1.23456, high: 1.25, low: 1.2, close: 1.23, volume: 1 }])).toBe(0.00001);
    expect(estimateMintick(at(100))).toBe(1);
  });
});

describe('marketIdentity', () => {
  it('names crypto, stock and dataset markets', () => {
    expect(marketIdentity({ providerId: 'binance', symbol: 'BTCUSDT' })).toMatchObject({ prefix: 'BINANCE', tickerid: 'BINANCE:BTCUSDT', type: 'crypto' });
    expect(marketIdentity({ providerId: 'yahoo', symbol: 'AAPL' }).type).toBe('stock');
    expect(marketIdentity({ providerId: 'csv', symbol: 'x', dataset: true }).type).toBe('');
    expect(marketIdentity(undefined).ticker).toBe('VOST');
  });
});

describe('toKlines', () => {
  it('closes at open plus interval, capped at the next open', () => {
    const c = [bar(0), bar(3600), bar(3600 * 5)];
    const k = toKlines(c, { providerId: 'binance', symbol: 'X', interval: '1h' }, '60');
    expect(k.map((x) => x.closeTime)).toEqual([3600 * 1000 - 1, 3600 * 1000 - 1 + 3600 * 1000, 3600 * 6 * 1000 - 1]);
    const k2 = toKlines([bar(0), bar(1800)], { providerId: 'binance', symbol: 'X', interval: '1h' }, '60');
    expect(k2[0].closeTime).toBe(1800 * 1000 - 1);
  });
  it('uses the calendar month', () => {
    const jan = Date.UTC(2024, 0, 1) / 1000;
    const k = toKlines([bar(jan)], { providerId: 'binance', symbol: 'X', interval: '1M' }, 'M');
    expect(k[0].closeTime).toBe(Date.UTC(2024, 1, 1) - 1);
  });
});

describe('createMarketProvider', () => {
  const candles = [bar(0), bar(3600)];
  const { provider } = createMarketProvider(candles, { providerId: 'binance', symbol: 'BTCUSDT', interval: '1h' });
  it('serves its own symbol and timeframe', async () => {
    expect(await provider.getMarketData('BTCUSDT', '60')).toHaveLength(2);
    expect(await provider.getMarketData('BINANCE:BTCUSDT', '60')).toHaveLength(2);
  });
  it('throws a named error for another symbol or timeframe', async () => {
    await expect(provider.getMarketData('ETHUSDT', '60')).rejects.toThrow('request.security(ETHUSDT, 60) needs data Vost does not load yet');
    await expect(provider.getMarketData('BTCUSDT', 'D')).rejects.toThrow('request.security(BTCUSDT, D) needs data Vost does not load yet');
  });
  it('reports symbol info', async () => {
    const info = await provider.getSymbolInfo('BTCUSDT');
    expect(info).toMatchObject({ ticker: 'BTCUSDT', tickerid: 'BINANCE:BTCUSDT', prefix: 'BINANCE', type: 'crypto', timezone: 'UTC', mintick: 1, pricescale: 1, minmove: 1 });
  });
});
