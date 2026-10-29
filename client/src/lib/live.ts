/**
 * Live candles from the Vost server: one same-origin EventSource per tab on
 * `/api/live?sub=<key>&sub=<key>...`, shared by every live chart. The server
 * owns the exchange connection, its retries and its log lines; this client
 * maps the tagged stream to each chart's provider callbacks, keeps itself
 * connected when the server or the network drops, and changes the set of
 * subscriptions make-before-break so the charts that stay are not interrupted.
 */
import { subKey, type LiveKlineEvent, type LiveLogEvent, type LiveStatusEvent } from '../../../shared/market.ts';
import type { LiveHandle, LiveOptions } from './providers/http';

export type { LiveHandle, LiveOptions };
export type { LiveStatus } from './providers/http';

/** Pause before reopening a stream the browser gave up on. */
export const SLOW_RETRY_MS = 60_000;

const LOST = 'Connection to the Vost server lost';

export interface LiveMuxDeps {
  EventSource?: typeof EventSource;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (t: ReturnType<typeof setTimeout>) => void;
  /** Runs `fn` after the current tick: subscribes and stops made meanwhile coalesce into one stream change. */
  schedule?: (fn: () => void) => void;
}

export interface LiveMux {
  subscribe(providerId: string, opts: LiveOptions): LiveHandle;
}

interface Sub {
  key: string;
  opts: LiveOptions;
  stopped: boolean;
  /** The server said this key can never be served. */
  dead: boolean;
}

interface Stream {
  es: EventSource;
  /** Keys the stream was opened with. */
  keys: Set<string>;
  open: boolean;
  closed: boolean;
}

export function createLiveMux(deps: LiveMuxDeps = {}): LiveMux {
  const ES = (): typeof EventSource => deps.EventSource ?? EventSource;
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((t) => clearTimeout(t));
  const schedule = deps.schedule ?? ((fn) => queueMicrotask(fn));

  const registry = new Map<string, Set<Sub>>();
  /** Keys the server refused, with its reason: left out of every stream. */
  const fatalKeys = new Map<string, string>();
  let current: Stream | null = null;
  let pending: Stream | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let scheduled = false;

  const live = (): Sub[] => [...registry.values()].flatMap((set) => [...set]);
  const wantedKeys = (): Set<string> => new Set([...registry.keys()].filter((k) => !fatalKeys.has(k)));

  const closeStream = (s: Stream | null): void => {
    if (!s) return;
    s.closed = true;
    s.es.close();
  };

  const requestRebuild = (): void => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      rebuild();
    });
  };

  const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((k) => b.has(k));

  const rebuild = (): void => {
    const want = wantedKeys();
    if (want.size === 0) {
      closeStream(pending);
      closeStream(current);
      pending = current = null;
      if (retryTimer) clearT(retryTimer);
      retryTimer = undefined;
      return;
    }
    const served = (s: Stream): Set<string> => new Set([...s.keys].filter((k) => !fatalKeys.has(k)));
    if (pending) {
      if (sameSet(served(pending), want)) return;
      closeStream(pending);
      pending = null;
    }
    if (current && sameSet(served(current), want)) return;
    if (retryTimer) clearT(retryTimer);
    retryTimer = undefined;
    openStream(want);
  };

  const openStream = (want: Set<string>): void => {
    const keys = [...want].sort();
    const url = `/api/live?${new URLSearchParams(keys.map((k) => ['sub', k]))}`;
    const stream: Stream = { es: new (ES())(url), keys: want, open: false, closed: false };
    const breaking = current !== null; // make-before-break: keep the old stream until this one opens
    if (breaking) pending = stream;
    else current = stream;
    const previous = current;

    const parse = <T>(ev: Event): T | null => {
      try {
        return JSON.parse(String((ev as MessageEvent).data)) as T;
      } catch {
        return null; // ignore a malformed event
      }
    };
    const targets = (sub: string | undefined): Sub[] =>
      sub === undefined ? [] : [...(registry.get(sub) ?? [])].filter((s) => !s.stopped && !s.dead);

    stream.es.onopen = () => {
      if (stream.closed) return;
      stream.open = true;
      if (pending === stream) {
        closeStream(current);
        current = stream;
        pending = null;
      }
    };
    stream.es.addEventListener('status', (ev) => {
      if (stream.closed) return;
      const d = parse<LiveStatusEvent>(ev);
      if (!d) return;
      if (d.fatal) {
        if (d.sub === undefined) return;
        const subs = targets(d.sub);
        fatalKeys.set(d.sub, d.detail ?? 'Live data is not available');
        for (const s of subs) {
          s.dead = true;
          s.opts.onStatus(d.status, d.detail);
        }
        // Close the stream only when nothing is left to serve.
        if (wantedKeys().size === 0) requestRebuild();
        return;
      }
      // While a replacement opens, the old stream speaks for the keys that stay.
      if (pending === stream && previous?.keys.has(d.sub ?? '')) return;
      for (const s of targets(d.sub)) s.opts.onStatus(d.status, d.detail);
    });
    stream.es.addEventListener('kline', (ev) => {
      if (stream.closed) return;
      const d = parse<LiveKlineEvent>(ev);
      if (d) for (const s of targets(d.sub)) s.opts.onKline(d.candle, d.closed);
    });
    stream.es.addEventListener('log', (ev) => {
      if (stream.closed) return;
      const d = parse<LiveLogEvent>(ev);
      if (d) for (const s of targets(d.sub)) s.opts.onLog?.(d.severity, d.text);
    });
    stream.es.onerror = () => {
      if (stream.closed) return;
      const gaveUp = stream.es.readyState === ES().CLOSED;
      if (pending === stream) {
        // A replacement that cannot open: the old stream keeps serving; try again slowly.
        if (gaveUp) {
          closeStream(stream);
          pending = null;
          retryTimer = setT(() => {
            retryTimer = undefined;
            requestRebuild();
          }, SLOW_RETRY_MS);
        }
        return;
      }
      if (current !== stream) return;
      if (gaveUp) {
        // The browser gave up (for example the server answered with an error): try again slowly.
        for (const s of live()) if (!s.dead) s.opts.onStatus('error', LOST);
        closeStream(stream);
        current = null;
        retryTimer = setT(() => {
          retryTimer = undefined;
          requestRebuild();
        }, SLOW_RETRY_MS);
      } else {
        // The browser reconnects by itself; the server then repeats the current status.
        for (const s of live()) if (!s.dead) s.opts.onStatus('reconnecting', LOST);
      }
    };
  };

  return {
    subscribe(providerId, opts) {
      const key = subKey(providerId, opts.timeframe, opts.source === 'built' ? 'built' : 'native', opts.symbol);
      const sub: Sub = { key, opts, stopped: false, dead: false };
      let set = registry.get(key);
      if (!set) registry.set(key, (set = new Set()));
      set.add(sub);
      const refused = fatalKeys.get(key);
      if (refused !== undefined) {
        sub.dead = true;
        opts.onStatus('error', refused);
      }
      requestRebuild();
      return {
        stop() {
          if (sub.stopped) return;
          sub.stopped = true;
          const subs = registry.get(key);
          subs?.delete(sub);
          if (subs?.size === 0) {
            registry.delete(key);
            fatalKeys.delete(key); // a later chart on this market may try again
          }
          opts.onStatus('off');
          requestRebuild();
        },
      };
    },
  };
}

const shared = createLiveMux();

export function startLiveApi(providerId: string, opts: LiveOptions): LiveHandle {
  return shared.subscribe(providerId, opts);
}
