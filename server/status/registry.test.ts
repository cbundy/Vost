import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG } from '../../shared/providerCatalog.ts';
import { statusFeeds, statusKeys } from '../../shared/status.ts';
import type { FeedStats } from '../live/relay.ts';
import { createRegistry, SLOW_MS } from './registry.ts';

function make() {
  const lines: string[] = [];
  let t = 1000;
  const registry = createRegistry({ now: () => t, log: (l) => lines.push(l) });
  const get = (provider: string, feed: 'history' | 'symbols' | 'live', relay: FeedStats[] = []) =>
    registry.snapshot(relay).find((c) => c.provider === provider && c.feed === feed)!;
  return { registry, lines, get, tick: (ms: number) => (t += ms) };
}

const fail = (error = 'boom') => ({ ok: false as const, error });
const stat = (provider: string, status: FeedStats['status'], lastError: string | null = null): FeedStats => ({
  provider,
  symbol: 'X',
  timeframe: '1m',
  subscribers: 1,
  status,
  reconnects: 0,
  lastError,
});

describe('check list', () => {
  it('derives 17 checks from the catalog, Stooq without symbols', () => {
    const { registry } = make();
    const checks = registry.snapshot();
    expect(checks).toHaveLength(17);
    expect(checks.filter((c) => c.feed === 'history').map((c) => c.provider)).toEqual(PROVIDER_CATALOG.map((p) => p.id));
    expect(checks.filter((c) => c.feed === 'symbols')).toHaveLength(6);
    expect(checks.filter((c) => c.feed === 'live').map((c) => c.provider)).toEqual(['binance', 'kraken', 'bybit', 'okx']);
    expect(statusFeeds('stooq')).toEqual(['history']);
    expect(statusKeys()).toHaveLength(17);
    expect(checks.every((c) => c.state === 'unknown' && c.latencyMs === null && c.checkedAt === null && c.lastOkAt === null)).toBe(true);
  });

  it('names each provider', () => {
    expect(make().get('binance', 'history').providerName).toBe('Binance');
  });
});

describe('state rules', () => {
  it('unknown -> ok on a fast success', () => {
    const { registry, get } = make();
    registry.record('binance', 'history', { ok: true, latencyMs: 120 });
    expect(get('binance', 'history')).toMatchObject({ state: 'ok', latencyMs: 120, checkedAt: 1000, lastOkAt: 1000, error: null, source: 'probe' });
  });

  it('ok -> degraded on one failure -> down on the second -> ok on a success', () => {
    const { registry, get, tick } = make();
    registry.record('binance', 'history', { ok: true, latencyMs: 100 });
    tick(10);
    registry.record('binance', 'history', fail('HTTP 500'));
    expect(get('binance', 'history')).toMatchObject({ state: 'degraded', error: 'HTTP 500', lastOkAt: 1000, checkedAt: 1010 });
    registry.record('binance', 'history', fail('HTTP 500'));
    expect(get('binance', 'history').state).toBe('down');
    registry.record('binance', 'history', fail('HTTP 502'));
    expect(get('binance', 'history')).toMatchObject({ state: 'down', error: 'HTTP 502', lastOkAt: 1000 });
    tick(10);
    registry.record('binance', 'history', { ok: true, latencyMs: 90 });
    expect(get('binance', 'history')).toMatchObject({ state: 'ok', error: null, lastOkAt: 1020 });
  });

  it('a first result that fails is degraded', () => {
    const { registry, get } = make();
    registry.record('kraken', 'history', fail());
    expect(get('kraken', 'history')).toMatchObject({ state: 'degraded', lastOkAt: null });
  });

  it('a success slower than the threshold is degraded but counts as success', () => {
    const { registry, get } = make();
    registry.record('binance', 'history', { ok: true, latencyMs: SLOW_MS });
    expect(get('binance', 'history').state).toBe('ok');
    registry.record('binance', 'history', { ok: true, latencyMs: SLOW_MS + 1 });
    expect(get('binance', 'history')).toMatchObject({ state: 'degraded', lastOkAt: 1000 });
    expect(get('binance', 'history').error).toContain('slow');
  });

  it('a partial result (socket without frame) is degraded and does not count toward down', () => {
    const { registry, get } = make();
    registry.record('okx', 'live', { ok: false, partial: true, error: 'no frame' });
    registry.record('okx', 'live', { ok: false, partial: true, error: 'no frame' });
    registry.record('okx', 'live', { ok: false, partial: true, error: 'no frame' });
    expect(get('okx', 'live').state).toBe('degraded');
  });

  it('ignores a pair that is not checked (Stooq symbols)', () => {
    const { registry } = make();
    registry.record('stooq', 'symbols', { ok: true, latencyMs: 1 });
    expect(registry.snapshot()).toHaveLength(17);
  });

  it('records the source of the latest result', () => {
    const { registry, get } = make();
    registry.record('binance', 'history', { ok: true, latencyMs: 5 }, 'traffic');
    expect(get('binance', 'history').source).toBe('traffic');
  });
});

describe('change log', () => {
  it('logs each state change once and nothing for repeats', () => {
    const { registry, lines } = make();
    registry.record('binance', 'history', { ok: true, latencyMs: 100 });
    registry.record('binance', 'history', { ok: true, latencyMs: 110 });
    registry.record('binance', 'history', fail('HTTP 500'));
    registry.record('binance', 'history', fail('HTTP 500'));
    registry.record('binance', 'history', fail('HTTP 500'));
    expect(lines).toEqual([
      '[status] binance history unknown -> ok (100 ms)',
      '[status] binance history ok -> degraded (HTTP 500)',
      '[status] binance history degraded -> down (HTTP 500)',
    ]);
  });
});

describe('relay state wins for live', () => {
  it.each([
    ['live', 'ok', null],
    ['connecting', 'degraded', null],
    ['reconnecting', 'degraded', 'close code 1006'],
    ['error', 'down', 'close code 1006'],
  ] as const)('relay %s -> %s', (status, state, lastError) => {
    const { registry, get } = make();
    registry.record('binance', 'live', { ok: true, latencyMs: 50 }); // an older probe result
    const check = get('binance', 'live', [stat('binance', status, lastError)]);
    expect(check).toMatchObject({ state, source: 'relay', error: lastError, latencyMs: null });
    if (status === 'live') expect(check.lastOkAt).toBe(1000);
  });

  it('a provider with a live feed anywhere is ok; other providers keep their own record', () => {
    const { registry, get } = make();
    const relay = [stat('binance', 'error', 'x'), stat('binance', 'live')];
    expect(get('binance', 'live', relay).state).toBe('ok');
    expect(get('kraken', 'live', relay)).toMatchObject({ state: 'unknown', source: 'probe' });
    expect(registry.snapshot(relay).filter((c) => c.source === 'relay')).toHaveLength(1);
  });

  it('logs the relay change once', () => {
    const { registry, lines } = make();
    registry.snapshot([stat('binance', 'live')]);
    registry.snapshot([stat('binance', 'live')]);
    expect(lines).toEqual(['[status] binance live unknown -> ok']);
  });
});
