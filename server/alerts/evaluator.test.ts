import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alert } from '../../shared/alerts.ts';
import type { Candle } from '../../shared/market.ts';
import type { Relay, Subscriber } from '../live/relay.ts';
import { fakeTimers } from '../live/testing.ts';
import type { HistoryRequest, ProviderAdapter } from '../providers/types.ts';
import { createAlerts, type Alerts } from './index.ts';

interface Sub {
  provider: string;
  symbol: string;
  timeframe: string;
  sub: Subscriber;
  open: boolean;
}

function fakeRelay() {
  const subs: Sub[] = [];
  const relay: Relay = {
    subscribe(provider, symbol, timeframe, sub) {
      const s: Sub = { provider, symbol, timeframe, sub, open: true };
      subs.push(s);
      return { unsubscribe: () => void (s.open = false) };
    },
    stats: () => [],
    closeAll: () => undefined,
  };
  const candle = (close: number): Candle => ({ time: 0, open: close, high: close, low: close, close, volume: 0 });
  return {
    relay,
    subs,
    open: () => subs.filter((s) => s.open),
    push: (provider: string, symbol: string, close: number) => {
      for (const s of subs) if (s.open && s.provider === provider && s.symbol === symbol) s.sub.onKline({ candle: candle(close), closed: false });
    },
  };
}

function fakeAdapter(id: string, prices: () => number | Error) {
  const calls: HistoryRequest[] = [];
  const adapter = {
    id,
    history: async (_ctx: unknown, req: HistoryRequest) => {
      calls.push(req);
      const p = prices();
      if (p instanceof Error) throw p;
      return [{ time: 0, open: p, high: p, low: p, close: p, volume: 0 }] as Candle[];
    },
    search: async () => [],
  } as ProviderAdapter;
  return { adapter, calls };
}

let dir = '';
let timers: ReturnType<typeof fakeTimers>;
let clock = 5000;
let logs: string[] = [];
let alertsInstances: Alerts[] = [];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-eval-'));
  timers = fakeTimers();
  clock = 5000;
  logs = [];
  alertsInstances = [];
});
afterEach(async () => {
  for (const a of alertsInstances) await a.stop();
  await rm(dir, { recursive: true, force: true });
});

/** Collects firings and lets a test wait for the Nth one (no timing guess: the listener runs after the save). */
function firings() {
  const fired: Alert[] = [];
  const waiters: { n: number; resolve: () => void }[] = [];
  return {
    fired,
    listener: (x: Alert) => {
      fired.push(x);
      for (const w of waiters) if (fired.length >= w.n) w.resolve();
    },
    reached: (n: number) => (fired.length >= n ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ n, resolve }))),
  };
}

/** Let all queued saves and the microtasks after them finish, so a negative assertion sees the final state. */
async function settle(a: Alerts) {
  await a.stop();
  await new Promise<void>((r) => setImmediate(r));
}

async function start(relay: Relay, adapters: ProviderAdapter[] = [], extra: { onTriggered?: (a: Alert) => void; pollSeconds?: number } = {}) {
  const a = await createAlerts({
    dataDir: dir,
    relay,
    adapters: new Map(adapters.map((x) => [x.id, x])),
    ctx: () => ({ symbols: undefined as never }),
    timers,
    now: () => clock++,
    log: (l) => logs.push(l),
    ...extra,
  });
  alertsInstances.push(a);
  return a;
}

const body = (o: object) => ({ provider: 'binance', symbol: 'BTCUSDT', condition: 'crossing-up', level: 100, ...o });

describe('live subscriptions', () => {
  it('shares one 1m subscription between two alerts and drops it with the last one', async () => {
    const f = fakeRelay();
    const a = await start(f.relay);
    const one = await a.service.create(body({}));
    const two = await a.service.create(body({ level: 200 }));
    expect(f.open()).toHaveLength(1);
    expect(f.open()[0]).toMatchObject({ provider: 'binance', symbol: 'BTCUSDT', timeframe: '1m' });
    await a.service.remove(one.id);
    expect(f.open()).toHaveLength(1);
    await a.service.remove(two.id);
    expect(f.open()).toHaveLength(0);
  });

  it('drops the subscription when the last active alert triggers', async () => {
    const f = fakeRelay();
    const a = await start(f.relay);
    await a.service.create(body({}));
    f.push('binance', 'BTCUSDT', 90);
    f.push('binance', 'BTCUSDT', 110);
    expect(f.open()).toHaveLength(0); // sync() runs inside the price handler, before the save
  });

  it('fires once with onTriggered even after more klines, and logs it', async () => {
    const f = fakeRelay();
    const { fired, listener, reached } = firings();
    const a = await start(f.relay, [], { onTriggered: listener });
    const created = await a.service.create(body({}));
    for (const p of [90, 110, 90, 120]) f.push('binance', 'BTCUSDT', p);
    await reached(1);
    // Read the file before stop(): the trigger save has finished by now, while stop() flushes a held lazy snapshot.
    const stored = JSON.parse(await readFile(path.join(dir, 'alerts.json'), 'utf8')).alerts[0];
    expect(stored).toMatchObject({ status: 'triggered', triggerPrice: 110 });
    await settle(a);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ id: created.id, status: 'triggered', triggerPrice: 110 });
    expect(logs.some((l) => l.startsWith(`[alerts] fired ${created.id} binance BTCUSDT crossing-up 100 at 110`))).toBe(true);
  });

  it('a throwing listener does not stop the others or the evaluator', async () => {
    const f = fakeRelay();
    const { fired, listener, reached } = firings();
    const a = await start(f.relay, [], {
      onTriggered: () => {
        throw new Error('boom');
      },
    });
    a.onTriggered(listener);
    await a.service.create(body({}));
    await a.service.create(body({ symbol: 'ETHUSDT', level: 10 }));
    f.push('binance', 'BTCUSDT', 90);
    f.push('binance', 'BTCUSDT', 110);
    f.push('binance', 'ETHUSDT', 5);
    f.push('binance', 'ETHUSDT', 15);
    await reached(2);
    expect(fired).toHaveLength(2);
    expect(logs.some((l) => l.includes('listener failed: boom'))).toBe(true);
  });

  it('a feed error or fatal status never fires or changes an alert', async () => {
    const f = fakeRelay();
    const a = await start(f.relay);
    await a.service.create(body({}));
    f.open()[0].sub.onStatus({ status: 'error', detail: 'socket closed', fatal: true });
    f.open()[0].sub.onStatus({ status: 'error', detail: 'socket closed', fatal: true });
    expect(a.service.list()[0]).toMatchObject({ status: 'active', lastPrice: null });
    expect(logs.filter((l) => l.includes('socket closed'))).toHaveLength(1);
  });

  it('a restart fires on the first observation above the level', async () => {
    const f = fakeRelay();
    const first = await start(f.relay);
    await first.service.create(body({}));
    f.push('binance', 'BTCUSDT', 90);
    await first.stop();

    const g = fakeRelay();
    const { fired, listener, reached } = firings();
    const second = await start(g.relay, [], { onTriggered: listener });
    expect(second.service.list()[0].lastPrice).toBe(90);
    g.push('binance', 'BTCUSDT', 120);
    await reached(1);
    expect(fired).toHaveLength(1);
    expect(fired[0].triggerPrice).toBe(120);
  });
});

describe('polling', () => {
  it('polls the smallest timeframe at the interval, once per symbol', async () => {
    const cb = fakeAdapter('yahoo', () => 90);
    const st = fakeAdapter('stooq', () => 90);
    const f = fakeRelay();
    const a = await start(f.relay, [cb.adapter, st.adapter], { pollSeconds: 30 });
    await a.service.create(body({ provider: 'yahoo', symbol: 'AAPL' }));
    await a.service.create(body({ provider: 'yahoo', symbol: 'AAPL', level: 500 }));
    await a.service.create(body({ provider: 'stooq', symbol: 'AAPL.US' }));
    expect(f.subs).toHaveLength(0);
    expect(cb.calls).toHaveLength(1); // first price at once, shared by both alerts
    expect(cb.calls[0]).toMatchObject({ symbol: 'AAPL', timeframe: '1m' });
    expect(st.calls[0].timeframe).toBe('1d');
    expect(timers.delays()).toEqual([30_000]);
    timers.advance(30_000);
    expect(cb.calls).toHaveLength(2);
    expect(st.calls).toHaveLength(2);
  });

  it('clamps a poll interval below 10 s to 10 s', async () => {
    const cb = fakeAdapter('yahoo', () => 90);
    const a = await start(fakeRelay().relay, [cb.adapter], { pollSeconds: 1 });
    await a.service.create(body({ provider: 'yahoo', symbol: 'AAPL' }));
    expect(timers.delays()).toEqual([10_000]);
  });

  it('fires when a polled price crosses, and stops polling', async () => {
    let price = 90;
    const cb = fakeAdapter('yahoo', () => price);
    const { fired, listener, reached } = firings();
    const a = await start(fakeRelay().relay, [cb.adapter], { onTriggered: listener });
    await a.service.create(body({ provider: 'yahoo', symbol: 'AAPL' }));
    price = 105;
    timers.advance(60_000);
    await reached(1);
    await settle(a);
    expect(fired).toHaveLength(1);
    expect(timers.pending).toBe(0);
  });

  it('a failing or throwing poll never fires and is logged once', async () => {
    let fail = true;
    const cb = fakeAdapter('yahoo', () => (fail ? new Error('HTTP 500') : 90));
    const fired: Alert[] = [];
    const a = await start(fakeRelay().relay, [cb.adapter], { onTriggered: (x) => fired.push(x) });
    await a.service.create(body({ provider: 'yahoo', symbol: 'AAPL' }));
    await vi.waitFor(() => expect(cb.calls).toHaveLength(1));
    await vi.waitFor(() => expect(logs.filter((l) => l.includes('yahoo AAPL HTTP 500'))).toHaveLength(1));
    timers.advance(60_000);
    await vi.waitFor(() => expect(cb.calls).toHaveLength(2));
    await new Promise<void>((r) => setImmediate(r)); // let the second failure be handled (and not logged again)
    expect(fired).toHaveLength(0);
    expect(a.service.list()[0]).toMatchObject({ status: 'active', lastPrice: null });
    expect(logs.filter((l) => l.includes('yahoo AAPL HTTP 500'))).toHaveLength(1);
    fail = false;
    timers.advance(60_000);
    await vi.waitFor(() => expect(a.service.list()[0].lastPrice).toBe(90));
  });
});
