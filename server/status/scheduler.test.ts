import { describe, expect, it } from 'vitest';
import type { StatusFeed } from '../../shared/status.ts';
import type { FeedStats } from '../live/relay.ts';
import { fakeTimers } from '../live/testing.ts';
import type { CheckResult } from './registry.ts';
import { FIRST_ROUND_DELAY_MS, REFRESH_REUSE_MS, STAGGER_MS, SYMBOLS_EVERY, createStatusService } from './scheduler.ts';

function make(opts: { intervalSeconds?: number; relay?: FeedStats[]; hold?: boolean } = {}) {
  const timers = fakeTimers();
  let clock = 1_000_000;
  const calls: Array<{ provider: string; feed: StatusFeed; at: number }> = [];
  const gates: Array<() => void> = [];
  const service = createStatusService({
    version: '1.2.3',
    intervalSeconds: opts.intervalSeconds ?? 60,
    timers,
    now: () => clock,
    log: () => undefined,
    uptimeSeconds: () => 42,
    relayStats: () => opts.relay ?? [],
    probe: (provider, feed) => {
      calls.push({ provider, feed, at: clock });
      const result: CheckResult = { ok: true, latencyMs: 10 };
      if (!opts.hold) return Promise.resolve(result);
      return new Promise((resolve) => gates.push(() => resolve(result)));
    },
  });
  /** Moves both clocks forward. */
  const advance = async (ms: number) => {
    for (let left = ms; left > 0; ) {
      const step = Math.min(left, 50);
      clock += step;
      timers.advance(step);
      left -= step;
      await Promise.resolve();
    }
    await new Promise((r) => setImmediate(r));
  };
  return { service, timers, calls, gates, advance, setClock: (ms: number) => (clock += ms) };
}

const roundMs = 17 * STAGGER_MS;

describe('background rounds', () => {
  it('runs a first round after the start delay, staggered, then one per interval', async () => {
    const t = make();
    t.service.scheduler.start();
    await t.advance(FIRST_ROUND_DELAY_MS - 1);
    expect(t.calls).toHaveLength(0);
    await t.advance(1);
    expect(t.calls).toHaveLength(1); // not all at once
    await t.advance(roundMs);
    expect(t.calls).toHaveLength(17); // first round includes the symbol probes
    const starts = t.calls.map((c) => c.at);
    expect(starts.slice(1).every((at, i) => at - starts[i] === STAGGER_MS)).toBe(true);
    await t.advance(60_000 - roundMs);
    expect(t.calls.length).toBeGreaterThan(17);
    t.service.scheduler.stop();
  });

  it('runs symbol probes only on every 10th round', async () => {
    const t = make({ intervalSeconds: 60 });
    t.service.scheduler.start();
    await t.advance(FIRST_ROUND_DELAY_MS + roundMs);
    expect(t.calls.filter((c) => c.feed === 'symbols')).toHaveLength(6);
    for (let i = 1; i < SYMBOLS_EVERY; i++) await t.advance(60_000);
    // rounds 2..10 had none; the 10th round after the first is still ahead
    expect(t.calls.filter((c) => c.feed === 'symbols')).toHaveLength(6);
    await t.advance(60_000);
    expect(t.calls.filter((c) => c.feed === 'symbols')).toHaveLength(12);
    t.service.scheduler.stop();
  });

  it('interval 0 runs no background round and sets no timer', async () => {
    const t = make({ intervalSeconds: 0 });
    t.service.scheduler.start();
    expect(t.timers.pending).toBe(0);
    await t.advance(10 * 60_000);
    expect(t.calls).toHaveLength(0);
    expect(t.service.response().intervalSeconds).toBe(0);
    expect(t.service.response().checks.every((c) => c.state === 'unknown')).toBe(true);
  });

  it('skips the live probe of a provider whose relay feed is open', async () => {
    const relay: FeedStats[] = [{ provider: 'binance', symbol: 'X', timeframe: '1m', subscribers: 1, status: 'live', reconnects: 0, lastError: null }];
    const t = make({ relay });
    t.service.scheduler.start();
    await t.advance(FIRST_ROUND_DELAY_MS + roundMs);
    const live = t.calls.filter((c) => c.feed === 'live').map((c) => c.provider);
    expect(live).toEqual(['kraken', 'bybit', 'okx']);
    expect(t.service.response().checks.find((c) => c.provider === 'binance' && c.feed === 'live')).toMatchObject({ state: 'ok', source: 'relay' });
  });

  it('records probe results in the registry', async () => {
    const t = make();
    t.service.scheduler.start();
    await t.advance(FIRST_ROUND_DELAY_MS + roundMs);
    const checks = t.service.response().checks;
    expect(checks.every((c) => c.state === 'ok' && c.source === 'probe')).toBe(true);
  });

  it('stop() clears every timer, including the staggered starts of a running round', async () => {
    const t = make();
    t.service.scheduler.start();
    await t.advance(FIRST_ROUND_DELAY_MS + STAGGER_MS * 3);
    expect(t.timers.pending).toBeGreaterThan(2);
    t.service.scheduler.stop();
    expect(t.timers.pending).toBe(0);
    const n = t.calls.length;
    await t.advance(5 * 60_000);
    expect(t.calls).toHaveLength(n);
  });
});

describe('refresh', () => {
  it('runs a full round (symbols included) and answers when it finished', async () => {
    const t = make({ intervalSeconds: 0 });
    let done = false;
    const p = t.service.scheduler.refresh().then((r) => ((done = true), r));
    await t.advance(STAGGER_MS * 16 - 1);
    expect(done).toBe(false);
    await t.advance(STAGGER_MS * 2);
    expect(await p).toEqual({ refreshed: true });
    expect(t.calls).toHaveLength(17);
    expect(t.calls.filter((c) => c.feed === 'symbols')).toHaveLength(6);
  });

  it('joins a round that is running instead of starting another', async () => {
    const t = make({ intervalSeconds: 0, hold: true });
    const first = t.service.scheduler.refresh();
    await t.advance(STAGGER_MS * 3);
    const second = t.service.scheduler.refresh();
    const third = t.service.scheduler.refresh();
    await t.advance(roundMs);
    t.gates.forEach((g) => g());
    expect(await first).toEqual({ refreshed: true });
    expect(await second).toEqual({ refreshed: false });
    expect(await third).toEqual({ refreshed: false });
    expect(t.calls).toHaveLength(17);
  });

  it('reuses a round started within 15 s, and runs a new one after', async () => {
    const t = make({ intervalSeconds: 0 });
    const first = t.service.scheduler.refresh();
    await t.advance(roundMs + 100);
    await first;
    expect(t.calls).toHaveLength(17);
    expect(await t.service.scheduler.refresh()).toEqual({ refreshed: false });
    expect(t.calls).toHaveLength(17);
    await t.advance(REFRESH_REUSE_MS);
    const again = t.service.scheduler.refresh();
    await t.advance(roundMs + 100);
    expect(await again).toEqual({ refreshed: true });
    expect(t.calls).toHaveLength(34);
  });

  it('a refresh also reuses a background round that just started', async () => {
    const t = make();
    t.service.scheduler.start();
    await t.advance(FIRST_ROUND_DELAY_MS + roundMs + 100);
    expect(await t.service.scheduler.refresh()).toEqual({ refreshed: false });
    expect(t.calls).toHaveLength(17);
  });
});

describe('response', () => {
  it('carries the server block and the checks', () => {
    const t = make();
    const r = t.service.response();
    expect(r.server).toEqual({ state: 'ok', version: '1.2.3', uptimeSeconds: 42 });
    expect(r.intervalSeconds).toBe(60);
    expect(r.checks).toHaveLength(17);
  });
});
