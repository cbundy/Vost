import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TIMEFRAME_SECONDS, type Candle, type Timeframe } from '../../shared/market.ts';
import type { Relay, Subscriber } from '../live/relay.ts';
import { fakeTimers } from '../live/testing.ts';
import { NotFoundError, UpstreamError } from '../providers/errors.ts';
import type { HistoryRequest, ProviderAdapter } from '../providers/types.ts';
import type { RecordConfig } from './recordConfig.ts';
import { createRecorder, type Recorder, type RecorderDeps } from './recorder.ts';
import { openCandleStore, type CandleStore, type Series } from './store.ts';

const H = 3600;
/** 2 minutes before an hour boundary, 10 s into a minute. */
const T0 = 1_000_000 * H - 110;

const candle = (time: number): Candle => ({ time, open: 1, high: 2, low: 0.5, close: time % 97, volume: 3 });
const sec = (tf: Timeframe): number => TIMEFRAME_SECONDS[tf];
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

interface Call {
  provider: string;
  at: number;
  req: HistoryRequest;
}

let dir: string;
let store: CandleStore;
let timers: ReturnType<typeof fakeTimers>;
let recorder: Recorder | undefined;
let logs: string[];
let calls: Call[];
let inflight: Map<string, number>;
let maxInflight: Map<string, number>;
/** Per provider: the first bar time the "exchange" holds, and an optional failure injector. */
let historyStart: Record<string, number>;
let failWith: (provider: string, n: number) => Error | undefined;

const nowMs = (): number => T0 * 1000 + timers.elapsed;
const nowSec = (): number => Math.floor(nowMs() / 1000);
const lastBar = (tf: Timeframe): number => Math.floor(nowSec() / sec(tf)) * sec(tf) - sec(tf);

/** Advances the fake clock in steps, letting pending async work settle after each. */
async function tick(ms: number, step = 50): Promise<void> {
  for (let done = 0; done < ms; done += step) {
    timers.advance(Math.min(step, ms - done));
    await flush();
  }
}

function fakeAdapter(id: string): ProviderAdapter {
  return {
    id,
    search: async () => [],
    async history(ctx, req) {
      calls.push({ provider: id, at: timers.elapsed, req });
      const n = calls.filter((c) => c.provider === id).length;
      inflight.set(id, (inflight.get(id) ?? 0) + 1);
      maxInflight.set(id, Math.max(maxInflight.get(id) ?? 0, inflight.get(id)!));
      try {
        await flush();
        const err = failWith(id, n);
        if (err) throw err;
        const step = sec(req.timeframe);
        const out: Candle[] = [];
        const first = Math.max(Math.ceil(req.from! / step) * step, historyStart[id] ?? 0);
        for (let t = first; t <= req.to!; t += step) out.push(candle(t));
        if (out.length === 0) throw new NotFoundError('nothing');
        return out;
      } finally {
        inflight.set(id, inflight.get(id)! - 1);
      }
    },
  };
}

interface FakeSub {
  provider: string;
  symbol: string;
  timeframe: string;
  sub: Subscriber;
  open: boolean;
}
function fakeRelay() {
  const subs: FakeSub[] = [];
  const relay: Relay = {
    subscribe(provider, symbol, timeframe, sub) {
      const s: FakeSub = { provider, symbol, timeframe, sub, open: true };
      subs.push(s);
      return { unsubscribe: () => void (s.open = false) };
    },
    stats: () => [],
    closeAll: () => undefined,
  };
  return {
    relay,
    subs,
    status: (s: FakeSub, status: 'connecting' | 'live' | 'reconnecting' | 'error') => s.sub.onStatus({ status }),
    kline: (s: FakeSub, time: number, closed: boolean) => s.sub.onKline({ candle: candle(time), closed }),
  };
}

function config(entries: Array<[string, string, Timeframe]>, depthBars: number): RecordConfig {
  return { on: true, depthBars, series: entries.map(([provider, symbol, timeframe]) => ({ provider, symbol, timeframe })) };
}

function build(cfg: RecordConfig, over: Partial<RecorderDeps> = {}) {
  const fr = fakeRelay();
  const ids = [...new Set(cfg.series.map((s) => s.provider))];
  recorder = createRecorder({
    config: cfg,
    store,
    relay: fr.relay,
    adapters: new Map(ids.map((id) => [id, fakeAdapter(id)])),
    ctx: () => ({ symbols: undefined as never }),
    timers,
    now: nowMs,
    log: (l) => logs.push(l),
    ...over,
  });
  return { ...fr, recorder };
}

const holes = (s: Series, depth: number) => store.covered(s, lastBar(s.timeframe) - (depth - 1) * sec(s.timeframe), lastBar(s.timeframe));

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-rec-'));
  timers = fakeTimers();
  logs = [];
  calls = [];
  inflight = new Map();
  maxInflight = new Map();
  historyStart = {};
  failWith = () => undefined;
  recorder = undefined;
  store = await openCandleStore({ dir, now: nowMs, log: (l) => logs.push(l) });
});
afterEach(async () => {
  recorder?.stop();
  store.close();
  await rm(dir, { recursive: true, force: true });
});

const S1: Series = { provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h' };

describe('start fill', () => {
  it('fills an empty store newest first, one page per call, one in flight, paced, with no hole left', async () => {
    const { recorder } = build(config([['binance', 'BTCUSDT', '1h']], 2500));
    recorder.start();
    await tick(3000);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.req.to)).toEqual([...calls.map((c) => c.req.to)].sort((a, b) => b! - a!));
    expect(calls[0]!.req.to).toBe(lastBar('1h'));
    for (const c of calls) {
      expect((c.req.to! - c.req.from!) / H + 1).toBeLessThanOrEqual(1000);
      expect(c.req.from).toBeDefined();
    }
    expect(maxInflight.get('binance')).toBe(1);
    for (let i = 1; i < calls.length; i++) expect(calls[i]!.at - calls[i - 1]!.at).toBeGreaterThanOrEqual(250);
    expect(holes(S1, 2500)).toEqual([]);
    expect(store.range(S1, 0, Infinity)).toHaveLength(2500);
    expect(logs.filter((l) => l.includes('filled'))).toHaveLength(3);
    expect(logs[0]).toMatch(/^\[recorder\] binance BTCUSDT 1h filled .+\.\..+: 1000 candles \(cause: start\)$/);
    const stat = recorder.stats().series[0]!;
    expect(stat).toMatchObject({ refills: 3, missingBars: 0, lastError: null, live: 'connecting' });
    expect(stat.lastCandleTime).toBe(lastBar('1h'));
  });

  it('gives every series a chunk before any gets a second one, and paces providers separately', async () => {
    const { recorder } = build(config([['binance', 'BTCUSDT', '1h'], ['binance', 'ETHUSDT', '1h'], ['coinbase', 'BTC-USD', '1h']], 2500));
    recorder.start();
    await tick(500);
    const binance = calls.filter((c) => c.provider === 'binance');
    expect(binance.slice(0, 2).map((c) => c.req.symbol).sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(binance[0]!.req.to).toBe(binance[1]!.req.to);
    // Coinbase runs its own queue at the same time.
    expect(calls.filter((c) => c.provider === 'coinbase').length).toBeGreaterThan(0);
    await tick(10_000);
    expect(maxInflight.get('coinbase')).toBe(1);
    expect(holes({ ...S1, symbol: 'ETHUSDT' }, 2500)).toEqual([]);
    expect(holes({ provider: 'coinbase', symbol: 'BTC-USD', timeframe: '1h' }, 2500)).toEqual([]);
    const cb = calls.filter((c) => c.provider === 'coinbase');
    expect(cb).toHaveLength(9); // 2500 bars in pages of 300
    for (const c of cb) expect((c.req.to! - c.req.from!) / H + 1).toBeLessThanOrEqual(300);
  });

  it('covers the rest of the window as empty when the exchange history starts inside it', async () => {
    historyStart.binance = lastBar('1h') - 1200 * H;
    const { recorder } = build(config([['binance', 'BTCUSDT', '1h']], 2500));
    recorder.start();
    await tick(3000);
    expect(calls).toHaveLength(3);
    expect(holes(S1, 2500)).toEqual([]);
    expect(store.range(S1, 0, Infinity)).toHaveLength(1201);
    const oldLast = lastBar('1h');
    await tick(16 * 60_000, 1000); // a sweep, after one more bar closed
    expect(calls).toHaveLength(4);
    expect(calls[3]!.req).toMatchObject({ from: oldLast + 1, to: lastBar('1h') }); // only the new bar, nothing old
  });

  it('never asks for a time before the Unix epoch when the window is deeper than the calendar', async () => {
    const S: Series = { provider: 'binance', symbol: 'BTCUSDT', timeframe: '1M' };
    historyStart.binance = lastBar('1M') - 100 * sec('1M');
    const { recorder } = build(config([['binance', 'BTCUSDT', '1M']], 20000));
    recorder.start();
    await tick(3000);
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) {
      expect(c.req.from!).toBeGreaterThanOrEqual(0);
      expect(c.req.to!).toBeGreaterThanOrEqual(0);
    }
    expect(store.covered(S, 0, lastBar('1M'))).toEqual([]);
    expect(logs.filter((l) => l.includes('fill failed'))).toEqual([]);
  });

  it('covers a 404 on a series with nothing stored as empty, never to be asked again', async () => {
    historyStart.binance = lastBar('1h') + 10 * H; // no data at all
    const { recorder } = build(config([['binance', 'BTCUSDT', '1h']], 2500));
    recorder.start();
    await tick(3000);
    expect(calls).toHaveLength(1);
    expect(holes(S1, 2500)).toEqual([]);
    const oldLast = lastBar('1h');
    await tick(16 * 60_000, 1000); // a sweep, after one more bar closed
    expect(calls).toHaveLength(2);
    expect(calls[1]!.req).toMatchObject({ from: oldLast + 1, to: lastBar('1h') });
  });

  it('fetches only the tail after a restart', async () => {
    const covTo = lastBar('1h') - 7 * H;
    const start = lastBar('1h') - 99 * H;
    store.upsert(S1, Array.from({ length: 93 }, (_, i) => candle(start + i * H)), start, covTo);
    const { recorder } = build(config([['binance', 'BTCUSDT', '1h']], 100));
    recorder.start();
    await tick(2000);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.req).toMatchObject({ from: covTo + 1, to: lastBar('1h') });
    expect(logs.filter((l) => l.includes('filled'))[0]).toContain('7 candles');
    expect(holes(S1, 100)).toEqual([]);
  });

  it('logs series in the store that are no longer recorded', async () => {
    store.upsert({ ...S1, symbol: 'OLD' }, [candle(lastBar('1h') - H)]);
    const { recorder } = build(config([['binance', 'BTCUSDT', '1h']], 100));
    recorder.start();
    expect(logs).toContain('[recorder] not recorded any more: binance OLD 1h');
  });
});

describe('live', () => {
  it('writes closed klines as rows and coverage, never forming ones; a bar joined mid-way is filled from REST', async () => {
    const f = build(config([['binance', 'BTCUSDT', '1h']], 100), { sweepMs: 10 ** 9 });
    f.recorder.start();
    await tick(2000);
    const filled = calls.length;
    const covTo = lastBar('1h');
    f.status(f.subs[0]!, 'live'); // 110 s - 2 s before the bar closes
    const forming = lastBar('1h') + H; // opened before the feed went live
    f.kline(f.subs[0]!, forming, false);
    expect(store.range(S1, forming, forming)).toEqual([]);
    await tick(120_000, 1000); // the forming bar closes
    f.kline(f.subs[0]!, forming, true);
    expect(store.range(S1, forming, forming)).toHaveLength(1);
    expect(holes(S1, 100)).toEqual([{ from: covTo + 1, to: forming }]);
    await tick(1000); // REST fills its coverage
    expect(calls.length).toBe(filled + 1);
    expect(calls[filled]!.req).toMatchObject({ from: covTo + 1, to: forming });
    expect(holes(S1, 100)).toEqual([]);
    // A bar that opened after the feed went live is covered by its own row, with no call.
    const next = forming + H;
    await tick(H * 1000, 10_000);
    f.kline(f.subs[0]!, next, true);
    expect(holes(S1, 100)).toEqual([]);
    expect(store.range(S1, next, next)).toHaveLength(1);
    await tick(2000);
    expect(calls.length).toBe(filled + 1);
  });

  it('refills exactly the span missed while the feed was down', async () => {
    const tf: Timeframe = '1m';
    const S: Series = { provider: 'binance', symbol: 'BTCUSDT', timeframe: tf };
    const f = build(config([['binance', 'BTCUSDT', tf]], 100), { sweepMs: 10 ** 9 });
    f.recorder.start();
    await tick(1000);
    f.status(f.subs[0]!, 'live');
    const coveredTo = lastBar(tf);
    expect(holes(S, 100)).toEqual([]);
    const before = calls.length;
    f.status(f.subs[0]!, 'reconnecting');
    await tick(30 * 60_000, 1000);
    expect(calls.length).toBe(before); // nothing is asked while down
    f.status(f.subs[0]!, 'live');
    await tick(2000);
    expect(calls).toHaveLength(before + 1);
    expect(calls[before]!.req).toMatchObject({ from: coveredTo + 1, to: lastBar(tf) });
    expect(lastBar(tf) - coveredTo).toBe(30 * 60);
    expect(holes(S, 100)).toEqual([]);
    expect(logs.filter((l) => l.includes('cause: reconnect'))).toHaveLength(1);
    expect(recorder!.stats().series[0]).toMatchObject({ live: 'live', missingBars: 0 });
  });
});

describe('errors and pacing', () => {
  it('pauses one provider on 429 (60 s, then doubling, reset on success) while another keeps going', async () => {
    failWith = (id, n) => (id === 'binance' && n <= 2 ? new UpstreamError('binance', 'h', 429, 'slow down') : undefined);
    const { recorder } = build(config([['binance', 'BTCUSDT', '1h'], ['coinbase', 'BTC-USD', '1h']], 2500));
    recorder.start();
    await tick(1000);
    expect(calls.filter((c) => c.provider === 'binance')).toHaveLength(1);
    const cbBefore = calls.filter((c) => c.provider === 'coinbase').length;
    await tick(30_000, 1000);
    expect(calls.filter((c) => c.provider === 'binance')).toHaveLength(1);
    expect(calls.filter((c) => c.provider === 'coinbase').length).toBe(9);
    expect(cbBefore).toBeLessThan(9);
    await tick(40_000, 1000);
    const b = calls.filter((c) => c.provider === 'binance');
    expect(b.length).toBeGreaterThanOrEqual(2);
    expect(b[1]!.at - b[0]!.at).toBeGreaterThanOrEqual(60_000);
    expect(b[1]!.at - b[0]!.at).toBeLessThan(62_000);
    await tick(130_000, 1000);
    const b2 = calls.filter((c) => c.provider === 'binance');
    expect(b2[2]!.at - b2[1]!.at).toBeGreaterThanOrEqual(120_000);
    expect(b2[2]!.at - b2[1]!.at).toBeLessThan(122_000);
    await tick(10_000, 1000);
    expect(holes(S1, 2500)).toEqual([]);
    expect(logs.some((l) => l.includes('rate limited (HTTP 429): paused 60 s'))).toBe(true);
    expect(logs.some((l) => l.includes('paused 120 s'))).toBe(true);
    // A success resets the back-off.
    expect(recorder.stats().series[0]!.lastError).toBeNull();
  });

  it('records another error as lastError and retries only at the next sweep', async () => {
    failWith = (_id, n) => (n === 1 ? new Error('boom') : undefined);
    const { recorder } = build(config([['binance', 'BTCUSDT', '1h']], 100));
    recorder.start();
    await tick(5000);
    expect(calls).toHaveLength(1);
    expect(recorder.stats().series[0]!.lastError).toBe('boom');
    expect(recorder.stats().series[0]!.missingBars).toBe(100);
    await tick(16 * 60_000, 1000);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.req.to).toBe(lastBar('1h'));
    expect(recorder.stats().series[0]).toMatchObject({ lastError: null, missingBars: 0, refills: 1 });
    expect(logs.some((l) => l.includes('cause: sweep'))).toBe(true);
  });

  it('uses a one second gap and 300-bar pages for a provider it does not know', async () => {
    const { recorder } = build(config([['binance', 'BTCUSDT', '1h']], 700), { pacing: { binance: { gapMs: 1000, page: 300 } } });
    recorder.start();
    await tick(5000);
    expect(calls).toHaveLength(3);
    for (let i = 1; i < 3; i++) expect(calls[i]!.at - calls[i - 1]!.at).toBeGreaterThanOrEqual(1000);
  });
});

describe('sweep and prune', () => {
  it('drops exactly the rows older than the depth window and keeps the rest', async () => {
    const { recorder } = build(config([['binance', 'BTCUSDT', '1h']], 100));
    recorder.start();
    await tick(2000);
    const first = lastBar('1h') - 99 * H;
    expect(store.range(S1, 0, Infinity)[0]!.time).toBe(first);
    await tick(100 * H * 1000, 900_000); // 100 bars pass, 400 sweeps
    const depthStart = lastBar('1h') - 99 * H;
    expect(depthStart).toBe(first + 100 * H);
    const rows = store.range(S1, 0, Infinity);
    expect(rows[0]!.time).toBe(depthStart);
    expect(rows.at(-1)!.time).toBe(lastBar('1h'));
    expect(rows).toHaveLength(100);
    expect(holes(S1, 100)).toEqual([]);
  });
});

describe('off and stop', () => {
  it('does nothing when the store is off', async () => {
    const blocker = path.join(dir, 'file');
    await writeFile(blocker, 'x');
    const off = await openCandleStore({ dir: path.join(blocker, 'f', 'd'), log: () => undefined });
    const f = build(config([['binance', 'BTCUSDT', '1h']], 100), { store: off });
    f.recorder.start();
    await tick(5000);
    expect(f.subs).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(timers.pending).toBe(0);
    expect(f.recorder.stats()).toMatchObject({ on: false, series: [] });
  });

  it('does nothing for VOST_RECORD=off', async () => {
    const f = build({ on: false, series: [], depthBars: 100 });
    f.recorder.start();
    await tick(5000);
    expect(f.subs).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('stop unsubscribes every series, clears every timer, aborts the call and writes nothing after', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: ProviderAdapter = {
      id: 'binance',
      search: async () => [],
      async history(ctx, req) {
        calls.push({ provider: 'binance', at: timers.elapsed, req });
        await gate;
        if (ctx.signal?.aborted) throw new Error('aborted');
        return [candle(req.to!)];
      },
    };
    const f = build(config([['binance', 'BTCUSDT', '1h'], ['binance', 'ETHUSDT', '1h']], 100), { adapters: new Map([['binance', slow]]) });
    f.recorder.start();
    await tick(500);
    expect(calls).toHaveLength(1); // in flight
    expect(f.subs.filter((s) => s.open)).toHaveLength(2);
    f.recorder.stop();
    expect(f.subs.filter((s) => s.open)).toHaveLength(0);
    release();
    await tick(2000);
    expect(timers.pending).toBe(0);
    expect(store.stats().rows).toBe(0);
    f.kline(f.subs[0]!, lastBar('1h'), true);
    expect(store.stats().rows).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('stop clears the pacing timer too', async () => {
    const f = build(config([['binance', 'BTCUSDT', '1h']], 2500));
    f.recorder.start();
    await tick(300); // between two calls
    expect(timers.pending).toBeGreaterThan(0);
    f.recorder.stop();
    expect(timers.pending).toBe(0);
  });
});

describe('disk cost', () => {
  it('measures the bytes of 20000 one-minute rows', async () => {
    const depth = 20000;
    const tf: Timeframe = '1m';
    const S: Series = { provider: 'binance', symbol: 'BTCUSDT', timeframe: tf };
    const real = (): Candle[] => {
      const out: Candle[] = [];
      let price = 60000;
      for (let i = 0; i < depth; i++) {
        const open = price;
        price = Math.round((price + Math.sin(i / 7) * 13.37 + ((i * 7919) % 101) / 10 - 5) * 100) / 100;
        out.push({ time: lastBar(tf) - (depth - 1 - i) * 60, open, high: Math.max(open, price) + 1.25, low: Math.min(open, price) - 0.75, close: price, volume: Math.round(((i * 104729) % 9973)) / 100 });
      }
      return out;
    };
    const rows = real();
    store.upsert(S, rows, rows[0]!.time, rows.at(-1)!.time);
    const bytes = store.stats().bytes;
    console.log(`[disk cost] ${depth} 1m rows: ${bytes} bytes (${(bytes / depth).toFixed(1)} per row)`);
    expect(store.stats().rows).toBe(depth);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(depth * 200);
  });
});
