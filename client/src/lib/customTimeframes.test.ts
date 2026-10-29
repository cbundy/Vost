import { describe, expect, it } from 'vitest';
import { getProvider } from './providers';
import { MAX_CUSTOM_TIMEFRAMES, pickerTimeframes, sanitizeCustomTimeframes, servable, validateNewInterval } from './customTimeframes';
import type { DataProvider } from './providers/http';

const coinbase = getProvider('coinbase');
const demo = getProvider('demo');
// A provider whose only native timeframes are 1h and 1d: 10m has no divisor to build from.
const coarse = { ...coinbase, name: 'Coarse', timeframes: ['1h', '1d'], builtTimeframes: [] } as unknown as DataProvider;

describe('sanitizeCustomTimeframes', () => {
  it('drops anything that is not a list of canonical valid intervals', () => {
    expect(sanitizeCustomTimeframes('2h')).toEqual([]);
    expect(sanitizeCustomTimeframes(null)).toEqual([]);
    expect(sanitizeCustomTimeframes([5, null, {}, '120m', '0h', '2000m', 'banana', '2h', '2h', '10m'])).toEqual(['2h', '10m']);
  });
  it('keeps at most 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => `${i + 2}m`);
    const out = sanitizeCustomTimeframes(many);
    expect(out).toHaveLength(MAX_CUSTOM_TIMEFRAMES);
    expect(out[19]).toBe('21m');
  });
});

describe('servable', () => {
  it('serves what is native or buildable, and anything valid on the demo', () => {
    expect(servable(coinbase, '1h')).toBe(true);
    expect(servable(coinbase, '2h')).toBe(true);
    expect(servable(coarse, '10m')).toBe(false);
    expect(servable(demo, '10m')).toBe(true);
    expect(servable(demo, '3d')).toBe(true);
  });
  it('refuses invalid and non-canonical spellings everywhere', () => {
    for (const p of [coinbase, demo]) {
      expect(servable(p, '120m')).toBe(false);
      expect(servable(p, 'banana')).toBe(false);
    }
  });
});

describe('pickerTimeframes', () => {
  it('orders custom intervals by bar length and marks built ones with their base', () => {
    const entries = pickerTimeframes(coinbase, ['2h', '10m'], 'native');
    const names = entries.map((e) => e.interval);
    expect(names.indexOf('2h')).toBe(names.indexOf('1h') + 1);
    expect(names.indexOf('10m')).toBe(names.indexOf('5m') + 1);
    expect(entries.find((e) => e.interval === '2h')).toEqual({ interval: '2h', base: '1h', custom: true });
    expect(entries.find((e) => e.interval === '1h')!.base).toBeNull();
  });
  it('hides what the provider cannot serve and skips ones already listed', () => {
    expect(pickerTimeframes(coarse, ['10m', '2h'], 'native').map((e) => e.interval)).toEqual(['1h', '2h', '1d']);
    expect(pickerTimeframes(coinbase, ['1h'], 'native').filter((e) => e.interval === '1h')).toHaveLength(1);
  });
  it('lists every saved interval unmarked on the demo', () => {
    const entries = pickerTimeframes(demo, ['2h', '3d'], 'native');
    expect(entries.map((e) => e.interval)).toEqual(['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '3d', '1w', '1M']);
    expect(entries.every((e) => e.base === null)).toBe(true);
  });
});

describe('validateNewInterval', () => {
  const listed = pickerTimeframes(coinbase, [], 'native').map((e) => e.interval);
  it('returns the canonical form with its base', () => {
    expect(validateNewInterval(90, 'm', coinbase, listed)).toEqual({ interval: '90m', base: '15m' });
    expect(validateNewInterval(120, 'm', coinbase, listed)).toEqual({ interval: '2h', base: '1h' });
  });
  it('refuses out-of-range, non-whole, listed and unbuildable values', () => {
    expect(validateNewInterval(2000, 'm', coinbase, listed)).toEqual({ error: 'Minutes go up to 1440.' });
    expect(validateNewInterval(13, 'M', coinbase, listed)).toEqual({ error: 'Months go up to 12.' });
    expect(validateNewInterval(1.5, 'h', coinbase, listed)).toHaveProperty('error');
    expect(validateNewInterval(NaN, 'h', coinbase, listed)).toHaveProperty('error');
    expect(validateNewInterval(60, 'm', coinbase, listed)).toEqual({ error: '1h is already in the picker.' });
    expect(validateNewInterval(10, 'm', coarse, ['1h', '1d'])).toEqual({ error: 'Coarse cannot build 10m.' });
  });
});
