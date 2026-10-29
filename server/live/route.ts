/**
 * `GET /api/live?provider=&symbol=&timeframe=`: a server-sent-events stream of
 * `status`, `kline` and `log` events (wire types in shared/market.ts), fed by
 * the shared relay. A `: ping` comment every 15 s keeps proxies from closing it.
 *
 * `GET /api/live?sub=<key>&sub=<key>...` serves several subscriptions (up to
 * MAX_LIVE_SUBS) on one stream; every event carries `sub: <key>`. A key that
 * cannot be served gets one fatal status and the others keep streaming.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_LIVE_SUBS, parseSubKey, type ApiError } from '../../shared/market.ts';
import { sendJson } from '../respond.ts';
import { parseSource } from '../../shared/timeframes.ts';
import type { Relay } from './relay.ts';

export const HEARTBEAT_MS = 15_000;

export function handleLive(req: IncomingMessage, res: ServerResponse, url: URL, relay: Relay, heartbeatMs = HEARTBEAT_MS): void {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Only GET is supported' } satisfies ApiError);
  }
  const subs = [...new Set(url.searchParams.getAll('sub'))];
  if (subs.length > 0) return handleLiveSubs(res, subs, relay, heartbeatMs);
  const source = parseSource(url.searchParams.get('source'));
  if (source === null) {
    return sendJson(res, 400, { error: 'source must be native or built' } satisfies ApiError);
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
    { source },
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

/** The multiplexed form: one stream, one relay subscription per distinct key. */
function handleLiveSubs(res: ServerResponse, keys: string[], relay: Relay, heartbeatMs: number): void {
  if (keys.length > MAX_LIVE_SUBS) {
    return sendJson(res, 400, { error: `At most ${MAX_LIVE_SUBS} subscriptions per stream` } satisfies ApiError);
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
  });
  res.flushHeaders();

  const send = (event: string, data: object): void => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const unsubs: Array<() => void> = [];
  let alive = 0;
  const fail = (sub: string, detail: string): void => {
    send('status', { status: 'error', detail, fatal: true, sub });
  };
  for (const sub of keys) {
    const parsed = parseSubKey(sub);
    if (!parsed) {
      fail(sub, 'Malformed live subscription');
      continue;
    }
    // Events are copied with the tag: the relay shares one event object between subscribers.
    const result = relay.subscribe(
      parsed.provider,
      parsed.symbol,
      parsed.timeframe,
      {
        onStatus: (ev) => send('status', { ...ev, sub }),
        onKline: (ev) => send('kline', { ...ev, sub }),
        onLog: (ev) => send('log', { ...ev, sub }),
        onEnd: () => res.end(),
      },
      { source: parsed.source },
    );
    if ('error' in result) {
      fail(sub, result.error);
      continue;
    }
    alive++;
    unsubs.push(() => result.unsubscribe());
  }
  if (alive === 0) {
    res.end();
    return;
  }

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
  }, heartbeatMs);
  res.on('close', () => {
    clearInterval(heartbeat);
    for (const u of unsubs) u();
  });
}
