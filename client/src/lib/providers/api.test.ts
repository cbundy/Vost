import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_CATALOG } from '../../../../shared/providerCatalog.ts';
import { demoProvider, providers } from './index';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(respond: (url: string) => Response): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      urls.push(String(input));
      return respond(String(input));
    }),
  );
  return urls;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const remote = providers.filter((p) => p.id !== demoProvider.id);

describe('provider registry', () => {
  it('builds one remote provider per catalog entry, in order, then the demo provider', () => {
    expect(providers.map((p) => p.id)).toEqual([...PROVIDER_CATALOG.map((p) => p.id), 'demo']);
  });
  it('mirrors the catalog capabilities', () => {
    for (const info of PROVIDER_CATALOG) {
      const p = providers.find((x) => x.id === info.id)!;
      expect(typeof p.listSymbols === 'function', info.id).toBe(info.hasSymbolList);
      expect(typeof p.searchSymbols === 'function', info.id).toBe(info.hasSearch);
      expect(p.timeframes).toEqual(info.timeframes);
    }
  });
});

describe('REST client', () => {
  it('every remote provider requests a same-origin /api/ URL for history, search and the list', async () => {
    const urls = stubFetch(() => json([]));
    for (const p of remote) {
      await p.fetchHistory({ symbol: 'X Y', timeframe: p.defaultTimeframe, bars: 10 });
      await p.searchSymbols?.('a b');
      await p.listSymbols?.();
    }
    expect(urls.length).toBeGreaterThanOrEqual(remote.length * 2);
    for (const u of urls) expect(u.startsWith('/api/'), u).toBe(true);
    expect(urls[0]).toBe('/api/history?provider=binance&symbol=X+Y&timeframe=1h&bars=10');
    expect(urls).toContain('/api/search?provider=kraken&q=a+b');
    expect(urls).toContain('/api/symbols?provider=stooq');
  });

  it('passes the abort signal on', async () => {
    stubFetch(() => json([]));
    const ac = new AbortController();
    await providers[0].fetchHistory({ symbol: 'X', timeframe: '1h', bars: 1 }, ac.signal);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ signal: ac.signal });
  });

  it("throws a non-2xx body's error message as the message", async () => {
    stubFetch(() => json({ error: 'Kraken: HTTP 503 - down' }, 502));
    await expect(providers[2].fetchHistory({ symbol: 'X', timeframe: '1h', bars: 1 })).rejects.toThrow('Kraken: HTTP 503 - down');
  });

  it('falls back to HTTP <status> when the error body is not JSON', async () => {
    stubFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(providers[0].searchSymbols!('x')).rejects.toThrow('HTTP 502');
  });
});

describe('history from/to', () => {
  it('puts from and to in the query only when set', async () => {
    const urls = stubFetch(() => json([]));
    const p = remote[0];
    await p.fetchHistory({ symbol: 'A', timeframe: p.defaultTimeframe, bars: 10 });
    await p.fetchHistory({ symbol: 'A', timeframe: p.defaultTimeframe, bars: 10, from: 100, to: 200 });
    await p.fetchHistory({ symbol: 'A', timeframe: p.defaultTimeframe, bars: 10, to: 200 });
    expect(urls[0]).not.toMatch(/[?&](from|to)=/);
    expect(urls[1]).toMatch(/from=100/);
    expect(urls[1]).toMatch(/to=200/);
    expect(urls[2]).not.toMatch(/from=/);
    expect(urls[2]).toMatch(/to=200/);
  });
});
