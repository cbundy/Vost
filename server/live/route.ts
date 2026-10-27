/**
 * `GET /api/live?provider=&symbol=&timeframe=`: a server-sent-events stream of
 * `status`, `kline` and `log` events (wire types in shared/market.ts), fed by
 * the shared relay. A `: ping` comment every 15 s keeps proxies from closing it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiError } from '../../shared/market.ts';
import { sendJson } from '../respond.ts';
import type { Relay } from './relay.ts';

export const HEARTBEAT_MS = 15_000;

export function handleLive(req: IncomingMessage, res: ServerResponse, url: URL, relay: Relay, heartbeatMs = HEARTBEAT_MS): void {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Only GET is supported' } satisfies ApiError);
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
  });
  res.flushHeaders();

  const send = (event: string, data: unknown): void => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const result = relay.subscribe(
    url.searchParams.get('provider') ?? '',
    url.searchParams.get('symbol') ?? '',
    url.searchParams.get('timeframe') ?? '',
    {
      onStatus: (ev) => send('status', ev),
      onKline: (ev) => send('kline', ev),
      onLog: (ev) => send('log', ev),
      onEnd: () => res.end(),
    },
  );
  if ('error' in result) {
    send('status', { status: 'error', detail: result.error, fatal: true });
    res.end();
    return;
  }

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
  }, heartbeatMs);
  res.on('close', () => {
    clearInterval(heartbeat);
    result.unsubscribe();
  });
}
