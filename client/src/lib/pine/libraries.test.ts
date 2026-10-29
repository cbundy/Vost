import { describe, expect, it } from 'vitest';
import { createServerResolver, libraryMessage, libraryUrl } from './libraries';

const reply = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof globalThis.fetch;
const make = (fetch: typeof globalThis.fetch) => createServerResolver({ origin: 'http://vost.test', fetch });

describe('server resolver', () => {
  it('gets the source from the Vost server', async () => {
    const urls: string[] = [];
    const r = make((async (u: string) => (urls.push(u), Response.json({ path: 'a/B/1', source: 'SRC' }))) as unknown as typeof globalThis.fetch);
    expect(await r.resolve('a/B/1')).toBe('SRC');
    expect(urls).toEqual(['http://vost.test/api/pine/libraries/a/B/1']);
    expect(r.misses.size).toBe(0);
  });

  it('records not-found and closed-source from a 404', async () => {
    const a = make(reply(404, { error: 'x', reason: 'not-found' }));
    expect(await a.resolve('a/B/1')).toBeNull();
    expect(a.misses.get('a/B/1')?.reason).toBe('not-found');
    const b = make(reply(404, { error: 'x', reason: 'closed-source' }));
    await b.resolve('a/B/1');
    expect(b.misses.get('a/B/1')?.reason).toBe('closed-source');
  });

  it('records a 502 and a network error as server errors', async () => {
    const a = make(reply(502, { error: 'TradingView is down' }));
    expect(await a.resolve('a/B/1')).toBeNull();
    expect(a.misses.get('a/B/1')).toMatchObject({ reason: 'server-error', detail: 'TradingView is down' });
    const b = make((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch);
    expect(await b.resolve('a/B/1')).toBeNull();
    expect(b.misses.get('a/B/1')).toMatchObject({ reason: 'server-error', detail: 'fetch failed' });
  });

  it('records no-server when there is no origin', async () => {
    const r = createServerResolver({ origin: null });
    expect(await r.resolve('a/B/1')).toBeNull();
    expect(r.misses.get('a/B/1')?.reason).toBe('no-server');
  });

  it('a fresh resolver finds a library pasted after a miss', async () => {
    let stored: string | null = null;
    const fetch = (async () => (stored ? Response.json({ source: stored }) : Response.json({ error: 'x', reason: 'closed-source' }, { status: 404 }))) as unknown as typeof globalThis.fetch;
    const first = make(fetch);
    expect(await first.resolve('a/B/1')).toBeNull();
    stored = 'PASTED';
    expect(await make(fetch).resolve('a/B/1')).toBe('PASTED');
  });

  it('builds the URL and the plain messages', () => {
    expect(libraryUrl('http://h', 'a/B/1')).toBe('http://h/api/pine/libraries/a/B/1');
    expect(libraryMessage('a/B/1', { path: 'a/B/1', reason: 'closed-source' })).toBe('Library "a/B/1" could not be loaded: TradingView has no open-source copy of it. Paste its source under Pine libraries.');
  });
});
