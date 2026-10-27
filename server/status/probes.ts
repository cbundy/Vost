/**
 * The active probes: one small real request per (provider, feed). Each is
 * bounded by its own timeout and never throws; it returns a `CheckResult`.
 */
import { formatClose } from '../../shared/market.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import type { StatusFeed } from '../../shared/status.ts';
import { liveFeed } from '../live/feeds.ts';
import { realTimers, type Timers, type WebSocketCtor, type WsLike } from '../live/socket.ts';
import { adapters } from '../providers/index.ts';
import type { SymbolCache } from '../providers/symbolCache.ts';
import type { FetchFn } from '../providers/upstream.ts';
import type { CheckResult } from './registry.ts';

export const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeEnv {
  /** Defaults to `globalThis.fetch`. */
  fetch?: FetchFn;
  /** Defaults to `globalThis.WebSocket`. */
  WebSocket?: WebSocketCtor;
  timers?: Timers;
  timeoutMs?: number;
  now?: () => number;
}

/** Never reads nor fills a cache: a probe must reach the exchange, not a 24 h old list. */
const passThrough: SymbolCache = { get: (_key, load) => load(), clear: () => undefined };

const timeoutText = (ms: number): string => `timed out after ${ms / 1000} s`;

/** Runs `call` with an AbortSignal that fires after the timeout. */
async function restProbe(env: ProbeEnv, call: (signal: AbortSignal) => Promise<unknown>): Promise<CheckResult> {
  const timers = env.timers ?? realTimers;
  const now = env.now ?? Date.now;
  const timeoutMs = env.timeoutMs ?? PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  // Raced as well as signalled: an adapter that drops the signal must not outlive the timeout.
  let expire: (err: Error) => void = () => undefined;
  const expired = new Promise<never>((_, reject) => (expire = reject));
  const timer = timers.setTimeout(() => {
    timedOut = true;
    controller.abort();
    expire(new Error(timeoutText(timeoutMs)));
  }, timeoutMs);
  const started = now();
  try {
    await Promise.race([call(controller.signal), expired]);
    return { ok: true, latencyMs: now() - started };
  } catch (err) {
    const latencyMs = now() - started;
    if (timedOut) return { ok: false, error: timeoutText(timeoutMs), latencyMs };
    return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs };
  } finally {
    timers.clearTimeout(timer);
  }
}

export function probeHistory(provider: string, env: ProbeEnv = {}): Promise<CheckResult> {
  const info = catalogEntry(provider);
  const adapter = adapters.get(provider);
  if (!info || !adapter) return Promise.resolve({ ok: false, error: `Unknown provider "${provider}"` });
  return restProbe(env, (signal) =>
    adapter.history({ fetch: env.fetch, symbols: passThrough, signal }, { symbol: info.defaultSymbol, timeframe: info.defaultTimeframe, bars: 2 }),
  );
}

export function probeSymbols(provider: string, env: ProbeEnv = {}): Promise<CheckResult> {
  const info = catalogEntry(provider);
  const adapter = adapters.get(provider);
  if (!info || !adapter) return Promise.resolve({ ok: false, error: `Unknown provider "${provider}"` });
  return restProbe(env, (signal) => adapter.search({ fetch: env.fetch, symbols: passThrough, signal }, info.defaultSymbol));
}

/** Opens the feed's socket, succeeds on the first frame and always closes it again. */
export function probeLive(provider: string, env: ProbeEnv = {}): Promise<CheckResult> {
  const info = catalogEntry(provider);
  if (!info) return Promise.resolve({ ok: false, error: `Unknown provider "${provider}"` });
  const built = liveFeed(provider, info.defaultSymbol, info.defaultTimeframe);
  if ('error' in built) return Promise.resolve({ ok: false, error: built.error });
  const { feed } = built;
  const Ctor = env.WebSocket ?? (globalThis.WebSocket as unknown as WebSocketCtor);
  const timers = env.timers ?? realTimers;
  const now = env.now ?? Date.now;
  const timeoutMs = env.timeoutMs ?? PROBE_TIMEOUT_MS;
  const started = now();

  return new Promise<CheckResult>((resolve) => {
    let sock: WsLike | null = null;
    let opened = false;
    let done = false;
    const finish = (result: CheckResult): void => {
      if (done) return;
      done = true;
      timers.clearTimeout(timer);
      if (sock) {
        sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
        try {
          sock.close();
        } catch {
          /* ignore */
        }
      }
      resolve(result);
    };
    const timer = timers.setTimeout(() => {
      finish(
        opened
          ? { ok: false, partial: true, error: `connected but sent no data within ${timeoutMs / 1000} s`, latencyMs: now() - started }
          : { ok: false, error: timeoutText(timeoutMs), latencyMs: now() - started },
      );
    }, timeoutMs);
    try {
      sock = new Ctor(feed.url);
    } catch (err) {
      return finish({ ok: false, error: `could not open the socket: ${err instanceof Error ? err.message : String(err)}` });
    }
    sock.onopen = () => {
      opened = true;
      try {
        if (feed.subscribe) sock?.send(feed.subscribe);
      } catch {
        /* onclose reports it */
      }
    };
    sock.onmessage = () => finish({ ok: true, latencyMs: now() - started });
    sock.onerror = () => {
      /* onclose carries the details */
    };
    sock.onclose = (ev) => finish({ ok: false, error: formatClose(ev), latencyMs: now() - started });
  });
}

export function runProbe(provider: string, feed: StatusFeed, env: ProbeEnv = {}): Promise<CheckResult> {
  if (feed === 'history') return probeHistory(provider, env);
  if (feed === 'symbols') return probeSymbols(provider, env);
  return probeLive(provider, env);
}
