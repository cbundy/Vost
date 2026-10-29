/**
 * Vost server - serves the built web client and the market-data API
 * (`/api/*`), which calls the public provider APIs on the browser's behalf,
 * and the live candle stream (`/api/live`), which shares one exchange
 * websocket per feed between all open tabs.
 *
 * Zero npm dependencies: only Node built-ins (>= 22.18, which runs this
 * TypeScript by type stripping). Started through `server/index.mjs`. Run with
 * `npm start` after `npm run build`, or use `npm run dev` for the Vite dev server.
 *
 * Env:
 *   PORT  (default 8787)
 *   HOST  (default 0.0.0.0)
 *   VOST_STATUS_INTERVAL  seconds between background health checks of the
 *                         exchanges (default 60; 0 turns them off)
 *   VOST_DATA_DIR  folder for the one file the server writes, alerts.json
 *                  (default <repo>/data; /data in the Docker image)
 *   VOST_ALERT_POLL  seconds between price polls for alerts on providers
 *                    without a live feed (default 60; minimum 10)
 *   VOST_TELEGRAM_BOT_TOKEN, VOST_TELEGRAM_CHAT_ID  both set: every alert that
 *                       fires is also sent to that Telegram chat (the token is a secret)
 *   VOST_TEST_UPSTREAM  test only: http://127.0.0.1:<port> of a fake market-data
 *                       service that every outbound call is rewritten to (see
 *                       docs/e2e-visual-verification.md). Refused when
 *                       NODE_ENV=production or when it is not a loopback URL.
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { createAlerts, isAlertsPath } from './alerts/index.ts';
import { createTelegram, readTelegramConfig } from './alerts/telegram.ts';
import { createApiDeps, handleApi } from './api.ts';
import { createRelay } from './live/relay.ts';
import { handleLive } from './live/route.ts';
import { openCandleStore } from './candles/store.ts';
import { sendJson } from './respond.ts';
import { handleStatus } from './status/route.ts';
import { createStatusService } from './status/scheduler.ts';
import { readTestUpstream, setTestUpstream } from './testUpstream.ts';

try {
  setTestUpstream(readTestUpstream(process.env));
} catch (err) {
  console.error(`Vost: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'client', 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

const TEXT_TYPES = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map', '.csv']);

let version = '0.0.0';
try {
  version = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0';
} catch {
  /* ignore */
}

/* --------------------------------- static -------------------------------- */

async function handleStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = url.pathname;
  }
  if (pathname === '/') pathname = '/index.html';

  let filePath = path.normalize(path.join(DIST, pathname));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const st = await stat(filePath);
    if (st.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    // Missing asset file (e.g. stale /assets/*.js) -> proper 404.
    const ext = path.extname(pathname).toLowerCase();
    if (ext && ext !== '.html' && ext !== '.htm') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    // SPA fallback for client-side routes; if dist is missing show setup help.
    const indexPath = path.join(DIST, 'index.html');
    try {
      await stat(indexPath);
      filePath = indexPath;
    } catch {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><body style="background:#09090b;color:#e8e8ed;font-family:system-ui;padding:40px;max-width:640px;margin:auto">
        <h1>Vost is running — but the client is not built yet</h1>
        <p>The market-data API is live at <code>/api/providers</code>. To build the web app:</p>
        <pre style="background:#111114;padding:14px;border-radius:8px">npm install
npm run build
npm start</pre>
        <p>…or, for development with hot reload: <code>npm run dev</code></p>
        </body></html>`,
      );
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  const isHashed = filePath.includes(`${path.sep}assets${path.sep}`);
  const cacheControl = isHashed ? 'public, max-age=31536000, immutable' : 'no-cache';
  const baseHeaders = {
    'content-type': type,
    'cache-control': cacheControl,
    'access-control-allow-origin': '*',
  };

  const wantsGzip = TEXT_TYPES.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  if (wantsGzip) {
    try {
      const buf = await readFile(filePath);
      const gz = zlib.gzipSync(buf);
      res.writeHead(200, { ...baseHeaders, 'content-encoding': 'gzip', 'content-length': gz.length });
      res.end(gz);
      return;
    } catch {
      /* fall through to streaming */
    }
  }

  try {
    const st = await stat(filePath);
    res.writeHead(200, { ...baseHeaders, 'content-length': st.size });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

/* --------------------------------- server -------------------------------- */

const relay = createRelay();
const intervalEnv = Number(process.env.VOST_STATUS_INTERVAL ?? 60);
const status = createStatusService({
  version,
  intervalSeconds: Number.isFinite(intervalEnv) && intervalEnv > 0 ? intervalEnv : 0,
  relayStats: () => relay.stats(),
  candleStats: () => candles.stats(),
});
const DATA_DIR = path.resolve(process.env.VOST_DATA_DIR || path.join(ROOT, 'data'));
const candles = await openCandleStore({ dir: DATA_DIR });
const apiDeps = createApiDeps({ candles, onOutcome: (provider, feed, result) => status.registry.record(provider, feed, result, 'traffic') });

const pollEnv = Number(process.env.VOST_ALERT_POLL ?? 60);
const telegramConfig = readTelegramConfig(process.env, (line) => console.warn(line));
const telegram = createTelegram({ config: telegramConfig, fetch: apiDeps.fetch, log: (line) => console.log(line) });
console.log(telegramConfig ? `[alerts] telegram on (chat ${telegramConfig.chatId})` : '[alerts] telegram off');
const alerts = await createAlerts({
  dataDir: DATA_DIR,
  telegram,
  pollSeconds: Number.isFinite(pollEnv) ? pollEnv : 60,
  relay,
  ctx: () => ({ fetch: apiDeps.fetch, symbols: apiDeps.symbols }),
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // Alerts are same-origin only: no CORS grant, not even on the preflight.
  if (isAlertsPath(url.pathname)) return void alerts.handle(req, res, url);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': '*',
    });
    res.end();
    return;
  }

  if (url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      name: 'vost',
      version,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      clientsBuilt: await stat(path.join(DIST, 'index.html')).then(() => true).catch(() => false),
    });
  }

  if (url.pathname === '/api/live') {
    return handleLive(req, res, url, relay);
  }

  if (url.pathname === '/api/status') {
    return void handleStatus(req, res, url, status);
  }

  if (url.pathname.startsWith('/api/')) {
    return void handleApi(req, res, url, apiDeps);
  }

  return void handleStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  ▲ Vost v${version} — self-hosted charts & backtesting`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → market data: /api/providers, /api/history, /api/symbols, /api/search, /api/status`);
  console.log(`  → live candles: /api/live`);
  console.log(`  → price alerts: /api/alerts (stored in ${DATA_DIR}; Telegram ${telegram.configured ? 'on' : 'off'})`);
  console.log(`  → candle store: ${`${candles.on ? 'on' : 'off'} (${candles.file})`}`);
  console.log('');
  status.scheduler.start();
});

const shutdown = (): void => {
  status.scheduler.stop();
  const saved = alerts.stop(); // drops its feeds, ends its streams, writes held prices
  relay.closeAll(); // ends the streams, so server.close does not wait on them
  candles.close();
  server.close(() => void saved.finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
