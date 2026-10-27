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
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { createApiDeps, handleApi } from './api.ts';
import { createRelay } from './live/relay.ts';
import { handleLive } from './live/route.ts';
import { sendJson } from './respond.ts';

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
        `<!doctype html><html><body style="background:#0b0e14;color:#e6ebf5;font-family:system-ui;padding:40px;max-width:640px;margin:auto">
        <h1>Vost is running — but the client is not built yet</h1>
        <p>The market-data API is live at <code>/api/providers</code>. To build the web app:</p>
        <pre style="background:#11151f;padding:14px;border-radius:8px">npm install
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

const apiDeps = createApiDeps();
const relay = createRelay();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

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

  if (url.pathname.startsWith('/api/')) {
    return void handleApi(req, res, url, apiDeps);
  }

  return void handleStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  ▲ Vost v${version} — self-hosted charts & backtesting`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → market data: /api/providers, /api/history, /api/symbols, /api/search`);
  console.log(`  → live candles: /api/live`);
  console.log('');
});

const shutdown = (): void => {
  relay.closeAll(); // ends the streams, so server.close does not wait on them
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
