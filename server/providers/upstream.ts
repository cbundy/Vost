/**
 * The one fetch helper every adapter uses to call a public market-data API.
 * Sends a minimal, widely-accepted user-agent (Yahoo's edge rejects empty and
 * over-specific ones), retries rate limits and transient 5xx, times out, and
 * turns every failure into an `UpstreamError`.
 */
import { UpstreamError } from './errors.ts';

export type FetchFn = typeof globalThis.fetch;

const USER_AGENT = 'Mozilla/5.0';
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
/** Delay before each attempt, in ms: three attempts in all. */
export const RETRY_DELAYS_MS = [0, 600, 1500];
export const TIMEOUT_MS = 25000;

export interface UpstreamContext {
  /** Defaults to `globalThis.fetch`; tests inject a fake. */
  fetch?: FetchFn;
  /** Aborted when the browser request closes. */
  signal?: AbortSignal;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

/** Resolves after `ms`, or rejects with the signal's reason when it aborts first. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * GET `url` (retrying, with a 25 s timeout that also covers reading the body
 * through `read`) and return what `read` makes of the 2xx response. A non-2xx
 * status raises an `UpstreamError` carrying the provider, host, status and the
 * start of the body. A browser abort is rethrown as is (never wrapped).
 */
async function request<T>(provider: string, url: string, ctx: UpstreamContext, read: (res: Response) => Promise<T>): Promise<T> {
  const doFetch = ctx.fetch ?? globalThis.fetch;
  const host = new URL(url).hostname;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException('timed out', 'TimeoutError')), TIMEOUT_MS);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout.signal]) : timeout.signal;

  try {
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay > 0) await sleep(delay, signal);
      const res = await doFetch(url, {
        signal,
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json, text/csv, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
        },
      });
      if (res.ok) return await read(res);
      const last = attempt === RETRY_DELAYS_MS.length - 1;
      if (RETRY_STATUSES.has(res.status) && !last) {
        console.warn(`[upstream] ${provider} ${host} HTTP ${res.status}, retrying (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      const body = (await res.text().catch(() => '')).slice(0, 180).replace(/\s+/g, ' ').trim();
      throw new UpstreamError(provider, host, res.status, body || res.statusText);
    }
    /* unreachable: the last attempt always returns or throws */
    throw new UpstreamError(provider, host, null, 'upstream unavailable');
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (ctx.signal?.aborted) throw err; // the browser went away
    if (isAbort(err)) throw new UpstreamError(provider, host, null, `upstream timed out after ${TIMEOUT_MS / 1000}s`);
    throw new UpstreamError(provider, host, null, `upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

export function upstreamFetch(provider: string, url: string, ctx: UpstreamContext = {}): Promise<Response> {
  return request(provider, url, ctx, async (res) => res);
}

export function upstreamJson<T>(provider: string, url: string, ctx: UpstreamContext = {}): Promise<T> {
  return request(provider, url, ctx, async (res) => {
    try {
      return (await res.json()) as T;
    } catch (err) {
      if (isAbort(err)) throw err;
      throw new UpstreamError(provider, new URL(url).hostname, res.status, 'upstream answered with invalid JSON');
    }
  });
}

export function upstreamText(provider: string, url: string, ctx: UpstreamContext = {}): Promise<string> {
  return request(provider, url, ctx, (res) => res.text());
}
