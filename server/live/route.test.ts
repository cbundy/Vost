import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { handleLive } from './route.ts';
import { createRelay, type Relay } from './relay.ts';
import { FakeWS, FakeWebSocket, fakeTimers } from './testing.ts';

let server: http.Server;
let base = '';
let relay: Relay;
let heartbeat = 15_000;

beforeAll(async () => {
  server = http.createServer((req, res) => handleLive(req, res, new URL(req.url!, 'http://x'), relay, heartbeat));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  FakeWS.reset();
  heartbeat = 15_000;
  relay = createRelay({ WebSocket: FakeWebSocket, timers: fakeTimers(), log: () => undefined });
});
afterEach(() => relay.closeAll());

/** Reads the stream until `done(text)` or the stream ends. */
async function readUntil(res: Response, done: (text: string) => boolean): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  while (!done(text)) {
    const { value, done: end } = await reader.read();
    if (end) break;
    text += dec.decode(value);
  }
  void reader.cancel();
  return text;
}

const events = (text: string) =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => ({ event: /^event: (.*)$/m.exec(b)![1], data: JSON.parse(/^data: (.*)$/m.exec(b)![1]) }));

const waitFor = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};

describe('GET /api/live', () => {
  it('streams status then kline events with the event-stream headers', async () => {
    const res = await fetch(`${base}/api/live?provider=binance&symbol=BTCUSDT&timeframe=1m`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    await waitFor(() => FakeWS.instances.length === 1);
    FakeWS.last.open();
    FakeWS.last.message(JSON.stringify({ k: { t: 60000, o: '1', h: '2', l: '1', c: '2', v: '3', x: true } }));
    const text = await readUntil(res, (t) => t.includes('event: kline'));
    expect(events(text)).toEqual([
      { event: 'status', data: { status: 'connecting' } },
      { event: 'status', data: { status: 'live' } },
      { event: 'kline', data: { candle: { time: 60, open: 1, high: 2, low: 1, close: 2, volume: 3 }, closed: true } },
    ]);
  });

  it('sends a log event for a failed upstream attempt', async () => {
    const res = await fetch(`${base}/api/live?provider=binance&symbol=BTCUSDT&timeframe=1m`);
    await waitFor(() => FakeWS.instances.length === 1);
    FakeWS.last.drop(1006, '');
    const text = await readUntil(res, (t) => t.includes('event: log'));
    const log = events(text).find((e) => e.event === 'log')!;
    expect(log.data.severity).toBe('warning');
    expect(log.data.text).toContain('attempt 1');
  });

  it('sends a ": ping" comment on the heartbeat interval', async () => {
    heartbeat = 20;
    const res = await fetch(`${base}/api/live?provider=binance&symbol=BTCUSDT&timeframe=1m`);
    const text = await readUntil(res, (t) => t.includes(': ping\n\n'));
    expect(text).toContain(': ping\n\n');
  });

  it.each([
    ['unsupported timeframe', 'provider=binance&symbol=BTCUSDT&timeframe=9x', 'Live data does not support 9x'],
    ['unknown provider', 'provider=nope&symbol=BTCUSDT&timeframe=1m', 'Unknown provider "nope"'],
    ['provider without live', 'provider=coinbase&symbol=BTCUSDT&timeframe=1m', 'does not offer live data'],
    ['empty symbol', 'provider=binance&symbol=&timeframe=1m', 'Missing symbol'],
  ])('answers %s with one fatal status error and ends the stream', async (_n, query, detail) => {
    const res = await fetch(`${base}/api/live?${query}`);
    expect(res.status).toBe(200);
    const text = await res.text(); // resolves only because the server ends the stream
    const evs = events(text);
    expect(evs).toHaveLength(1);
    expect(evs[0].event).toBe('status');
    expect(evs[0].data).toMatchObject({ status: 'error', fatal: true });
    expect(evs[0].data.detail).toContain(detail);
    expect(FakeWS.instances).toHaveLength(0);
  });

  it('unsubscribes when the client goes away, closing the upstream socket', async () => {
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/live?provider=binance&symbol=BTCUSDT&timeframe=1m`, { signal: ctl.signal });
    await readUntil(res, (t) => t.includes('connecting'));
    expect(relay.stats()).toHaveLength(1);
    ctl.abort();
    await waitFor(() => relay.stats().length === 0);
    expect(FakeWS.last.closed).toBe(true);
  });

  it('ends the response when the relay shuts down', async () => {
    const res = await fetch(`${base}/api/live?provider=binance&symbol=BTCUSDT&timeframe=1m`);
    await waitFor(() => relay.stats().length === 1);
    relay.closeAll();
    const text = await res.text();
    expect(events(text)[0].data).toEqual({ status: 'connecting' });
  });

  it('refuses other methods', async () => {
    const res = await fetch(`${base}/api/live?provider=binance&symbol=BTCUSDT&timeframe=1m`, { method: 'POST' });
    expect(res.status).toBe(405);
  });
});
