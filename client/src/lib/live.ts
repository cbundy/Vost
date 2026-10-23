/**
 * Live candle updates via public Binance websockets (no key, no account).
 * Binance's socket logic lives here; the other exchanges use ./liveSocket.ts
 * through their provider's `startLive`.
 * Reconnects with exponential backoff; falls back to data-stream host.
 */
import { binanceStreamFallbackUrl, binanceStreamUrl, BINANCE_INTERVALS } from './providers/binance';
import type { LiveHandle, LiveOptions, LiveStatus } from './providers/http';

export type { LiveHandle, LiveOptions, LiveStatus };

export function startBinanceLive(opts: LiveOptions): LiveHandle {
  const interval = BINANCE_INTERVALS[opts.timeframe];
  if (!interval) {
    opts.onStatus('error', `Live data does not support ${opts.timeframe}`);
    return { stop: () => undefined };
  }

  let ws: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let usingFallback = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const connect = (): void => {
    if (stopped) return;
    opts.onStatus(attempts === 0 ? 'connecting' : 'reconnecting');
    const url = usingFallback ? binanceStreamFallbackUrl(opts.symbol, interval) : binanceStreamUrl(opts.symbol, interval);
    try {
      ws = new WebSocket(url);
    } catch (err) {
      opts.onStatus('error', err instanceof Error ? err.message : String(err));
      return;
    }

    ws.onopen = () => {
      attempts = 0;
      opts.onStatus('live');
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as {
          k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean };
        };
        const k = data.k;
        if (!k) return;
        opts.onKline(
          {
            time: Math.floor(k.t / 1000),
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
          },
          k.x,
        );
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => {
      /* onclose handles retries */
    };

    ws.onclose = () => {
      if (stopped) return;
      attempts++;
      if (attempts >= 3 && !usingFallback) usingFallback = true;
      if (attempts > 8) {
        opts.onStatus('error', 'Live connection lost');
        return;
      }
      const delay = Math.min(15000, 700 * 2 ** (attempts - 1));
      retryTimer = setTimeout(connect, delay);
    };
  };

  connect();

  return {
    stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
      opts.onStatus('off');
    },
  };
}
