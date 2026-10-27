import { beforeEach, describe, expect, it } from 'vitest';
import { FakeWS, FakeWebSocket, fakeTimers } from '../live/testing.ts';
import { fakeFetch } from '../providers/testing.ts';
import { probeHistory, probeLive, probeSymbols, runProbe } from './probes.ts';

beforeEach(() => FakeWS.reset());

const kline = [60000, '1', '3', '0.5', '2', '9'];
const exchangeInfo = { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT' }] };

describe('history probe', () => {
  it('asks for the default symbol and timeframe with two bars', async () => {
    const f = fakeFetch(() => [kline, kline]);
    const r = await probeHistory('binance', { fetch: f.fetch });
    expect(r.ok).toBe(true);
    expect(f.urls).toHaveLength(1);
    const u = new URL(f.urls[0]);
    expect(u.searchParams.get('symbol')).toBe('BTCUSDT');
    expect(u.searchParams.get('interval')).toBe('1h');
    expect(u.searchParams.get('limit')).toBe('2');
  });

  it('reports the upstream error text on failure', async () => {
    const f = fakeFetch(() => new Response('nope', { status: 418 }));
    const r = await probeHistory('binance', { fetch: f.fetch });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toContain('418');
  });

  it('reports "timed out after 10 s" for a request that hangs', async () => {
    const timers = fakeTimers();
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const p = probeHistory('binance', { fetch: hang, timers });
    timers.advance(10_000);
    expect(await p).toMatchObject({ ok: false, error: 'timed out after 10 s' });
    expect(timers.pending).toBe(0);
  });
});

describe('symbols probe', () => {
  it('searches the default symbol on every call, never through the shared cache', async () => {
    const f = fakeFetch(() => exchangeInfo);
    expect((await probeSymbols('binance', { fetch: f.fetch })).ok).toBe(true);
    expect((await probeSymbols('binance', { fetch: f.fetch })).ok).toBe(true);
    // the whole list is downloaded again: a 24 h cache would have hidden an outage
    expect(f.urls.filter((u) => u.includes('exchangeInfo'))).toHaveLength(2);
  });

  it('times out even when the adapter ignores the signal (Binance list download)', async () => {
    const timers = fakeTimers();
    const hang = (() => new Promise(() => undefined)) as unknown as typeof fetch;
    const p = probeSymbols('binance', { fetch: hang, timers });
    timers.advance(10_000);
    expect(await p).toMatchObject({ ok: false, error: 'timed out after 10 s' });
  });
});

describe('live probe', () => {
  const env = () => {
    const timers = fakeTimers();
    return { timers, env: { WebSocket: FakeWebSocket, timers } };
  };

  it('is ok on the first frame, sends the subscribe message and closes the socket', async () => {
    const { env: e } = env();
    const p = probeLive('kraken', e);
    FakeWS.last.open();
    expect(FakeWS.last.sent).toHaveLength(1);
    expect(FakeWS.last.sent[0]).toContain('subscribe');
    FakeWS.last.message('{"channel":"status"}');
    expect(await p).toMatchObject({ ok: true });
    expect(FakeWS.last.closed).toBe(true);
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('is degraded when the socket opened but no frame came before the timeout', async () => {
    const { env: e, timers } = env();
    const p = probeLive('binance', e);
    FakeWS.last.open();
    timers.advance(10_000);
    const r = await p;
    expect(r).toMatchObject({ ok: false, partial: true });
    expect(FakeWS.last.closed).toBe(true);
  });

  it('is a failure when it never opened before the timeout', async () => {
    const { env: e, timers } = env();
    const p = probeLive('binance', e);
    timers.advance(10_000);
    expect(await p).toMatchObject({ ok: false, error: 'timed out after 10 s' });
    expect(FakeWS.last.closed).toBe(true);
  });

  it('is a failure when the socket drops, with the close details', async () => {
    const { env: e, timers } = env();
    const p = probeLive('okx', e);
    FakeWS.last.drop(1006, 'gone');
    const r = await p;
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toContain('1006');
    expect(FakeWS.last.closed).toBe(true);
    expect(timers.pending).toBe(0);
  });

  it('fails for a provider without live data', async () => {
    expect(await probeLive('coinbase', env().env)).toMatchObject({ ok: false });
    expect(FakeWS.instances).toHaveLength(0);
  });
});

describe('runProbe', () => {
  it('dispatches by feed', async () => {
    const f = fakeFetch(() => [kline]);
    expect((await runProbe('binance', 'history', { fetch: f.fetch })).ok).toBe(true);
  });
});
