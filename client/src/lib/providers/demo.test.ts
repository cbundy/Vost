import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_BARS, TIMEFRAME_SECONDS } from '../../../../shared/market.ts';
import { demoProvider, generateDemoCandles } from './demo';

const DAY = TIMEFRAME_SECONDS['1d'];
afterEach(() => vi.useRealTimers());

describe('demo provider span mode', () => {
  it('gives aligned bars inside the span, both ends inclusive, deterministic', async () => {
    const from = 1_100_000_000;
    const to = from + 40 * DAY;
    const a = await demoProvider.fetchHistory({ symbol: 'DEMO', timeframe: '1d', bars: 500, from, to });
    const b = await demoProvider.fetchHistory({ symbol: 'DEMO', timeframe: '1d', bars: 500, from, to });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(38);
    expect(a.length).toBeLessThanOrEqual(41);
    expect(a[0].time).toBeGreaterThanOrEqual(from);
    expect(a[a.length - 1].time).toBeLessThanOrEqual(to);
    for (const c of a) expect(c.time % DAY).toBe(0);
  });

  it('includes both ends when they sit on bar slots and has no 50-bar floor', async () => {
    const from = 1_100_000_000 - (1_100_000_000 % DAY);
    const r = await demoProvider.fetchHistory({ symbol: 'DEMO', timeframe: '1d', bars: 500, from, to: from + 4 * DAY });
    expect(r.map((c) => c.time)).toEqual([0, 1, 2, 3, 4].map((i) => from + i * DAY));
  });

  it('refuses from after to and spans over the cap with the server wording', async () => {
    await expect(demoProvider.fetchHistory({ symbol: 'DEMO', timeframe: '1d', bars: 5, from: 2000, to: 1000 })).rejects.toThrow(
      'from must not be after to (or in the future)',
    );
    await expect(
      demoProvider.fetchHistory({ symbol: 'DEMO', timeframe: '1m', bars: 5, from: 1_000_000_000, to: 1_100_000_000 }),
    ).rejects.toThrow(/above the limit of 20000; pick a shorter span or a larger timeframe/);
    expect(MAX_BARS).toBe(20000);
  });

  it('clamps to now, so a future from is refused', async () => {
    const future = Math.floor(Date.now() / 1000) + 10 * DAY;
    await expect(demoProvider.fetchHistory({ symbol: 'DEMO', timeframe: '1d', bars: 5, from: future, to: future + DAY })).rejects.toThrow(
      'from must not be after to',
    );
  });

  it('to alone gives bars bars ending at to', async () => {
    const to = 1_100_000_000;
    const r = await demoProvider.fetchHistory({ symbol: 'DEMO', timeframe: '1d', bars: 60, to });
    expect(r).toHaveLength(60);
    expect(r[59].time).toBe(Math.floor(to / DAY) * DAY);
  });

  it('without from/to matches the plain generator', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const r = await demoProvider.fetchHistory({ symbol: 'DEMO', timeframe: '1d', bars: 120 });
    expect(r).toEqual(generateDemoCandles({ bars: 120, timeframe: '1d', seed: 1337 }));
    expect(r[119].time).toBe(Math.floor(1_700_000_000 / DAY) * DAY);
  });
});
