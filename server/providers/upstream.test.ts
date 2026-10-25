import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamError } from './errors.ts';
import { upstreamFetch, upstreamJson, type FetchFn } from './upstream.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function sequence(...statuses: Array<number | Error>): { fetch: FetchFn; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(next === 200 ? '{"ok":true}' : `upstream says ${next}`, { status: next });
  }) as unknown as FetchFn;
  return { fetch, calls };
}

describe('upstreamFetch', () => {
  it('retries a 503 once and sends the browser-like headers', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetch, calls } = sequence(503, 200);
    const p = upstreamJson<{ ok: boolean }>('Kraken', 'https://api.kraken.com/x', { fetch });
    await vi.advanceTimersByTimeAsync(600);
    expect(await p).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['user-agent']).toBe('Mozilla/5.0');
    expect(headers.accept).toBe('application/json, text/csv, text/plain, */*');
  });

  it('waits 600 ms and then 1500 ms between attempts', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetch, calls } = sequence(500, 500, 200);
    const p = upstreamFetch('Kraken', 'https://api.kraken.com/x', { fetch });
    await vi.advanceTimersByTimeAsync(599);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1499);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await p).status).toBe(200);
  });

  it('surfaces three 429s as an UpstreamError with the provider, host, status and body', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetch, calls } = sequence(429);
    const p = upstreamFetch('Yahoo Finance', 'https://query1.finance.yahoo.com/v8', { fetch });
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    const err = (await caught) as UpstreamError;
    expect(calls).toHaveLength(3);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ provider: 'Yahoo Finance', host: 'query1.finance.yahoo.com', status: 429, body: 'upstream says 429' });
    expect(err.message).toBe('Yahoo Finance: HTTP 429 - upstream says 429');
  });

  it('does not retry a 404 and cuts the body at 180 characters', async () => {
    const fetch = (async () => new Response('x'.repeat(500), { status: 404 })) as unknown as FetchFn;
    const err = (await upstreamFetch('Bybit', 'https://api.bybit.com/x', { fetch }).catch((e: unknown) => e)) as UpstreamError;
    expect(err.status).toBe(404);
    expect(err.body).toHaveLength(180);
  });

  it('wraps a network failure without a status', async () => {
    const { fetch } = sequence(new Error('connect ECONNREFUSED'));
    const err = (await upstreamFetch('OKX', 'https://www.okx.com/x', { fetch }).catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.status).toBeNull();
    expect(err.message).toContain('OKX');
    expect(err.message).toContain('ECONNREFUSED');
  });

  it('aborts the upstream fetch when the browser request closes', async () => {
    let seen: AbortSignal | undefined;
    const fetch = ((_url: string, init: RequestInit) => {
      seen = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => seen!.addEventListener('abort', () => reject(seen!.reason)));
    }) as unknown as FetchFn;
    const browser = new AbortController();
    const p = upstreamFetch('Binance', 'https://api.binance.com/x', { fetch, signal: browser.signal });
    const caught = p.catch((e: unknown) => e);
    browser.abort(new DOMException('closed', 'AbortError'));
    const err = await caught;
    expect(seen!.aborted).toBe(true);
    expect(err).not.toBeInstanceOf(UpstreamError);
  });

  it('times out after 25 s', async () => {
    vi.useFakeTimers();
    const fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => (init.signal as AbortSignal).addEventListener('abort', () => reject((init.signal as AbortSignal).reason)))) as unknown as FetchFn;
    const caught = upstreamFetch('Binance', 'https://api.binance.com/x', { fetch }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(25000);
    const err = (await caught) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.message).toMatch(/timed out after 25s/);
  });
});
