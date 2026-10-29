/**
 * A fake market-data service for the end-to-end captures and the tests behind
 * `VOST_TEST_UPSTREAM`. It serves, per original host (the first two path
 * segments are the scheme and the host, see server/testUpstream.ts), every
 * provider's REST payloads and the five live feeds' websocket frames.
 *
 * `stop()` closes the listener and terminates every open socket, so new
 * connects are refused; `start()` listens again on the same port.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { advanceTick } from './data.ts';
import { binanceSubscription, coinbaseSubscription, bybitSubscription, krakenSubscription, okxSubscription, subscribeAck, type Subscription } from './live.ts';
import { HYPERLIQUID_HOST, hyperliquidAck, hyperliquidInfo, hyperliquidSubscription } from './hyperliquid.ts';
import { REST_HOSTS } from './rest.ts';

/** How often every live socket gets a new frame. The brief wants one at least every second. */
export const PUSH_MS = 400;

export interface RecordedRequest {
  kind: 'http' | 'ws';
  scheme: string;
  /** The original upstream host, with its port when it had one. */
  host: string;
  /** Path and query as the server asked for them. */
  path: string;
  /** Set for HTTP requests other than GET. */
  method?: string;
  /** The request body, when there was one. */
  body?: string;
}

export interface FakeUpstream {
  /** `http://127.0.0.1:<port>`: the value for VOST_TEST_UPSTREAM. */
  url: string;
  port: number;
  /** Every request served, in order (cleared by nobody: slice it). */
  requests: RecordedRequest[];
  /** Closes the listener and terminates every socket. Resolves once new connects are refused. */
  stop(): Promise<void>;
  /** Listens again on the same port. */
  start(): Promise<void>;
  /** Stops for good. */
  close(): Promise<void>;
}

/** `/<scheme>/<host[:port]>/<rest>` -> its parts, or null. */
function split(rawUrl: string): { scheme: string; host: string; path: string } | null {
  const m = /^\/(https?|wss?)\/([^/?]+)(\/[^]*|\?[^]*)?$/.exec(rawUrl);
  if (!m) return null;
  return { scheme: m[1], host: m[2], path: m[3] ?? '/' };
}

const hostName = (host: string): string => host.replace(/:\d+$/, '');

function newSubscription(host: string, path: string, msg: unknown): Subscription | null {
  switch (hostName(host)) {
    case 'stream.binance.com':
    case 'data-stream.binance.vision':
      return binanceSubscription(path);
    case 'ws.kraken.com':
      return krakenSubscription(msg);
    case 'stream.bybit.com':
      return bybitSubscription(msg);
    case 'ws.okx.com':
      return okxSubscription(msg);
    case 'ws-feed.exchange.coinbase.com':
      return coinbaseSubscription(msg);
    case HYPERLIQUID_HOST:
      return hyperliquidSubscription(msg);
    default:
      return null;
  }
}

/** The POSTs the app makes: a Telegram send, and Hyperliquid's `/info`. */
function postReply(host: string, path: string, n: number, body: string): { status: number; body: unknown } {
  if (host === HYPERLIQUID_HOST && path === '/info') return hyperliquidInfo(body, Math.floor(Date.now() / 1000));
  if (host === 'api.telegram.org' && /^\/bot[^/]+\/sendMessage$/.test(path)) return { status: 200, body: { ok: true, result: { message_id: n } } };
  return { status: 404, body: { error: `the fake upstream has no POST ${host}${path}` } };
}

export async function startFakeUpstream(): Promise<FakeUpstream> {
  const requests: RecordedRequest[] = [];
  let server: http.Server | null = null;
  let wss: WebSocketServer | null = null;
  let pusher: ReturnType<typeof setInterval> | undefined;
  let port = 0;
  const subs = new Map<WebSocket, Subscription>();

  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const parts = split(req.url ?? '');
    if (!parts) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'expected /<scheme>/<host>/<path>' }));
      return;
    }
    const recorded: RecordedRequest = { kind: 'http', scheme: parts.scheme, host: parts.host, path: parts.path };
    requests.push(recorded);
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        recorded.method = 'POST';
        recorded.body = Buffer.concat(chunks).toString('utf8');
        const reply = postReply(hostName(parts.host), parts.path, requests.length, recorded.body);
        res.writeHead(reply.status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(reply.body));
      });
      return;
    }
    const handler = REST_HOSTS[hostName(parts.host)];
    if (!handler) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `the fake upstream does not know ${parts.host}` }));
      return;
    }
    const reply = handler(new URL(parts.path, 'http://fake'), Math.floor(Date.now() / 1000));
    const body = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    res.writeHead(reply.status ?? 200, { 'content-type': reply.type ?? 'application/json; charset=utf-8' }).end(body);
  };

  const onUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    const parts = split(req.url ?? '');
    if (!parts || !wss) {
      socket.destroy();
      return;
    }
    requests.push({ kind: 'ws', scheme: parts.scheme, host: parts.host, path: parts.path });
    const server = wss;
    server.handleUpgrade(req, socket, head, (ws) => {
      // Binance picks its stream by path; the others wait for a subscribe message.
      const fromPath = newSubscription(parts.host, parts.path, null);
      if (fromPath) subs.set(ws, fromPath);
      ws.on('close', () => subs.delete(ws));
      ws.on('error', () => subs.delete(ws));
      ws.on('message', (data) => {
        const text = data.toString();
        if (text === 'ping') return ws.send('pong'); // OKX
        let msg: unknown;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if ((msg as { method?: string }).method === 'ping') return ws.send(JSON.stringify({ channel: 'pong' })); // Hyperliquid
        if ((msg as { op?: string }).op === 'ping') return ws.send(JSON.stringify({ success: true, ret_msg: 'pong', op: 'ping' })); // Bybit
        const sub = newSubscription(parts.host, parts.path, msg);
        if (!sub) return;
        subs.set(ws, sub);
        const ack = hostName(parts.host) === HYPERLIQUID_HOST ? hyperliquidAck(msg) : subscribeAck(hostName(parts.host), msg);
        if (ack) ws.send(ack);
        ws.send(sub.frame(Math.floor(Date.now() / 1000))); // like a real feed: the current candle at once
      });
      const sub = subs.get(ws);
      if (sub) ws.send(sub.frame(Math.floor(Date.now() / 1000)));
    });
  };

  const listen = async (): Promise<void> => {
    const created = http.createServer(onRequest);
    created.on('upgrade', onUpgrade);
    await new Promise<void>((resolve, reject) => {
      created.once('error', reject);
      created.listen(port, '127.0.0.1', () => {
        created.off('error', reject);
        resolve();
      });
    });
    port = (created.address() as AddressInfo).port;
    server = created;
    wss = new WebSocketServer({ noServer: true });
    pusher = setInterval(() => {
      advanceTick();
      const nowSec = Math.floor(Date.now() / 1000);
      for (const [ws, sub] of subs) if (ws.readyState === ws.OPEN) ws.send(sub.frame(nowSec));
    }, PUSH_MS);
  };

  const stop = async (): Promise<void> => {
    const closing = server;
    const sockets = wss;
    server = null;
    wss = null;
    if (pusher !== undefined) clearInterval(pusher);
    pusher = undefined;
    if (!closing) return;
    for (const ws of sockets?.clients ?? []) ws.terminate();
    subs.clear();
    sockets?.close();
    closing.closeAllConnections();
    await new Promise<void>((resolve) => closing.close(() => resolve()));
  };

  await listen();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    stop,
    async start() {
      if (!server) await listen();
    },
    close: stop,
  };
}
