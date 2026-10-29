import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG, catalogEntry } from './providerCatalog.ts';
import { TIMEFRAME_SECONDS, type Candle, type Timeframe } from './market.ts';
import { UTC_CALENDAR, baseTimeframe, bucketStart, buildBars, builtTimeframes, type Calendar } from './timeframes.ts';

const ts = (iso: string): number => Date.parse(iso) / 1000;
const bar = (time: number, o: number, h: number, l: number, c: number, v = 1): Candle => ({ time, open: o, high: h, low: l, close: c, volume: v });
const native = (id: string): Timeframe[] => catalogEntry(id)!.timeframes;

describe('baseTimeframe', () => {
  it.each([
    ['coinbase', '30m', '15m'],
    ['coinbase', '4h', '1h'],
    ['coinbase', '1w', '1d'],
    ['coinbase', '1M', '1d'],
    ['kraken', '1M', '1d'],
    ['yahoo', '4h', '1h'],
  ] as const)('%s %s is built from %s', (id, target, base) => {
    expect(baseTimeframe(native(id), target)).toBe(base);
  });

  it('is null for a native timeframe and when nothing lower exists (Stooq)', () => {
    expect(baseTimeframe(native('binance'), '4h')).toBeNull();
    for (const tf of ['1m', '5m', '15m', '30m', '1h', '4h'] as const) expect(baseTimeframe(native('stooq'), tf)).toBeNull();
  });

  it('never builds a month from weeks, and needs the target to be a whole multiple of the base', () => {
    expect(baseTimeframe(['1w'], '1M')).toBeNull();
    expect(baseTimeframe(['1m', '1w'], '1M')).toBe('1m');
    expect(baseTimeframe(['1h'], '30m')).toBeNull();
    expect(baseTimeframe(['15m', '1h'], '4h')).toBe('1h');
    expect(baseTimeframe(['1d'], '4h')).toBeNull();
  });

  it('derives builtTimeframes in the catalog, in TIMEFRAMES order, leaving timeframes native', () => {
    expect(catalogEntry('coinbase')!.builtTimeframes).toEqual(['30m', '4h', '1w', '1M']);
    expect(catalogEntry('kraken')!.builtTimeframes).toEqual(['1M']);
    expect(catalogEntry('yahoo')!.builtTimeframes).toEqual(['4h']);
    expect(catalogEntry('stooq')!.builtTimeframes).toEqual([]);
    expect(catalogEntry('coinbase')!.timeframes).toEqual(['1m', '5m', '15m', '1h', '1d']);
    for (const p of PROVIDER_CATALOG) expect(p.builtTimeframes).toEqual(builtTimeframes(p.timeframes));
  });
});

describe('UTC buckets', () => {
  it('floors intraday and daily bars to the multiple of their length', () => {
    expect(bucketStart(ts('2024-03-05T07:59:59Z'), '4h')).toBe(ts('2024-03-05T04:00:00Z'));
    expect(bucketStart(ts('2024-03-05T08:00:00Z'), '4h')).toBe(ts('2024-03-05T08:00:00Z'));
    expect(bucketStart(ts('2024-03-05T10:17:00Z'), '30m')).toBe(ts('2024-03-05T10:00:00Z'));
    expect(bucketStart(ts('2024-03-05T23:59:00Z'), '1d')).toBe(ts('2024-03-05T00:00:00Z'));
  });

  it('starts weeks on Monday 00:00 UTC, across a month end', () => {
    // 2024-03-31 is a Sunday; 2024-04-01 a Monday.
    expect(bucketStart(ts('2024-03-31T23:00:00Z'), '1w')).toBe(ts('2024-03-25T00:00:00Z'));
    expect(bucketStart(ts('2024-04-01T00:00:00Z'), '1w')).toBe(ts('2024-04-01T00:00:00Z'));
    expect(bucketStart(ts('2024-03-26T12:00:00Z'), '1w')).toBe(ts('2024-03-25T00:00:00Z'));
    expect(bucketStart(ts('2024-03-01T00:00:00Z'), '1w')).toBe(ts('2024-02-26T00:00:00Z'));
    expect(bucketStart(ts('1970-01-01T00:00:00Z'), '1w')).toBe(ts('1969-12-29T00:00:00Z'));
  });

  it.each([
    ['2023-02-28T23:59:59Z', '2023-02-01T00:00:00Z'],
    ['2024-02-29T12:00:00Z', '2024-02-01T00:00:00Z'],
    ['2024-04-30T23:00:00Z', '2024-04-01T00:00:00Z'],
    ['2024-05-31T23:00:00Z', '2024-05-01T00:00:00Z'],
    ['2024-06-01T00:00:00Z', '2024-06-01T00:00:00Z'],
  ])('puts %s in the calendar month starting %s (28, 29, 30 and 31 day months)', (t, start) => {
    expect(bucketStart(ts(t), '1M')).toBe(ts(start));
  });

  it('builds a month of 28 days from daily bars', () => {
    const days: Candle[] = [];
    for (let d = 0; d < 28 + 31; d++) days.push(bar(ts('2023-02-01T00:00:00Z') + d * 86400, d, d + 1, d - 1, d + 0.5, 2));
    const months = buildBars(days, '1M');
    expect(months.map((m) => m.time)).toEqual([ts('2023-02-01T00:00:00Z'), ts('2023-03-01T00:00:00Z')]);
    expect(months[0]).toEqual({ time: ts('2023-02-01T00:00:00Z'), open: 0, high: 28, low: -1, close: 27.5, volume: 56 });
  });
});

describe('buildBars', () => {
  it('takes open of the first, close of the last, max high, min low and summed volume', () => {
    const t0 = ts('2024-03-05T04:00:00Z');
    const out = buildBars(
      [bar(t0, 10, 12, 9, 11, 1), bar(t0 + 3600, 11, 15, 10, 14, 2), bar(t0 + 7200, 14, 14, 8, 9, 3), bar(t0 + 10800, 9, 10, 9, 10, 4), bar(t0 + 14400, 10, 11, 10, 11, 5)],
      '4h',
    );
    expect(out).toEqual([bar(t0, 10, 15, 8, 10, 10), bar(t0 + 14400, 10, 11, 10, 11, 5)]);
  });

  it('aggregates what is present when a bucket has a gap', () => {
    const t0 = ts('2024-03-05T04:00:00Z');
    const out = buildBars([bar(t0, 1, 2, 1, 2), bar(t0 + 10800, 2, 3, 2, 3)], '4h');
    expect(out).toEqual([bar(t0, 1, 3, 1, 3, 2)]);
  });

  it('does not change its input', () => {
    const input = [bar(0, 1, 2, 1, 2), bar(3600, 2, 5, 0, 3)];
    buildBars(input, '4h');
    expect(input[0]).toEqual(bar(0, 1, 2, 1, 2));
  });
});

describe('session buckets (Yahoo, New York)', () => {
  const ny: Calendar = { kind: 'session', timeZone: 'America/New_York', openSeconds: 9.5 * 3600 };
  // hourly bars of a regular session starting at 9:30 local, given the UTC time of the open
  const session = (openIso: string): Candle[] => Array.from({ length: 7 }, (_, i) => bar(ts(openIso) + i * 3600, i, i + 1, i - 1, i + 0.5));

  it.each([
    ['winter (EST)', '2024-03-04T14:30:00Z'],
    ['summer (EDT)', '2024-03-12T13:30:00Z'],
  ])('splits a %s day 9:30-13:30 and 13:30-16:00', (_name, open) => {
    const out = buildBars(session(open), '4h', ny);
    expect(out.map((b) => b.time)).toEqual([ts(open), ts(open) + 4 * 3600]);
    expect(out[0]).toMatchObject({ open: 0, high: 4, low: -1, close: 3.5 });
    expect(out[1]).toMatchObject({ open: 4, high: 7, low: 3, close: 6.5 });
  });

  it('holds across the DST change (2024-03-10) and keeps each day anchored to its own open', () => {
    const before = session('2024-03-08T14:30:00Z'); // Friday, EST
    const after = session('2024-03-11T13:30:00Z'); // Monday, EDT
    const out = buildBars([...before, ...after], '4h', ny);
    expect(out.map((b) => b.time)).toEqual([
      ts('2024-03-08T14:30:00Z'),
      ts('2024-03-08T18:30:00Z'),
      ts('2024-03-11T13:30:00Z'),
      ts('2024-03-11T17:30:00Z'),
    ]);
  });

  it('uses the exchange-local date for days, Monday weeks and months, stamped at the session open', () => {
    expect(bucketStart(ts('2024-03-08T20:00:00Z'), '1d', ny)).toBe(ts('2024-03-08T14:30:00Z'));
    // Wed 2024-03-13 is in the week of Monday 2024-03-11 (EDT, after the DST change)
    expect(bucketStart(ts('2024-03-13T15:00:00Z'), '1w', ny)).toBe(ts('2024-03-11T13:30:00Z'));
    // Sunday 2024-03-10 -> Monday 2024-03-04 (EST)
    expect(bucketStart(ts('2024-03-08T15:00:00Z'), '1w', ny)).toBe(ts('2024-03-04T14:30:00Z'));
    expect(bucketStart(ts('2024-03-28T15:00:00Z'), '1M', ny)).toBe(ts('2024-03-01T14:30:00Z'));
    // 02:00 UTC on 1 April is still 31 March in New York
    expect(bucketStart(ts('2024-04-01T02:00:00Z'), '1M', ny)).toBe(ts('2024-03-01T14:30:00Z'));
  });

  it('differs from UTC buckets', () => {
    expect(bucketStart(ts('2024-03-12T14:00:00Z'), '4h', UTC_CALENDAR)).toBe(ts('2024-03-12T12:00:00Z'));
    expect(bucketStart(ts('2024-03-12T14:00:00Z'), '4h', ny)).toBe(ts('2024-03-12T13:30:00Z'));
  });
});

describe('parity with native bars', () => {
  // A deterministic hourly walk; its 4h, 1d, 1w and 1M "native" series are made by an independent, naive loop.
  const start = ts('2024-01-01T00:00:00Z');
  const hours = 24 * 75;
  const hourly: Candle[] = [];
  let price = 100;
  for (let i = 0; i < hours; i++) {
    const open = price;
    price += Math.sin(i / 7) * 2 + (i % 5) - 2;
    hourly.push(bar(start + i * 3600, open, Math.max(open, price) + (i % 3), Math.min(open, price) - (i % 4), price, 1 + (i % 6)));
  }
  const naive = (candles: Candle[], keyOf: (t: number) => number): Candle[] => {
    const keys = [...new Set(candles.map((c) => keyOf(c.time)))];
    return keys.map((key) => {
      const group = candles.filter((c) => keyOf(c.time) === key);
      return {
        time: key,
        open: group[0].open,
        high: Math.max(...group.map((c) => c.high)),
        low: Math.min(...group.map((c) => c.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((a, c) => a + c.volume, 0),
      };
    });
  };
  const monthKey = (t: number) => Date.UTC(new Date(t * 1000).getUTCFullYear(), new Date(t * 1000).getUTCMonth(), 1) / 1000;

  it('4h from 1h equals the independently grouped series', () => {
    expect(buildBars(hourly, '4h')).toEqual(naive(hourly, (t) => Math.floor(t / 14400) * 14400));
  });
  it('1d from 1h, and 1w and 1M from 1d, equal the independently grouped series', () => {
    const daily = buildBars(hourly, '1d');
    expect(daily).toEqual(naive(hourly, (t) => Math.floor(t / 86400) * 86400));
    // 2024-01-01 is a Monday: weeks are 7-day groups counted from it
    expect(buildBars(daily, '1w')).toEqual(naive(daily, (t) => start + Math.floor((t - start) / 604800) * 604800));
    expect(buildBars(daily, '1M')).toEqual(naive(daily, monthKey));
  });
});

describe('parity with real Binance bars', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/binance-btcusdt.json', import.meta.url), 'utf8')) as Record<'hourly' | 'h4' | 'daily' | 'weekly' | 'monthly', number[][]>;
  const candles = (rows: number[][]): Candle[] => rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));

  /** Built bars that cover whole buckets of the base data must equal the exchange's bars exactly. */
  function expectParity(baseRows: number[][], nativeRows: number[][], target: Timeframe): void {
    const base = candles(baseRows);
    const lastBase = base[base.length - 1].time;
    const lastNative = nativeRows[nativeRows.length - 1][0];
    // Only the oldest and newest buckets can be partial.
    const built = buildBars(base, target).slice(1).filter((b) => b.time < lastNative || bucketEnd(b.time, target) <= lastBase + 1);
    expect(built.length).toBeGreaterThan(3);
    const nativeByTime = new Map(candles(nativeRows).map((c) => [c.time, c]));
    for (const b of built) {
      const n = nativeByTime.get(b.time)!;
      const at = new Date(b.time * 1000).toISOString();
      // Prices are exact; the volume is a float sum, equal up to rounding.
      expect({ ...b, volume: 0 }, at).toEqual({ ...n, volume: 0 });
      expect(Math.abs(b.volume - n.volume) / n.volume, at).toBeLessThan(1e-12);
    }
  }
  const bucketEnd = (start: number, target: Timeframe): number =>
    target === '1w' ? start + 7 * 86400 : target === '1M' ? Date.UTC(new Date(start * 1000).getUTCFullYear(), new Date(start * 1000).getUTCMonth() + 1, 1) / 1000 : start + TIMEFRAME_SECONDS[target];

  it('1h built into 4h equals Binance 4h', () => expectParity(fx.hourly, fx.h4, '4h'));
  it('1d built into 1w equals Binance 1w', () => expectParity(fx.daily, fx.weekly, '1w'));
  it('1d built into 1M equals Binance 1M', () => expectParity(fx.daily, fx.monthly, '1M'));
});
