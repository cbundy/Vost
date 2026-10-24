/**
 * Reconnecting websocket used by the exchange providers' `startLive`.
 * Exponential backoff, optional keepalive ping. Binance has its own
 * implementation in ./live.ts (it also falls back to a mirror host).
 */
import type { Candle } from '../types';
import type { LiveHandle, LiveOptions } from './providers/http';

export interface ParsedKline {
  candle: Candle;
  closed: boolean;
}

export interface LiveSocketConfig extends Pick<LiveOptions, 'onKline' | 'onStatus'> {
  url: string;
  /** Called on every (re)connect, typically to send the subscribe message. */
  onOpen?: (ws: WebSocket) => void;
  /** Maps one raw frame to zero or more candles; throw or return [] to ignore. */
  parse: (raw: string) => ParsedKline[];
  /** Keepalive: send `ping()` every `pingMs` while open. */
  pingMs?: number;
  ping?: () => string;
}

export function startLiveSocket(cfg: LiveSocketConfig): LiveHandle {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const connect = (): void => {
    if (stopped) return;
    cfg.onStatus(attempts === 0 ? 'connecting' : 'reconnecting');
    try {
      ws = new WebSocket(cfg.url);
    } catch (err) {
      cfg.onStatus('error', err instanceof Error ? err.message : String(err));
      return;
    }
    const sock = ws;
    sock.onopen = () => {
      attempts = 0;
      cfg.onStatus('live');
      try {
        cfg.onOpen?.(sock);
      } catch {
        /* ignore */
      }
      if (cfg.pingMs && cfg.ping) {
        pingTimer = setInterval(() => {
          try {
            sock.send(cfg.ping!());
          } catch {
            /* onclose handles it */
          }
        }, cfg.pingMs);
      }
    };
    sock.onmessage = (ev) => {
      let items: ParsedKline[] = [];
      try {
        items = cfg.parse(String(ev.data));
      } catch {
        /* ignore malformed frames */
      }
      for (const k of items) cfg.onKline(k.candle, k.closed);
    };
    sock.onerror = () => {
      /* onclose handles retries */
    };
    sock.onclose = () => {
      if (pingTimer) clearInterval(pingTimer);
      if (stopped) return;
      attempts++;
      if (attempts > 8) {
        cfg.onStatus('error', 'Live connection lost');
        return;
      }
      retryTimer = setTimeout(connect, Math.min(15000, 700 * 2 ** (attempts - 1)));
    };
  };

  connect();

  return {
    stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
      cfg.onStatus('off');
    },
  };
}

/** Handle for a timeframe the exchange's live channel does not offer. */
export function unsupportedLive(opts: Pick<LiveOptions, 'onStatus'>, timeframe: string): LiveHandle {
  opts.onStatus('error', `Live data does not support ${timeframe}`);
  return { stop: () => undefined };
}
