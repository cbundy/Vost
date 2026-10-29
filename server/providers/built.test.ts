import { describe, expect, it } from 'vitest';
import { MAX_BARS, type Candle } from '../../shared/market.ts';
import { builtHistory, MAX_BUILT_BASE_BARS } from './built.ts';
import { NotFoundError } from './errors.ts';
import type { HistoryRequest } from './types.ts';
import { ctxFor, fakeFetch } from './testing.ts';
import { sessionCalendar, yahooAdapter } from './yahoo.ts';

const bar = (time: number): Candle => ({ time, open: 1, high: 2, low: 0, close: 1, volume: 1 });
const DAY = 86400;

describe('builtHistory', () => {
  it('asks for base chunks of at most MAX_BARS, newest first, each ending before the last began, and stops at the cap', async () => {
    const asked: HistoryRequest[] = [];
    const fetchBase = async (req: HistoryRequest): Promise<Candle[]> => {
      asked.push(req);
      const newest = req.to ?? 1_700_000_000;
      return Array.from({ length: req.bars }, (_, i) => bar(newest - (req.bars - 1 - i) * DAY));
    };
    const out = await builtHistory({ fetchBase }, ['1d'], { symbol: 'X', timeframe: '1M', bars: 20000 });
    expect(asked.length).toBe(Math.ceil(MAX_BUILT_BASE_BARS / MAX_BARS));
    expect(asked.every((r) => r.timeframe === '1d' && r.bars <= MAX_BARS)).toBe(true);
    expect(asked.reduce((n, r) => n + r.bars, 0)).toBe(MAX_BUILT_BASE_BARS);
    let oldest = Infinity;
    for (const r of asked) {
      expect(r.to === undefined || r.to < oldest).toBe(true); // each chunk ends before the previous began
      oldest = (r.to ?? 1_700_000_000) - (r.bars - 1) * DAY;
    }
    expect(out.length).toBeGreaterThan(3000);
  });

  it('asks only for (bars + 1) x ratio base bars when that is below the cap', async () => {
    const asked: HistoryRequest[] = [];
    const fetchBase = async (req: HistoryRequest): Promise<Candle[]> => {
      asked.push(req);
      return Array.from({ length: req.bars }, (_, i) => bar(1_700_000_000 - (req.bars - 1 - i) * 3600));
    };
    const out = await builtHistory({ fetchBase }, ['1h'], { symbol: 'X', timeframe: '4h', bars: 10 });
    expect(asked).toHaveLength(1);
    expect(asked[0].bars).toBe(44);
    expect(out).toHaveLength(10);
  });

  it('keeps asking when the base data is sparser than the ratio (a stock session)', async () => {
    let calls = 0;
    const fetchBase = async (req: HistoryRequest): Promise<Candle[]> => {
      calls++;
      if (calls > 1) throw new NotFoundError('no more');
      return Array.from({ length: 6 }, (_, i) => bar(1_700_000_000 - (5 - i) * 4 * 3600));
    };
    const out = await builtHistory({ fetchBase }, ['1h'], { symbol: 'X', timeframe: '4h', bars: 50 });
    expect(calls).toBe(2);
    expect(out).toHaveLength(5); // six buckets, the oldest dropped
  });
});

describe('Yahoo calendar', () => {
  const meta = { exchangeTimezoneName: 'America/New_York', currentTradingPeriod: { regular: { start: Date.parse('2024-03-12T13:30:00Z') / 1000 } } };

  it('reads the exchange time zone and the local session open from the chart meta', () => {
    expect(sessionCalendar(meta)).toEqual({ kind: 'session', timeZone: 'America/New_York', openSeconds: 34200 });
    expect(sessionCalendar({ ...meta, currentTradingPeriod: { regular: { start: Date.parse('2024-01-12T14:30:00Z') / 1000 } } })).toMatchObject({ openSeconds: 34200 });
    expect(sessionCalendar(undefined)).toBeNull();
    expect(sessionCalendar({ exchangeTimezoneName: 'Not/AZone', currentTradingPeriod: { regular: { start: 1 } } })).toBeNull();
  });

  it('builds AAPL 4h from 1h with the 9:30 anchored split, using the calendar the 1h fetch reported', async () => {
    const open = Date.parse('2024-03-12T13:30:00Z') / 1000;
    const timestamp = [0, 1, 2, 3, 4, 5, 6].map((i) => open + i * 3600);
    const day = (d: number) => timestamp.map((t) => t + d * 86400);
    const all = [...day(-2), ...day(-1), ...day(0)];
    const fake = fakeFetch(() => ({
      chart: {
        result: [{ meta, timestamp: all, indicators: { quote: [{ open: all.map(() => 1), high: all.map(() => 2), low: all.map(() => 0), close: all.map(() => 1), volume: all.map(() => 1) }] } }],
        error: null,
      },
    }));
    const out = await builtHistory(
      { fetchBase: (req, onCalendar) => yahooAdapter.history({ ...ctxFor(fake), onCalendar }, req) },
      ['1m', '5m', '15m', '30m', '1h', '1d', '1w', '1M'],
      { symbol: 'AAPL', timeframe: '4h', bars: 4 },
    );
    expect(fake.urls[0]).toContain('interval=60m');
    const d1 = open - 86400;
    expect(out.map((b) => b.time)).toEqual([d1, d1 + 4 * 3600, open, open + 4 * 3600]);
    expect(out.map((b) => b.volume)).toEqual([4, 3, 4, 3]); // 9:30-13:30 holds four hourly bars, 13:30-16:00 three
  });

  describe('with a weekend gap before the span', () => {
    const fri = Date.parse('2024-03-15T13:30:00Z') / 1000;
    const mon = Date.parse('2024-03-18T13:30:00Z') / 1000;
    const session = [0, 1, 2, 3, 4, 5, 6].map((i) => i * 3600);
    const base = [...session.map((o) => bar(fri + o)), ...session.map((o) => bar(mon + o))];
    const calendar = sessionCalendar(meta)!;
    const range = { symbol: 'AAPL', timeframe: '4h' as const, bars: 100, from: mon, to: mon + 6.5 * 3600 };

    it('keeps the complete in-span bar of the first session in range mode', async () => {
      const fetchBase = async (req: HistoryRequest, onCalendar: (c: typeof calendar) => void): Promise<Candle[]> => {
        onCalendar(calendar);
        return base.filter((c) => c.time >= req.from! && c.time <= req.to!);
      };
      const out = await builtHistory({ fetchBase }, ['1h'], range);
      expect(out.map((b) => [b.time, b.volume])).toEqual([[mon, 4], [mon + 4 * 3600, 3]]);
    });

    it('buckets by the session calendar it was given when the base bars report none (served from the store)', async () => {
      const fetchBase = async (req: HistoryRequest): Promise<Candle[]> => base.filter((c) => c.time >= req.from! && c.time <= req.to!);
      const out = await builtHistory({ fetchBase, calendar }, ['1h'], range);
      expect(out.map((b) => [b.time, b.volume])).toEqual([[mon, 4], [mon + 4 * 3600, 3]]);
    });
  });

  it('starts a bars-with-to hourly window at the edge of Yahoo depth and reports nothing before it', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fake = fakeFetch(() => ({ chart: { result: [{ timestamp: [now - 3600], indicators: { quote: [{ open: [1], high: [2], low: [0], close: [1], volume: [1] }] } }], error: null } }));
    await yahooAdapter.history(ctxFor(fake), { symbol: 'AAPL', timeframe: '1h', bars: 20000, to: now });
    const period1 = Number(new URL(fake.urls[0]).searchParams.get('period1'));
    expect(period1).toBeGreaterThan(now - 732 * 86400);
    expect(period1).toBeLessThan(now - 728 * 86400);
    await expect(yahooAdapter.history(ctxFor(fake), { symbol: 'AAPL', timeframe: '1h', bars: 10, to: now - 800 * 86400 })).rejects.toBeInstanceOf(NotFoundError);
    expect(fake.urls).toHaveLength(1);
  });

  it('builds a 7h series from 1h bars across midnight and drops the oldest partial bucket', async () => {
    const t0 = Date.UTC(2024, 2, 5) / 1000;
    const hours = Array.from({ length: 50 }, (_, i) => bar(t0 + (i + 3) * 3600)); // starts 03:00, mid-bucket
    const fetchBase = async (req: HistoryRequest): Promise<Candle[]> => hours.filter((c) => c.time <= (req.to ?? Infinity)).slice(-req.bars);
    const out = await builtHistory({ fetchBase, now: () => (t0 + 60 * 3600) * 1000 }, ['1h'], { symbol: 'X', timeframe: '7h', bars: 100 });
    expect(out.map((c) => c.time)).toEqual([7, 14, 21, 24, 31, 38, 45, 48].map((h) => t0 + h * 3600));
  });

  it('builds a 2h series and crops a range', async () => {
    const hours = Array.from({ length: 12 }, (_, i) => bar(i * 3600));
    const fetchBase = async (): Promise<Candle[]> => hours;
    const out = await builtHistory({ fetchBase, now: () => 20 * 3600 * 1000 }, ['1h'], { symbol: 'X', timeframe: '2h', bars: 0, from: 4 * 3600, to: 9 * 3600 });
    expect(out.map((c) => c.time)).toEqual([4, 6, 8].map((h) => h * 3600));
  });

  it('builds a 3M series from 1M bars', async () => {
    const months = Array.from({ length: 12 }, (_, i) => bar(Date.UTC(2023, i, 1) / 1000));
    const fetchBase = async (): Promise<Candle[]> => months;
    const out = await builtHistory({ fetchBase }, ['1M'], { symbol: 'X', timeframe: '3M', bars: 10 });
    expect(out.map((c) => c.time)).toEqual([0, 3, 6, 9].map((m) => Date.UTC(2023, m, 1) / 1000));
    expect(out[0].volume).toBe(3);
  });
});
