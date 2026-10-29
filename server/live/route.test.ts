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
    ['provider without live', 'provider=yahoo&symbol=AAPL&timeframe=1m', 'does not offer live data'],
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

describe('GET /api/live source', () => {
  it('answers a bad source with a 400 JSON body and no event-stream header', async () => {
    const res = await fetch(`${base}/api/live?provider=binance&symbol=BTCUSDT&timeframe=4h&source=bogus`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as { error: string }).error).toMatch(/native or built/);
    expect(FakeWS.instances).toHaveLength(0);
  });

  it('passes source=built to the relay', async () => {
    const seen: Array<{ source?: string } | undefined> = [];
    const inner = relay;
    relay = { ...inner, subscribe: (p, s, t, sub, opts) => (seen.push(opts), inner.subscribe(p, s, t, sub, opts)) };
    const res = await fetch(`${base}/api/live?provider=binance&symbol=BTCUSDT&timeframe=1m&source=built`);
    await waitFor(() => FakeWS.instances.length === 1);
    expect(seen).toEqual([{ source: 'built' }]);
    void res.body?.cancel();
  });
});

describe('GET /api/live?sub=', () => {
  const q = (...keys: string[]) => `${base}/api/live?${keys.map((k) => `sub=${encodeURIComponent(k)}`).join('&')}`;
  const open = (n: number) => {
    for (const ws of FakeWS.instances.slice(0, n)) ws.open();
  };

  it('serves several subscriptions on one stream, each event tagged with its own sub', async () => {
    const keys = ['binance:1m:native:BTCUSDT', 'binance:1m:native:ETHUSDT', 'coinbase:1m:native:BTC-USD'];
    const res = await fetch(q(...keys));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    await waitFor(() => FakeWS.instances.length === 3);
    expect(relay.stats().map((s) => s.subscribers)).toEqual([1, 1, 1]);
    open(3);
    const ws = FakeWS.instances[1];
    ws.message(JSON.stringify({ k: { t: 60000, o: '1', h: '2', l: '1', c: '2', v: '3', x: true } }));
    const text = await readUntil(res, (t) => t.includes('event: kline'));
    const evs = events(text);
    expect(evs.filter((e) => e.event === 'status' && e.data.status === 'live').map((e) => e.data.sub).sort()).toEqual([...keys].sort());
    expect(evs.filter((e) => e.event === 'kline')).toEqual([
      { event: 'kline', data: { candle: { time: 60, open: 1, high: 2, low: 1, close: 2, volume: 3 }, closed: true, sub: keys[1] } },
    ]);
    expect(evs.every((e) => keys.includes(e.data.sub))).toBe(true);
  });

  it('gives a refused key one tagged fatal status while the others keep streaming', async () => {
    const res = await fetch(q('binance:1m:native:BTCUSDT', 'binance:9x:native:BTCUSDT', 'garbage', 'binance:1m:bogus:BTCUSDT'));
    await waitFor(() => FakeWS.instances.length === 1);
    FakeWS.last.open();
    FakeWS.last.message(JSON.stringify({ k: { t: 60000, o: '1', h: '2', l: '1', c: '2', v: '3', x: true } }));
    const text = await readUntil(res, (t) => t.includes('event: kline'));
    const evs = events(text);
    const fatal = evs.filter((e) => e.data.fatal);
    expect(fatal.map((e) => e.data.sub).sort()).toEqual(['binance:1m:bogus:BTCUSDT', 'binance:9x:native:BTCUSDT', 'garbage']);
    expect(fatal.every((e) => e.event === 'status' && e.data.status === 'error')).toBe(true);
    expect(evs.some((e) => e.event === 'kline' && e.data.sub === 'binance:1m:native:BTCUSDT')).toBe(true);
  });

  it('ends the response when every key failed', async () => {
    const res = await fetch(q('nope:1m:native:X', 'binance:9x:native:BTCUSDT'));
    const evs = events(await res.text());
    expect(evs).toHaveLength(2);
    expect(evs.every((e) => e.data.fatal === true)).toBe(true);
    expect(FakeWS.instances).toHaveLength(0);
  });

  it('answers more than 16 distinct keys with a 400 JSON body, and counts duplicates once', async () => {
    const many = Array.from({ length: 17 }, (_, i) => `binance:1m:native:S${i}`);
    const bad = await fetch(q(...many));
    expect(bad.status).toBe(400);
    expect(bad.headers.get('content-type')).toContain('application/json');
    expect(((await bad.json()) as { error: string }).error).toMatch(/16/);
    expect(FakeWS.instances).toHaveLength(0);
    const ctl = new AbortController();
    const ok = await fetch(q(...many.slice(0, 16), many[0], many[0]), { signal: ctl.signal });
    expect(ok.status).toBe(200);
    await waitFor(() => FakeWS.instances.length === 16);
    ctl.abort();
  });

  it('round-trips a symbol containing ":" unchanged in sub', async () => {
    const key = 'binance:1m:native:BTC:USDT/X';
    const res = await fetch(q(key));
    const text = await readUntil(res, (t) => t.includes('connecting'));
    expect(events(text)[0].data).toEqual({ status: 'connecting', sub: key });
  });

  it('subscribes the built timeframe for source built', async () => {
    const seen: Array<{ source?: string } | undefined> = [];
    const inner = relay;
    relay = { ...inner, subscribe: (p, s, t, sub, opts) => (seen.push(opts), inner.subscribe(p, s, t, sub, opts)) };
    const res = await fetch(q('binance:4h:built:BTCUSDT'));
    const text = await readUntil(res, (t) => t.includes('connecting'));
    expect(seen).toEqual([{ source: 'built' }]);
    expect(events(text)[0].data.sub).toBe('binance:4h:built:BTCUSDT');
  });

  it('unsubscribes every key when the client goes away, closing the sockets', async () => {
    const ctl = new AbortController();
    await fetch(q('binance:1m:native:BTCUSDT', 'binance:1m:native:ETHUSDT'), { signal: ctl.signal });
    await waitFor(() => relay.stats().length === 2);
    ctl.abort();
    await waitFor(() => relay.stats().length === 0);
    expect(FakeWS.instances.every((w) => w.closed)).toBe(true);
  });

  it('ends the response when the relay shuts down', async () => {
    const res = await fetch(q('binance:1m:native:BTCUSDT', 'binance:1m:native:ETHUSDT'));
    await waitFor(() => relay.stats().length === 2);
    relay.closeAll();
    const evs = events(await res.text());
    expect(evs.length).toBeGreaterThan(0);
  });

  it('sends one ping per stream, not per subscription', async () => {
    heartbeat = 20;
    const res = await fetch(q('binance:1m:native:BTCUSDT', 'binance:1m:native:ETHUSDT', 'binance:1m:native:SOLUSDT'));
    const text = await readUntil(res, (t) => t.split(': ping\n\n').length > 3);
    // within the time three pings took, a per-subscription timer would have sent about three times as many
    expect(text.split(': ping\n\n').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('does not mutate the relay event shared with a legacy stream', async () => {
    const legacy = await fetch(`${base}/api/live?provider=binance&symbol=BTCUSDT&timeframe=1m`);
    const multi = await fetch(q('binance:1m:native:BTCUSDT'));
    await waitFor(() => relay.stats()[0]?.subscribers === 2);
    FakeWS.last.open();
    FakeWS.last.message(JSON.stringify({ k: { t: 60000, o: '1', h: '2', l: '1', c: '2', v: '3', x: true } }));
    const l = events(await readUntil(legacy, (t) => t.includes('event: kline'))).filter((e) => e.event === 'kline');
    const m = events(await readUntil(multi, (t) => t.includes('event: kline'))).filter((e) => e.event === 'kline');
    expect(l[0].data.sub).toBeUndefined();
    expect(m[0].data.sub).toBe('binance:1m:native:BTCUSDT');
  });
});
