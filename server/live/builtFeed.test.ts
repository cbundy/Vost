import { beforeEach, describe, expect, it } from 'vitest';
import type { Candle, LiveKlineEvent, Timeframe } from '../../shared/market.ts';
import type { HistoryRequest } from '../providers/types.ts';
import { createBuiltFolder } from './builtFeed.ts';
import { SEED_RETRY_MS } from './coinbaseCandles.ts';
import { fakeTimers } from './testing.ts';

const H = 3600;
const D = 86400;
/** Monday 2024-01-01 00:00 UTC. */
const MON = Date.UTC(2024, 0, 1) / 1000;

const bar = (time: number, o: number, h: number, l: number, c: number, v: number): Candle => ({ time, open: o, high: h, low: l, close: c, volume: v });
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

interface Call {
  req: HistoryRequest;
  resolve(rows: Candle[]): void;
  reject(err: Error): void;
}

function setup(target: Timeframe, base: Timeframe, startSec: number) {
  const timers = fakeTimers();
  let nowSec = startSec;
  const calls: Call[] = [];
  const out: LiveKlineEvent[] = [];
  const logs: string[] = [];
  const folder = createBuiltFolder({
    symbol: 'BTC-USD',
    target,
    base,
    history: (req) =>
      new Promise<Candle[]>((resolve, reject) => {
        calls.push({ req, resolve, reject });
      }),
    timers,
    now: () => nowSec * 1000,
    log: (sev, text) => logs.push(`${sev}: ${text}`),
    emit: (ev) => out.push(ev),
  });
  return {
    folder,
    timers,
    calls,
    out,
    logs,
    setNow: (s: number) => {
      nowSec = s;
    },
    live: () => folder.onBaseStatus({ status: 'live' }),
    kline: (c: Candle, closed = false) => folder.onBaseKline({ candle: c, closed }),
  };
}

let t: ReturnType<typeof setup>;

describe('built folder (4h from 1h)', () => {
  beforeEach(() => {
    t = setup('4h', '1h', MON + 2 * H + 600);
  });

  it('asks for the base bars of the bucket and emits nothing before the answer', async () => {
    t.live();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].req).toMatchObject({ symbol: 'BTC-USD', timeframe: '1h', from: MON, to: MON + 2 * H + 600 });
    t.kline(bar(MON + 2 * H, 5, 9, 4, 6, 1));
    expect(t.out).toEqual([]);
  });

  it('builds the whole bar from seeded and live bars, volume counted once', async () => {
    t.live();
    t.kline(bar(MON + 2 * H, 5, 9, 4, 6, 1)); // buffered while seeding
    t.calls[0].resolve([bar(MON, 10, 12, 9, 11, 100), bar(MON + H, 11, 15, 10, 14, 200), bar(MON + 2 * H, 5, 7, 4, 5, 0.5)]);
    await flush();
    expect(t.out).toEqual([{ candle: bar(MON, 10, 15, 4, 6, 301), closed: false }]);
    t.kline(bar(MON + 2 * H, 5, 20, 4, 8, 2)); // replaces its own slot
    expect(t.out[1].candle).toEqual(bar(MON, 10, 20, 4, 8, 302));
    expect(t.out[1].closed).toBe(false);
  });

  it('a live kline wins over a seeded bar of the same time, whatever the order', async () => {
    t.live();
    t.kline(bar(MON + 2 * H, 1, 2, 1, 2, 7));
    t.calls[0].resolve([bar(MON + 2 * H, 1, 1, 1, 1, 3)]);
    await flush();
    expect(t.out[0].candle).toEqual(bar(MON, 1, 2, 1, 2, 7));
  });

  it('ignores base klines of earlier buckets while seeding', async () => {
    t.live();
    t.kline(bar(MON - H, 1, 100, 1, 1, 50));
    t.calls[0].resolve([bar(MON, 10, 12, 9, 11, 1)]);
    await flush();
    expect(t.out[0].candle).toEqual(bar(MON, 10, 12, 9, 11, 1));
  });

  it('logs a failed seed once and retries after SEED_RETRY_MS', async () => {
    t.live();
    t.calls[0].reject(new Error('boom'));
    await flush();
    expect(t.logs).toHaveLength(1);
    expect(t.logs[0]).toContain('boom');
    expect(t.logs[0]).toContain('15 s');
    expect(t.calls).toHaveLength(1);
    t.timers.advance(SEED_RETRY_MS);
    expect(t.calls).toHaveLength(2);
    t.calls[1].resolve([bar(MON, 1, 2, 1, 2, 4)]);
    await flush();
    expect(t.out).toHaveLength(1);
    expect(t.out[0].candle.volume).toBe(4);
  });

  it('drops a seed that fails until the bucket ends; the next bucket starts from live', async () => {
    t.live();
    t.calls[0].reject(new Error('down'));
    await flush();
    t.setNow(MON + 4 * H + 5);
    t.timers.advance(SEED_RETRY_MS);
    t.calls[1].reject(new Error('down'));
    await flush();
    expect(t.logs).toHaveLength(1); // no retry is scheduled once the bucket is over
    expect(t.timers.pending).toBe(0);
    t.kline(bar(MON + 3 * H, 1, 1, 1, 1, 1)); // late, of the dropped bucket
    expect(t.out).toEqual([]);
    t.kline(bar(MON + 4 * H, 3, 4, 2, 3, 6));
    expect(t.calls).toHaveLength(2); // started at its start: no seed
    expect(t.out).toEqual([{ candle: bar(MON + 4 * H, 3, 4, 2, 3, 6), closed: false }]);
  });

  it('ignores a stale seed answer after a reconnect', async () => {
    t.live();
    t.folder.onBaseStatus({ status: 'reconnecting' });
    t.live();
    expect(t.calls).toHaveLength(2);
    t.calls[0].resolve([bar(MON, 99, 99, 99, 99, 99)]);
    await flush();
    expect(t.out).toEqual([]);
    t.calls[1].resolve([bar(MON, 1, 2, 1, 2, 4)]);
    await flush();
    expect(t.out.map((e) => e.candle.volume)).toEqual([4]);
  });

  it('re-seeds when the base goes live again mid-bucket', async () => {
    t.live();
    t.calls[0].resolve([bar(MON, 1, 2, 1, 2, 4)]);
    await flush();
    t.folder.onBaseStatus({ status: 'reconnecting' });
    t.live();
    expect(t.calls).toHaveLength(2);
    t.kline(bar(MON + 2 * H, 2, 3, 2, 3, 1));
    expect(t.out).toHaveLength(1); // quiet until the seed answers
    t.calls[1].resolve([bar(MON, 1, 2, 1, 2, 4), bar(MON + H, 2, 2.5, 2, 2.5, 5)]);
    await flush();
    expect(t.out[1].candle).toEqual(bar(MON, 1, 3, 1, 3, 10));
  });

  it('does not re-seed on a repeated live status', () => {
    t.live();
    t.live();
    expect(t.calls).toHaveLength(1);
  });

  it('closes the bar once on the next bucket and ignores a late kline of it', async () => {
    t.live();
    t.calls[0].resolve([bar(MON + 2 * H, 1, 2, 1, 2, 4)]);
    await flush();
    t.kline(bar(MON + 4 * H, 7, 8, 6, 7, 1), false);
    expect(t.out.map((e) => [e.candle.time, e.closed])).toEqual([
      [MON, false],
      [MON, true],
      [MON + 4 * H, false],
    ]);
    t.kline(bar(MON + 3 * H, 1, 50, 1, 1, 9)); // late
    t.kline(bar(MON + 4 * H, 7, 9, 6, 8, 2));
    expect(t.out.filter((e) => e.closed)).toHaveLength(1);
    expect(t.out[t.out.length - 1].candle).toEqual(bar(MON + 4 * H, 7, 9, 6, 8, 2));
  });

  it('base close flags do not close the built bar early', async () => {
    t.live();
    t.calls[0].resolve([bar(MON, 1, 2, 1, 2, 4)]);
    await flush();
    t.kline(bar(MON + H, 2, 3, 2, 3, 1), true);
    expect(t.out.every((e) => !e.closed)).toBe(true);
  });

  it('seeds a new bucket whose first kline is not at its start', async () => {
    t.live();
    t.calls[0].resolve([bar(MON, 1, 2, 1, 2, 4)]);
    await flush();
    t.setNow(MON + 5 * H + 30);
    t.kline(bar(MON + 5 * H, 9, 9, 8, 8, 1));
    expect(t.out.filter((e) => e.closed).map((e) => e.candle.time)).toEqual([MON]);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1].req).toMatchObject({ from: MON + 4 * H, to: MON + 5 * H + 30 });
    expect(t.out).toHaveLength(2);
    t.calls[1].resolve([bar(MON + 4 * H, 7, 10, 7, 9, 3)]);
    await flush();
    expect(t.out[2].candle).toEqual(bar(MON + 4 * H, 7, 10, 7, 8, 4));
  });
});

describe('built folder (calendar)', () => {
  it('closes a week at Monday 00:00 UTC (1w from 1d)', async () => {
    const w = setup('1w', '1d', MON + 6 * D + 10 * H); // Sunday
    w.live();
    w.calls[0].resolve([bar(MON, 1, 2, 1, 2, 1), bar(MON + 6 * D, 2, 4, 2, 3, 2)]);
    await flush();
    expect(w.calls[0].req.from).toBe(MON);
    expect(w.out[0].candle).toEqual(bar(MON, 1, 4, 1, 3, 3));
    w.kline(bar(MON + 7 * D, 3, 3, 3, 3, 1));
    expect(w.out[1]).toEqual({ candle: bar(MON, 1, 4, 1, 3, 3), closed: true });
    expect(w.out[2]).toEqual({ candle: bar(MON + 7 * D, 3, 3, 3, 3, 1), closed: false });
  });

  it('closes a month on the first kline of the next one with no close flags (1M from 1d)', async () => {
    const jan1 = Date.UTC(2024, 0, 1) / 1000;
    const feb1 = Date.UTC(2024, 1, 1) / 1000;
    const m = setup('1M', '1d', feb1 - D + H);
    m.live();
    expect(m.calls[0].req.from).toBe(jan1);
    m.calls[0].resolve([bar(jan1, 1, 2, 1, 2, 10), bar(feb1 - D, 2, 5, 2, 4, 5)]);
    await flush();
    expect(m.out[0].candle).toEqual(bar(jan1, 1, 5, 1, 4, 15));
    m.kline(bar(feb1, 4, 4, 3, 3, 1));
    expect(m.out[1]).toEqual({ candle: bar(jan1, 1, 5, 1, 4, 15), closed: true });
    expect(m.out[2]).toEqual({ candle: bar(feb1, 4, 4, 3, 3, 1), closed: false });
  });
});
