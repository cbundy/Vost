/**
 * One reconnecting upstream websocket for one feed: exponential backoff, a
 * mirror host after a few failures, a keepalive ping, and a slow retry after
 * it gave up. The WebSocket constructor and the timers are injected so tests
 * never open a socket or wait.
 */
import { formatClose, type Candle, type LiveLogEvent, type LiveStatusEvent } from '../../shared/market.ts';
import type { LiveFeed } from './feeds.ts';

/** Failed attempts in a row before the feed reports `error` and falls back to the slow retry. */
export const MAX_ATTEMPTS = 8;
/** Pause between attempts once the feed gave up. */
export const SLOW_RETRY_MS = 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(15000, 700 * 2 ** (attempts - 1));
}

/** The part of a WebSocket the upstream socket uses. */
export interface WsLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string; wasClean?: boolean }) => void) | null;
  send(data: string): void;
  close(): void;
}
export type WebSocketCtor = new (url: string) => WsLike;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface SocketOptions {
  feed: LiveFeed;
  /** Defaults to `globalThis.WebSocket`. */
  WebSocket?: WebSocketCtor;
  timers?: Timers;
  /** Short label for log lines, e.g. `BTCUSDT 1m`. */
  label: string;
  onStatus: (ev: LiveStatusEvent) => void;
  onKline: (candle: Candle, closed: boolean) => void;
  onLog: (ev: LiveLogEvent) => void;
  /** Called for every failed attempt with its description (feeds the relay's counters). */
  onFailure?: (text: string) => void;
}

export interface UpstreamSocket {
  close(): void;
}

export function openUpstream(opts: SocketOptions): UpstreamSocket {
  const { feed, label } = opts;
  const Ctor = opts.WebSocket ?? (globalThis.WebSocket as unknown as WebSocketCtor);
  const timers = opts.timers ?? realTimers;
  let ws: WsLike | null = null;
  let stopped = false;
  let attempts = 0;
  let usingFallback = false;
  let currentUrl = '';
  let retryTimer: unknown;
  let pingTimer: unknown;
  let lastStatus = '';

  const log = (severity: LiveLogEvent['severity'], text: string): void => opts.onLog({ severity, text });

  const status = (ev: LiveStatusEvent): void => {
    if (ev.status === lastStatus && ev.detail === undefined) return; // report changes only
    lastStatus = ev.status;
    opts.onStatus(ev);
  };

  const clearPing = (): void => {
    if (pingTimer !== undefined) timers.clearInterval(pingTimer);
    pingTimer = undefined;
  };

  const fail = (what: string): void => {
    attempts++;
    opts.onFailure?.(what);
    log('warning', `Live connection to ${currentUrl} failed (attempt ${attempts}): ${what}.`);
    if (feed.fallbackUrl && !usingFallback && attempts >= (feed.fallbackAfter ?? 3)) {
      usingFallback = true;
      log('warning', `Switching to the fallback stream host ${new URL(feed.fallbackUrl.replace(/^ws/, 'http')).host}.`);
    }
    if (attempts >= MAX_ATTEMPTS) {
      status({ status: 'error', detail: 'Live connection lost - see the inbox for details' });
      log(
        'error',
        `Giving up on live data for ${label} after ${attempts} attempts (last: ${currentUrl}). The exchange may be blocked in your region or by a firewall; retrying every ${SLOW_RETRY_MS / 1000} s.`,
      );
      retryTimer = timers.setTimeout(() => {
        log('info', `Retrying live data for ${label} (attempt ${attempts + 1}).`);
        connect();
      }, SLOW_RETRY_MS);
      return;
    }
    status({ status: 'reconnecting' });
    retryTimer = timers.setTimeout(connect, backoffMs(attempts));
  };

  const connect = (): void => {
    if (stopped) return;
    retryTimer = undefined;
    status({ status: attempts === 0 ? 'connecting' : 'reconnecting' });
    currentUrl = usingFallback && feed.fallbackUrl ? feed.fallbackUrl : feed.url;
    let sock: WsLike;
    try {
      sock = new Ctor(currentUrl);
    } catch (err) {
      fail(`could not open the socket: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      attempts = 0;
      status({ status: 'live' });
      try {
        if (feed.subscribe) sock.send(feed.subscribe);
      } catch {
        /* onclose handles it */
      }
      if (feed.pingMs && feed.ping !== undefined) {
        const ping = feed.ping;
        pingTimer = timers.setInterval(() => {
          try {
            sock.send(ping);
          } catch {
            /* onclose handles it */
          }
        }, feed.pingMs);
      }
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      let items: ReturnType<LiveFeed['parse']> = [];
      try {
        items = feed.parse(String(ev.data));
      } catch {
        /* ignore malformed frames */
      }
      for (const k of items) opts.onKline(k.candle, k.closed);
    };
    sock.onerror = () => {
      /* onclose carries the details and handles the retry */
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null;
      clearPing();
      if (stopped) return;
      fail(formatClose(ev));
    };
  };

  connect();

  return {
    close() {
      stopped = true;
      if (retryTimer !== undefined) timers.clearTimeout(retryTimer);
      retryTimer = undefined;
      clearPing();
      const sock = ws;
      ws = null;
      if (sock) {
        sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
        try {
          sock.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
