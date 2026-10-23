#!/usr/bin/env node
/**
 * Vost server — serves the built web client and a tiny whitelisted proxy for
 * public market-data APIs (needed because Yahoo/Stooq send no CORS headers).
 *
 * Zero npm dependencies: only Node >= 20 built-ins. Run with `npm start` after
 * `npm run build`, or use `npm run dev` for the Vite dev server.
 *
 * Env:
 *   PORT  (default 8787)
 *   HOST  (default 0.0.0.0)
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'client', 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

/** Only these upstream hosts can be reached through /api/proxy. */
const ALLOWED_HOSTS = new Set([
  'api.binance.com',
  'api1.binance.com',
  'api2.binance.com',
  'api3.binance.com',
  'api4.binance.com',
  'data-api.binance.vision',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'stooq.com',
  'stooq.pl',
  'api.exchange.coinbase.com',
  'api.kraken.com',
  'api.bybit.com',
  'www.okx.com',
]);

// A minimal, widely-accepted user-agent. Yahoo's edge rejects both empty UAs
// and over-specific (headless-looking) Chrome strings from datacenter IPs.
const BROWSER_UA = 'Mozilla/5.0';

/** Upstream statuses worth retrying once or twice (rate limits / transient 5xx). */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

const MIME = {
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

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/* --------------------------------- proxy --------------------------------- */

async function handleProxy(req, res, url) {
  const target = url.searchParams.get('url');
  if (!target) {
    return sendJson(res, 400, { error: 'Missing ?url= parameter' });
  }
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return sendJson(res, 400, { error: 'Malformed url parameter' });
  }
  if (parsed.protocol !== 'https:') {
    return sendJson(res, 400, { error: 'Only https:// upstreams are allowed' });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return sendJson(res, 403, {
      error: `Host "${parsed.hostname}" is not in the Vost proxy allowlist. Add it to ALLOWED_HOSTS in server/index.mjs if you trust it.`,
      allowed: [...ALLOWED_HOSTS],
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    let upstream;
    const delays = [0, 600, 1500];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
      upstream = await fetch(parsed, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'user-agent': BROWSER_UA,
          accept: 'application/json, text/csv, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
        },
      });
      if (!RETRY_STATUSES.has(upstream.status)) break;
    }
    const headers = {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'x-vost-proxy': parsed.hostname,
    };
    res.writeHead(upstream.status, headers);
    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError' ? 'Upstream timed out after 25s' : String(err?.message ?? err);
    if (!res.headersSent) sendJson(res, 502, { error: `Upstream fetch failed: ${message}` });
    else res.end();
  } finally {
    clearTimeout(timeout);
  }
}

/* --------------------------------- static -------------------------------- */

async function handleStatic(req, res, url) {
  let pathname;
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
        <p>The API proxy is live at <code>/api/proxy?url=…</code>. To build the web app:</p>
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

  if (url.pathname === '/api/proxy') {
    return void handleProxy(req, res, url);
  }

  if (url.pathname.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'Unknown API route. Try /api/health or /api/proxy?url=…' });
  }

  return void handleStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  const distBuilt = true; // advertised lazily; message is informational only
  console.log('');
  console.log(`  \u25B2 Vost v${version} — self-hosted charts & backtesting`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → proxy: /api/proxy?url=… (allowlist: ${ALLOWED_HOSTS.size} hosts)`);
  if (!distBuilt) console.log('  ! client bundle missing — run `npm run build`');
  console.log('');
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
