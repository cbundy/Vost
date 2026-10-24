/**
 * Live candle updates via public Binance websockets (no key, no account).
 * Binance's socket logic lives here; the other exchanges use ./liveSocket.ts
 * through their provider's `startLive`.
 * Reconnects with exponential backoff; falls back to data-stream host.
 */
import { formatClose } from './messages';
import { binanceStreamFallbackUrl, binanceStreamUrl, BINANCE_INTERVALS } from './providers/binance';
import type { LiveHandle, LiveOptions, LiveStatus } from './providers/http';

export type { LiveHandle, LiveOptions, LiveStatus };

export function startBinanceLive(opts: LiveOptions): LiveHandle {
  const interval = BINANCE_INTERVALS[opts.timeframe];
  if (!interval) {
    opts.onStatus('error', `Live data does not support ${opts.timeframe}`);
    opts.onLog?.('error', `Live data does not support timeframe ${opts.timeframe} for ${opts.symbol}.`);
    return { stop: () => undefined };
  }

  let ws: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let usingFallback = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let currentUrl = '';

  const connect = (): void => {
    if (stopped) return;
    opts.onStatus(attempts === 0 ? 'connecting' : 'reconnecting');
    const url = usingFallback ? binanceStreamFallbackUrl(opts.symbol, interval) : binanceStreamUrl(opts.symbol, interval);
    currentUrl = url;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.onStatus('error', msg);
      opts.onLog?.('error', `Could not open ${url}: ${msg}`);
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
      /* onclose handles retries and logging (browsers expose no error detail) */
    };

    ws.onclose = (ev) => {
      if (stopped) return;
      attempts++;
      opts.onLog?.('warning', `Live connection to ${currentUrl} failed (attempt ${attempts}): ${formatClose(ev)}.`);
      if (attempts >= 3 && !usingFallback) {
        usingFallback = true;
        opts.onLog?.('warning', 'Switching to the fallback stream host data-stream.binance.vision.');
      }
      if (attempts > 8) {
        opts.onStatus('error', 'Live connection lost - see the inbox for details');
        opts.onLog?.(
          'error',
          `Giving up on live data for ${opts.symbol} ${opts.timeframe} after ${attempts} attempts (last: ${currentUrl}). Binance may be blocked in your region or by a firewall.`,
        );
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
