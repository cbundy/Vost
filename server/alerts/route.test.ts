import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Relay, Subscriber } from '../live/relay.ts';
import { createTelegram } from './telegram.ts';
import { createAlerts, isAlertsPath, type Alerts, type AlertsDeps } from './index.ts';

type Reply = Omit<Response, 'json'> & { json(): Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const fetch = (...args: Parameters<typeof globalThis.fetch>): Promise<Reply> => globalThis.fetch(...args) as Promise<Reply>;

let dir = '';
let server: http.Server;
let base = '';
let alerts: Alerts;
let subs: Subscriber[] = [];
let logs: string[] = [];

const relay: Relay = {
  subscribe(_p, _s, _t, sub) {
    subs.push(sub);
    return { unsubscribe: () => void (subs = subs.filter((x) => x !== sub)) };
  },
  stats: () => [],
  closeAll: () => undefined,
};
const price = (close: number) => {
  for (const s of [...subs]) s.onKline({ candle: { time: 0, open: close, high: close, low: close, close, volume: 0 }, closed: false });
};

async function boot(dataDir = dir, extra: Partial<AlertsDeps> = {}) {
  alerts = await createAlerts({ dataDir, relay, adapters: new Map(), log: (l) => logs.push(l), ...extra });
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (isAlertsPath(url.pathname)) void alerts.handle(req, res, url);
    else res.end('other');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-route-'));
  subs = [];
  logs = [];
});
afterEach(async () => {
  await alerts.stop();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

const JSON_H = { 'content-type': 'application/json' };
const create = (over: object = {}, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/alerts`, { method: 'POST', headers: { ...JSON_H, ...headers }, body: JSON.stringify({ provider: 'binance', symbol: 'btcusdt', condition: 'crossing-up', level: 100, ...over }) });

describe('alerts routes', () => {
  beforeEach(() => boot());

  it('lists, creates, edits and deletes', async () => {
    expect(await (await fetch(`${base}/api/alerts`)).json()).toEqual({ alerts: [], telegram: { configured: false } });
    const res = await create({ note: 'hi' });
    expect(res.status).toBe(201);
    const made = await res.json();
    expect(made).toMatchObject({ provider: 'binance', symbol: 'BTCUSDT', level: 100, note: 'hi', status: 'active', lastPrice: null });
    expect((await (await fetch(`${base}/api/alerts`)).json()).alerts).toHaveLength(1);

    const put = await fetch(`${base}/api/alerts/${made.id}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify({ level: 150, symbol: 'ZZZ' }) });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ id: made.id, level: 150, symbol: 'BTCUSDT' });

    expect((await fetch(`${base}/api/alerts/${made.id}`, { method: 'DELETE', headers: JSON_H })).status).toBe(204);
    expect((await fetch(`${base}/api/alerts/${made.id}`, { method: 'DELETE', headers: JSON_H })).status).toBe(404);
    expect((await fetch(`${base}/api/alerts/nope`, { method: 'PUT', headers: JSON_H, body: '{}' })).status).toBe(404);
  });

  it('answers 400 with a message for bad input and bad JSON', async () => {
    const res = await create({ level: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/level/);
    const bad = await fetch(`${base}/api/alerts`, { method: 'POST', headers: JSON_H, body: '{nope' });
    expect(bad.status).toBe(400);
  });

  it('answers 404 for a malformed percent-escape and keeps serving', async () => {
    expect((await fetch(`${base}/api/alerts/%E0%A4%A`, { method: 'DELETE', headers: JSON_H })).status).toBe(404);
    expect((await fetch(`${base}/api/alerts/%E0%A4%A`, { method: 'GET' })).status).toBe(404);
    expect((await fetch(`${base}/api/alerts`)).status).toBe(200);
  });

  it('answers 405 for other methods', async () => {
    expect((await fetch(`${base}/api/alerts`, { method: 'PATCH' })).status).toBe(405);
    expect((await fetch(`${base}/api/alerts/x`, { method: 'GET' })).status).toBe(405);
    expect((await fetch(`${base}/api/alerts/events`, { method: 'POST', headers: JSON_H, body: '{}' })).status).toBe(405);
  });

  it('writes need a JSON content type', async () => {
    const res = await fetch(`${base}/api/alerts`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(res.status).toBe(415);
  });

  it('refuses cross-site writes and logs them', async () => {
    expect((await create({}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await create({}, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await create({}, { origin: 'null' })).status).toBe(403);
    const made = await (await create()).json();
    expect((await fetch(`${base}/api/alerts/${made.id}`, { method: 'DELETE', headers: { ...JSON_H, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await (await fetch(`${base}/api/alerts`)).json()).alerts).toHaveLength(1);
    expect(logs.some((l) => l.startsWith('[alerts] 403 POST /api/alerts:'))).toBe(true);
  });

  it('accepts a matching Origin and same-origin fetch metadata', async () => {
    expect((await create({}, { origin: base, 'sec-fetch-site': 'same-origin' })).status).toBe(201);
  });

  it('puts no CORS header on replies and grants none on OPTIONS', async () => {
    for (const res of [await fetch(`${base}/api/alerts`), await create(), await create({ level: -1 }), await fetch(`${base}/api/alerts`, { method: 'OPTIONS' })]) {
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
    }
    expect((await fetch(`${base}/api/alerts/abc`, { method: 'OPTIONS' })).status).toBe(204);
  });

  it('answers 413 on an oversized body', async () => {
    const res = await create({ note: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    const chunked = await fetch(`${base}/api/alerts`, { method: 'POST', headers: JSON_H, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"a":"' + 'x'.repeat(20_000) + '"}')); c.close(); } }), duplex: 'half' } as RequestInit);
    expect(chunked.status).toBe(413);
  });

  it('streams alerts on connect, after a create, then triggered', async () => {
    const res = await fetch(`${base}/api/alerts/events`);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const until = async (cond: () => boolean) => {
      while (!cond()) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    };
    const events = () => text.split('\n\n').filter((b) => b.startsWith('event:')).map((b) => ({ event: /^event: (.*)$/m.exec(b)![1], data: JSON.parse(/^data: (.*)$/m.exec(b)![1]) }));
    await until(() => events().length >= 1);
    expect(events()[0]).toEqual({ event: 'alerts', data: { alerts: [] } });
    await create();
    await until(() => events().length >= 2);
    expect(events()[1].data.alerts).toHaveLength(1);
    price(90);
    price(110);
    await until(() => events().some((e) => e.event === 'triggered'));
    const names = events().map((e) => e.event);
    expect(names).toContain('triggered');
    expect(events().find((e) => e.event === 'triggered')!.data).toMatchObject({ status: 'triggered', triggerPrice: 110 });
    await until(() => events().filter((e) => e.event === 'alerts').length >= 3);
    // lastPrice-only changes (90 above) sent no extra alerts event: connect, create, trigger.
    expect(events().filter((e) => e.event === 'alerts')).toHaveLength(3);
    void reader.cancel();
  });
});

describe('unwritable data dir', () => {
  it('starts, serves GET and answers 503 naming VOST_DATA_DIR on writes', async () => {
    await writeFile(path.join(dir, 'file'), 'x');
    await boot(path.join(dir, 'file', 'data'));
    expect((await fetch(`${base}/api/alerts`)).status).toBe(200);
    const res = await create();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('VOST_DATA_DIR');
    expect(logs.some((l) => l.includes('not writable'))).toBe(true);
    expect(logs.some((l) => l.startsWith('[alerts] 503 POST'))).toBe(true);
  });
});

describe('alerts and Telegram', () => {
  const TOKEN = '123456:SECRET-tok_en';
  type Call = { url: string; body: { chat_id: string; text: string } };
  let calls: Call[] = [];
  let plan: () => Promise<Response> = async () => Response.json({ ok: true, result: { message_id: 1 } });
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return plan();
  }) as unknown as typeof globalThis.fetch;
  const withTelegram = () => boot(dir, { telegram: createTelegram({ config: { token: TOKEN, chatId: '42' }, fetch: fakeFetch, log: (l) => logs.push(l), sleep: async () => undefined }) });
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(fn()).toBe(true);
  };
  const list = async () => (await (await fetch(`${base}/api/alerts`)).json()).alerts as { id: string; status: string; telegram?: string; telegramError?: string }[];
  const fire = async () => {
    const made = await (await create()).json();
    price(90);
    price(110);
    return made.id as string;
  };

  beforeEach(() => {
    calls = [];
    plan = async () => Response.json({ ok: true, result: { message_id: 1 } });
  });

  it('reports configured: true and sends exactly one message per firing', async () => {
    await withTelegram();
    expect(await (await fetch(`${base}/api/alerts`)).json()).toEqual({ alerts: [], telegram: { configured: true } });
    const id = await fire();
    await until(() => logs.some((l) => l.includes('telegram sent')));
    expect(calls).toHaveLength(1);
    expect(calls[0].body.chat_id).toBe('42');
    expect(calls[0].body.text).toContain('BTCUSDT (Binance) crossed up 100 - now 110');
    expect((await list()).find((a) => a.id === id)!.telegram).toBe('sent');
    expect(logs).toContain(`[alerts] ${id} telegram sent`);
  });

  it('records off when not configured and sends nothing', async () => {
    await boot();
    const id = await fire();
    await new Promise((r) => setTimeout(r, 50));
    const a = (await list()).find((x) => x.id === id)!;
    expect(a).toMatchObject({ status: 'triggered', telegram: 'off' });
    expect(calls).toHaveLength(0);
  });

  it('records failed with a redacted reason, and nothing leaks', async () => {
    plan = async () => Response.json({ ok: false, description: `Forbidden: bot ${TOKEN} was blocked` }, { status: 403 });
    await withTelegram();
    const id = await fire();
    await until(() => logs.some((l) => l.includes('telegram failed')));
    await new Promise((r) => setTimeout(r, 50));
    const a = (await list()).find((x) => x.id === id)!;
    expect(a).toMatchObject({ status: 'triggered', telegram: 'failed', telegramError: 'Forbidden: bot <token> was blocked' });
    const all = JSON.stringify([logs, await (await fetch(`${base}/api/alerts`)).text()]);
    expect(all).not.toContain('SECRET-tok_en');
  });

  it('the stream carries the delivery state and no token', async () => {
    await withTelegram();
    const res = await fetch(`${base}/api/alerts/events`);
    const reader = res.body!.getReader();
    let text = '';
    void (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        text += new TextDecoder().decode(value);
      }
    })();
    await fire();
    await until(() => text.includes('"telegram": "sent"') || text.includes('"telegram":"sent"'));
    expect(text).not.toContain('SECRET-tok_en');
    await reader.cancel();
  });

  it('deleting or editing the alert during a slow send leaves it as the user left it', async () => {
    let release: () => void = () => undefined;
    plan = () => new Promise((resolve) => (release = () => resolve(Response.json({ ok: true, result: {} }))));
    await withTelegram();
    const a = await fire();
    await until(() => calls.length === 1);
    expect((await fetch(`${base}/api/alerts/${a}`, { method: 'DELETE', headers: JSON_H })).status).toBe(204);
    release();
    await until(() => logs.some((l) => l.includes('telegram sent')));
    await new Promise((r) => setTimeout(r, 50));
    expect(await list()).toEqual([]);

    calls = [];
    const b = await fire();
    await until(() => calls.length === 1);
    const put = await fetch(`${base}/api/alerts/${b}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify({ level: 500 }) });
    expect(put.status).toBe(200);
    release();
    await new Promise((r) => setTimeout(r, 80));
    const after = (await list()).find((x) => x.id === b)!;
    expect(after.status).toBe('active');
    expect(after.telegram).toBeUndefined();
  });

  describe('POST /api/alerts/telegram-test', () => {
    const post = (headers: Record<string, string> = JSON_H) => fetch(`${base}/api/alerts/telegram-test`, { method: 'POST', headers, body: '{}' });

    it('answers 503 naming the variables when not configured', async () => {
      await boot();
      const res = await post();
      expect(res.status).toBe(503);
      const { error } = await res.json();
      expect(error).toContain('VOST_TELEGRAM_BOT_TOKEN');
      expect(error).toContain('VOST_TELEGRAM_CHAT_ID');
    });

    it('answers 200 and sends the test text', async () => {
      await withTelegram();
      const res = await post();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(calls.map((c) => c.body.text)).toEqual(['Vost: test message']);
    });

    it('answers 502 with a redacted reason on a refusal', async () => {
      plan = async () => Response.json({ ok: false, description: `chat not found for ${TOKEN}` }, { status: 400 });
      await withTelegram();
      const res = await post();
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(text).toContain('chat not found for <token>');
      expect(text).not.toContain('SECRET-tok_en');
      expect(logs.join('\n')).not.toContain('SECRET-tok_en');
    });

    it('refuses cross-origin, wrong content type and other methods', async () => {
      await withTelegram();
      expect((await post({ ...JSON_H, origin: 'http://evil.example' })).status).toBe(403);
      expect((await post({ 'content-type': 'text/plain' })).status).toBe(415);
      const get = await fetch(`${base}/api/alerts/telegram-test`);
      expect(get.status).toBe(405);
      expect(get.headers.get('allow')).toBe('POST');
      expect(calls).toHaveLength(0);
    });
  });
});
