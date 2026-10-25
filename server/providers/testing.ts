/** Test helpers: a fake fetch that records the URLs it was asked for. Not imported by server code. */
import type { AdapterContext } from './types.ts';
import { createSymbolCache } from './symbolCache.ts';
import type { FetchFn } from './upstream.ts';

export interface FakeFetch {
  fetch: FetchFn;
  urls: string[];
}

/** `handler(url)` returns the JSON body (or a Response to control the status). */
export function fakeFetch(handler: (url: URL) => unknown): FakeFetch {
  const urls: string[] = [];
  const fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    const out = handler(url);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as FetchFn;
  return { fetch, urls };
}

export function ctxFor(fake: FakeFetch, signal?: AbortSignal): AdapterContext {
  return { fetch: fake.fetch, symbols: createSymbolCache(), signal };
}
