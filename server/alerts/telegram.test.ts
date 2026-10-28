import { describe, expect, it } from 'vitest';
import type { Alert } from '../../shared/alerts.ts';
import { RETRY_DELAYS_MS } from '../providers/upstream.ts';
import { setTestUpstream } from '../testUpstream.ts';
import { alertMessage, createTelegram, readTelegramConfig, redactToken } from './telegram.ts';

const TOKEN = '987654:AAH-secret_Tok';
const config = { token: TOKEN, chatId: '-100' };

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'a1', provider: 'binance', symbol: 'BTCUSDT', condition: 'crossing-up', level: 65000, note: 'take profit',
  createdAt: 1, status: 'triggered', lastPrice: 65012.5, triggeredAt: 2, triggerPrice: 65012.5, ...over,
});

describe('readTelegramConfig', () => {
  it('is on only with both, trimmed', () => {
    const logs: string[] = [];
    expect(readTelegramConfig({ VOST_TELEGRAM_BOT_TOKEN: ' t ', VOST_TELEGRAM_CHAT_ID: ' 5 ' }, (l) => logs.push(l))).toEqual({ token: 't', chatId: '5' });
    expect(readTelegramConfig({}, (l) => logs.push(l))).toBeNull();
    expect(readTelegramConfig({ VOST_TELEGRAM_BOT_TOKEN: '  ', VOST_TELEGRAM_CHAT_ID: '' }, (l) => logs.push(l))).toBeNull();
    expect(logs).toEqual([]);
  });
  it('warns by name, never by value, when one is missing', () => {
    const logs: string[] = [];
    expect(readTelegramConfig({ VOST_TELEGRAM_BOT_TOKEN: TOKEN }, (l) => logs.push(l))).toBeNull();
    expect(readTelegramConfig({ VOST_TELEGRAM_CHAT_ID: '777' }, (l) => logs.push(l))).toBeNull();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain('VOST_TELEGRAM_CHAT_ID');
    expect(logs[1]).toContain('VOST_TELEGRAM_BOT_TOKEN');
    expect(logs.join('')).not.toContain(TOKEN);
    expect(logs.join('')).not.toContain('777');
  });
});

describe('alertMessage', () => {
  it('words the three conditions', () => {
    expect(alertMessage(alert())).toBe('Vost alert: BTCUSDT (Binance) crossed up 65,000 - now 65,012.5. Note: take profit');
    expect(alertMessage(alert({ condition: 'crossing-down', note: '' }))).toBe('Vost alert: BTCUSDT (Binance) crossed down 65,000 - now 65,012.5.');
    expect(alertMessage(alert({ condition: 'crossing', provider: 'kraken', level: 0.000123, triggerPrice: 1234567.891 }))).toBe('Vost alert: BTCUSDT (Kraken) crossed 0.000123 - now 1,234,567.891. Note: take profit');
  });
});

describe('redactToken', () => {
  it('replaces raw and URL-encoded tokens everywhere', () => {
    const text = `a ${TOKEN} b ${encodeURIComponent(TOKEN)} c ${TOKEN}`;
    expect(redactToken(text, TOKEN)).toBe('a <token> b <token> c <token>');
  });
});

type Step = Response | Error;
function harness(steps: Step[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  let i = 0;
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step.clone();
  }) as unknown as typeof globalThis.fetch;
  const telegram = createTelegram({ config, fetch, log: (l) => logs.push(l), sleep: async (ms) => void sleeps.push(ms) });
  return { telegram, calls, sleeps, logs };
}
const ok = () => Response.json({ ok: true, result: { message_id: 1 } });
const json = (status: number, body: unknown) => Response.json(body, { status });

describe('createTelegram', () => {
  it('is off without a config', async () => {
    const t = createTelegram({ config: null });
    expect(t.configured).toBe(false);
    expect(await t.send('x')).toMatchObject({ ok: false });
  });

  it('posts once: URL, headers and body', async () => {
    const h = harness([ok()]);
    expect(await h.telegram.send('hello')).toEqual({ ok: true });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(h.calls[0].init.method).toBe('POST');
    expect(h.calls[0].init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(h.calls[0].init.body))).toEqual({ chat_id: '-100', text: 'hello' });
  });

  it('goes through the test upstream when one is set', async () => {
    setTestUpstream('http://127.0.0.1:9');
    try {
      const h = harness([ok()]);
      // the URL is fixed when created, so create after setting
      expect(h.telegram.configured).toBe(true);
      const calls: string[] = [];
      const t = createTelegram({ config, fetch: (async (u: string) => (calls.push(u), ok())) as unknown as typeof globalThis.fetch });
      await t.send('x');
      expect(calls[0]).toBe(`http://127.0.0.1:9/https/api.telegram.org/bot${TOKEN}/sendMessage`);
    } finally {
      setTestUpstream(null);
    }
  });

  it('waits retry_after on a 429 and caps it at 30 s', async () => {
    const a = harness([json(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 2 } }), ok()]);
    expect(await a.telegram.send('x')).toEqual({ ok: true });
    expect(a.sleeps).toEqual([2000]);
    const b = harness([json(429, { ok: false, parameters: { retry_after: 500 } }), ok()]);
    await b.telegram.send('x');
    expect(b.sleeps).toEqual([30000]);
    const c = harness([json(429, { ok: false }), ok()]);
    await c.telegram.send('x');
    expect(c.sleeps).toEqual([RETRY_DELAYS_MS[1]]);
  });

  it('does not retry a 400 or an ok:false', async () => {
    const a = harness([json(400, { ok: false, description: 'Bad Request: chat not found' })]);
    expect(await a.telegram.send('x')).toEqual({ ok: false, reason: 'Bad Request: chat not found' });
    expect(a.calls).toHaveLength(1);
    const b = harness([json(200, { ok: false, description: 'nope' })]);
    expect(await b.telegram.send('x')).toEqual({ ok: false, reason: 'nope' });
    expect(b.calls).toHaveLength(1);
  });

  it('makes three attempts on 5xx and on network errors, then fails', async () => {
    const a = harness([json(502, 'bad gateway')]);
    expect(await a.telegram.send('x')).toEqual({ ok: false, reason: 'HTTP 502' });
    expect(a.calls).toHaveLength(3);
    expect(a.sleeps).toEqual([RETRY_DELAYS_MS[1], RETRY_DELAYS_MS[2]]);
    const b = harness([new Error('connect ECONNREFUSED')]);
    const r = await b.telegram.send('x');
    expect(r).toEqual({ ok: false, reason: 'network error: connect ECONNREFUSED' });
    expect(b.calls).toHaveLength(3);
    const c = harness([json(500, {}), ok()]);
    expect(await c.telegram.send('x')).toEqual({ ok: true });
  });

  it('retries a timeout', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const h = harness([timeout]);
    expect(await h.telegram.send('x')).toEqual({ ok: false, reason: 'timed out' });
    expect(h.calls).toHaveLength(3);
  });

  it('never leaks the token in a reason, raw or encoded, and clips to 200 characters', async () => {
    const enc = encodeURIComponent(TOKEN);
    const h = harness([new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed, also ${enc}`)]);
    const r = await h.telegram.send('x');
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain(enc);
    expect(JSON.stringify(r)).toContain('<token>');
    const long = harness([json(400, { ok: false, description: `${'x'.repeat(190)}${TOKEN}` })]);
    const lr = await long.telegram.send('x');
    expect(lr.ok === false && lr.reason.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(lr)).not.toContain('AAH-secret');
    expect([...h.logs, ...long.logs].join('')).not.toContain(TOKEN);
  });
});
