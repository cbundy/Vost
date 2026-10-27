/**
 * Live candles from the Vost server: one same-origin EventSource on
 * `/api/live`. The server owns the exchange connection, its retries and its
 * log lines; this client only maps the stream to the provider callbacks and
 * keeps itself connected when the server or the network drops.
 */
import type { LiveKlineEvent, LiveLogEvent, LiveStatusEvent } from '../../../shared/market.ts';
import type { LiveHandle, LiveOptions } from './providers/http';

export type { LiveHandle, LiveOptions };
export type { LiveStatus } from './providers/http';

/** Pause before reopening a stream the browser gave up on. */
export const SLOW_RETRY_MS = 60_000;

const LOST = 'Connection to the Vost server lost';

export function startLiveApi(providerId: string, opts: LiveOptions): LiveHandle {
  const url = `/api/live?${new URLSearchParams({ provider: providerId, symbol: opts.symbol, timeframe: opts.timeframe })}`;
  let es: EventSource | null = null;
  let stopped = false;
  let fatal = false;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;

  const parse = <T>(ev: Event): T | null => {
    try {
      return JSON.parse(String((ev as MessageEvent).data)) as T;
    } catch {
      return null; // ignore a malformed event
    }
  };

  const open = (): void => {
    reopenTimer = undefined;
    if (stopped) return;
    const source = new EventSource(url);
    es = source;
    source.addEventListener('status', (ev) => {
      const d = parse<LiveStatusEvent>(ev);
      if (!d || stopped) return;
      opts.onStatus(d.status, d.detail);
      if (d.fatal) {
        fatal = true;
        source.close(); // the server says this request can never work: no retry
      }
    });
    source.addEventListener('kline', (ev) => {
      const d = parse<LiveKlineEvent>(ev);
      if (d && !stopped) opts.onKline(d.candle, d.closed);
    });
    source.addEventListener('log', (ev) => {
      const d = parse<LiveLogEvent>(ev);
      if (d && !stopped) opts.onLog?.(d.severity, d.text);
    });
    source.onerror = () => {
      if (stopped || fatal || es !== source) return;
      if (source.readyState === EventSource.CLOSED) {
        // The browser gave up (for example the server answered with an error): try again slowly.
        opts.onStatus('error', LOST);
        source.close();
        reopenTimer = setTimeout(open, SLOW_RETRY_MS);
      } else {
        // The browser reconnects by itself; the server then repeats the current status.
        opts.onStatus('reconnecting', LOST);
      }
    };
  };

  open();

  return {
    stop() {
      stopped = true;
      if (reopenTimer) clearTimeout(reopenTimer);
      es?.close();
      es = null;
      opts.onStatus('off');
    },
  };
}
