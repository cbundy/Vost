/**
 * Backend probe for the UI audit (docs/spikes/ui-audit/README.md). Run from the repo root:
 *
 *   timeout 300 node docs/spikes/ui-audit/probes/server-probe.ts
 *
 * It starts the fake market-data service (e2e/fake-upstream) and `server/index.mjs` on a free 127.0.0.1 port with
 * VOST_TEST_UPSTREAM, sends odd requests, writes docs/spikes/ui-audit/raw/server-probe.txt, stops both and exits.
 * A second server is pointed at a socket that never answers, to measure the upstream timeout. Every request has
 * its own timeout. Nothing here reaches the real network. Node 22.18+ (type stripping): erasable TypeScript only.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeUpstream } from '../../../../e2e/fake-upstream/index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const OUT = path.join(ROOT, 'docs', 'spikes', 'ui-audit', 'raw', 'server-probe.txt');
const lines: string[] = [];
const say = (s = ''): void => {
  lines.push(s);
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
  });
}

async function startServer(upstream: string): Promise<{ child: ChildProcess; base: string; log: () => string }> {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', VOST_STATUS_INTERVAL: '0', VOST_TEST_UPSTREAM: upstream },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d) => (out += d));
  child.stderr?.on('data', (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${out}`);
    try {
      if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('server not healthy within 15 s');
    await new Promise((r) => setTimeout(r, 150));
  }
  return { child, base, log: () => out };
}

async function stop(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const t = setTimeout(() => child.kill('SIGKILL'), 4000);
  await exited(child);
  clearTimeout(t);
}

interface Reply {
  status: number | string;
  type: string;
  ms: number;
  body: string;
}

/** A GET (or other method) with a hard timeout. `rawPath` goes on the wire as written (fetch would normalise `..`). */
function raw(base: string, rawPath: string, method = 'GET', timeoutMs = 8000, headers: Record<string, string> = {}): Promise<Reply> {
  const started = Date.now();
  const u = new URL(base);
  return new Promise((resolve) => {
    const req = http.request({ host: u.hostname, port: u.port, path: rawPath, method, headers, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        if (body.length < 4000) body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), ms: Date.now() - started, body }));
      res.on('error', (e) => resolve({ status: `error ${e.message}`, type: '', ms: Date.now() - started, body }));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: `timeout after ${timeoutMs} ms`, type: '', ms: Date.now() - started, body: '' });
    });
    req.on('error', (e) => resolve({ status: `error ${e.message}`, type: '', ms: Date.now() - started, body: '' }));
    req.end();
  });
}

const short = (s: string, n = 140): string => s.replace(/\s+/g, ' ').trim().slice(0, n);

let seen: () => string = () => '';

async function show(base: string, label: string, rawPath: string, method = 'GET', withUpstream = false): Promise<Reply> {
  const r = await raw(base, rawPath, method);
  const isHtml = r.type.startsWith('text/html');
  say(`${label}`);
  say(`    ${method} ${rawPath.length > 110 ? `${rawPath.slice(0, 110)}... (${rawPath.length} chars)` : rawPath}`);
  say(`    -> ${r.status} ${r.type} ${r.ms} ms  ${isHtml ? '(html page)' : short(r.body)}`);
  if (withUpstream) say(`    the upstream was asked for: ${seen()}`);
  return r;
}

/** Opens `/api/live` and reads for `ms`, then closes. */
function live(base: string, query: string, ms = 1500, method = 'GET'): Promise<{ status: number | string; events: string[]; bytes: number }> {
  const u = new URL(base);
  return new Promise((resolve) => {
    const events: string[] = [];
    let bytes = 0;
    let status: number | string = 'no response';
    const req = http.request({ host: u.hostname, port: u.port, path: `/api/live${query}`, method }, (res) => {
      status = res.statusCode ?? 0;
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        bytes += c.length;
        for (const m of c.matchAll(/event: (\w+)\ndata: (.*)\n/g)) if (events.length < 4) events.push(`${m[1]} ${short(m[2], 90)}`);
      });
    });
    req.on('error', () => undefined);
    req.end();
    setTimeout(() => {
      req.destroy();
      resolve({ status, events, bytes });
    }, ms);
  });
}

const stage = async (name: string, fn: () => Promise<void>): Promise<void> => {
  say('');
  say(`## ${name}`);
  try {
    await fn();
  } catch (err) {
    say(`    PROBE ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
};

async function main(): Promise<void> {
  const upstream = await startFakeUpstream();
  let main: Awaited<ReturnType<typeof startServer>> | null = null;
  let hole: Awaited<ReturnType<typeof startServer>> | null = null;
  const sockets = new Set<net.Socket>();
  const blackhole = net.createServer((s) => {
    sockets.add(s);
    s.on('error', () => undefined);
    s.on('close', () => sockets.delete(s));
  });
  const sibling = path.join(ROOT, 'client', 'dist-probe');
  try {
    main = await startServer(upstream.url);
    seen = () => short(upstream.requests.at(-1)?.path ?? '(nothing)', 200);
    const base = main.base;
    say(`Vost server probe, ${new Date().toISOString().slice(0, 10)}, node ${process.version}`);
    say(`server ${base} -> fake upstream ${upstream.url}; the real network is never used`);

    await stage('API: provider and symbol parameters', async () => {
      await show(base, 'unknown provider', '/api/history?provider=nope&symbol=X&timeframe=1h&bars=10');
      await show(base, 'no provider', '/api/history?symbol=X&timeframe=1h&bars=10');
      await show(base, 'provider in another case', '/api/history?provider=BINANCE&symbol=BTCUSDT&timeframe=1h&bars=10');
      await show(base, 'missing symbol', '/api/history?provider=binance&timeframe=1h&bars=10');
      await show(base, 'blank symbol', '/api/history?provider=binance&symbol=%20%20&timeframe=1h&bars=10');
      await show(base, 'symbol that no exchange lists (the fake upstream answers any symbol)', '/api/history?provider=binance&symbol=ZZZZNOPE&timeframe=1h&bars=3');
      await show(base, 'symbol with path characters', '/api/history?provider=binance&symbol=..%2F..%2Fetc%2Fpasswd&timeframe=1h&bars=3', 'GET', true);
      await show(base, 'symbol with a query-string injection', '/api/history?provider=binance&symbol=BTCUSDT%26limit%3D1&timeframe=1h&bars=3', 'GET', true);
      await show(base, 'symbol with a NUL byte', '/api/history?provider=binance&symbol=BTC%00USDT&timeframe=1h&bars=3', 'GET', true);
      await show(base, 'symbol of 5000 characters', `/api/history?provider=binance&symbol=${'A'.repeat(5000)}&timeframe=1h&bars=3`);
      await show(base, 'symbol of 20000 characters (header size)', `/api/history?provider=binance&symbol=${'A'.repeat(20000)}&timeframe=1h&bars=3`);
      await show(base, 'unicode symbol', `/api/history?provider=binance&symbol=${encodeURIComponent('比特币')}&timeframe=1h&bars=3`);
      await show(base, 'symbol given twice', '/api/history?provider=binance&symbol=BTCUSDT&symbol=ETHUSDT&timeframe=1h&bars=3');
      await show(base, 'stooq symbol with a space', '/api/history?provider=stooq&symbol=a%20b&timeframe=1d&bars=3', 'GET', true);
      await show(base, 'yahoo symbol with a slash', '/api/history?provider=yahoo&symbol=A%2FB&timeframe=1d&bars=3', 'GET', true);
    });

    await stage('API: timeframe, bars, from and to', async () => {
      await show(base, 'bad timeframe', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=7x&bars=10');
      await show(base, 'no timeframe', '/api/history?provider=binance&symbol=BTCUSDT&bars=10');
      await show(base, 'timeframe the provider lacks (stooq 1m)', '/api/history?provider=stooq&symbol=aapl.us&timeframe=1m&bars=10');
      await show(base, 'no bars and no from', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h');
      await show(base, 'bars=0', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=0');
      await show(base, 'bars=-5', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=-5');
      await show(base, 'bars=abc', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=abc');
      await show(base, 'bars=1e3', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=1e3');
      await show(base, 'bars=2.5', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=2.5');
      await show(base, 'bars=1000000000 (over the limit)', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=1000000000');
      await show(base, 'bars of 400 digits', `/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=${'9'.repeat(400)}`);
      await show(base, 'bars=50000 (at the limit?)', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=50000');
      await show(base, 'bars=50001', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=50001');
      await show(base, 'from after to', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&from=2000000000&to=1000000000');
      await show(base, 'from in the future', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&from=4102444800');
      await show(base, 'from=0 on 1m (huge span)', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1m&from=0');
      await show(base, 'from as a float', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&from=1.5');
      await show(base, 'from in milliseconds by mistake', `/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&from=${Date.now() - 86400000}`);
      await show(base, 'to without from', `/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=5&to=${Math.floor(Date.now() / 1000) - 3600}`);
      await show(base, 'valid range', `/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&from=${Math.floor(Date.now() / 1000) - 36000}`);
    });

    await stage('API: other routes and methods', async () => {
      await show(base, 'providers', '/api/providers');
      await show(base, 'unknown route', '/api/nope');
      await show(base, '/api/ alone', '/api/');
      await show(base, 'POST /api/history', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=3', 'POST');
      await show(base, 'HEAD /api/history', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=3', 'HEAD');
      await show(base, 'OPTIONS /api/history', '/api/history', 'OPTIONS');
      await show(base, 'DELETE /api/status', '/api/status', 'DELETE');
      await show(base, 'search without q', '/api/search?provider=binance');
      await show(base, 'search q of 3000 characters', `/api/search?provider=binance&q=${'E'.repeat(3000)}`);
      await show(base, 'search with regex characters', '/api/search?provider=binance&q=%28%5B%2A%2B');
      await show(base, 'search on a provider with no list (coinbase symbols)', '/api/symbols?provider=coinbase');
      await show(base, 'symbols for binance', '/api/symbols?provider=binance');
      await show(base, 'malformed percent-encoding in the query', '/api/search?provider=binance&q=%E0%A4%A');
      await show(base, 'malformed percent-encoding in the path', '/api/%E0%A4%A');
      await show(base, 'health', '/api/health');
    });

    await stage('static files and path traversal', async () => {
      await show(base, 'index', '/');
      await show(base, 'unknown route (SPA fallback)', '/some/client/route');
      await show(base, 'missing asset', '/assets/nope.js');
      await show(base, 'dot segments (the URL parser removes them)', '/../package.json');
      await show(base, 'encoded dot segments', '/%2e%2e/package.json');
      await show(base, 'encoded slash', '/..%2f..%2fpackage.json');
      await show(base, 'encoded slash, deeper', '/..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd');
      await show(base, 'backslashes', '/..%5c..%5cpackage.json');
      await show(base, 'NUL byte in the path', '/index.html%00.png');
      await show(base, 'double encoding', '/%252e%252e%252fpackage.json');
      await show(base, 'a directory', '/assets/');
      await show(base, 'path of 8000 characters', `/${'a'.repeat(8000)}`);
      // The check is `filePath.startsWith(DIST)`: a sibling folder whose name starts with "dist" passes it.
      mkdirSync(sibling, { recursive: true });
      writeFileSync(path.join(sibling, 'secret.txt'), 'SIBLING-OF-DIST-READ\n');
      const s = await show(base, 'sibling folder client/dist-probe reached through an encoded slash (a temporary file the probe creates and removes)', '/..%2fdist-probe%2fsecret.txt');
      say(`    => sibling file ${s.body.includes('SIBLING-OF-DIST-READ') ? 'WAS SERVED (the 403 guard is a prefix check)' : 'not served'}`);
      rmSync(sibling, { recursive: true, force: true });
      await show(base, 'same request after removing the folder', '/..%2fdist-probe%2fsecret.txt');
      const gz = await raw(base, '/assets/', 'GET', 4000, { 'accept-encoding': 'gzip' });
      say(`gzip request on a directory: ${gz.status}`);
      say('CORS: static files and API replies carry access-control-allow-origin: * (read from main.ts and respond.ts; see the README)');
    });

    await stage('/api/live (a server-sent event stream; there is no subscribe message to corrupt)', async () => {
      const cases: Array<[string, string]> = [
        ['valid feed', '?provider=binance&symbol=BTCUSDT&timeframe=1h'],
        ['no parameters', ''],
        ['unknown provider', '?provider=nope&symbol=BTCUSDT&timeframe=1h'],
        ['provider with no live feed (yahoo)', '?provider=yahoo&symbol=AAPL&timeframe=1d'],
        ['missing symbol', '?provider=binance&timeframe=1h'],
        ['symbol with spaces and quotes', `?provider=binance&symbol=${encodeURIComponent('BTC"USDT 1')}&timeframe=1h`],
        ['symbol of 5000 characters', `?provider=binance&symbol=${'A'.repeat(5000)}&timeframe=1h`],
        ['bad timeframe', '?provider=binance&symbol=BTCUSDT&timeframe=9z'],
        ['timeframe the exchange lacks (1w on kraken)', '?provider=kraken&symbol=XBTUSD&timeframe=1w'],
      ];
      for (const [label, q] of cases) {
        const r = await live(base, q);
        say(`${label}`);
        say(`    GET /api/live${q.length > 100 ? `${q.slice(0, 100)}...` : q}`);
        say(`    -> ${r.status}, ${r.bytes} bytes in 1.5 s; first events: ${r.events.length ? r.events.join(' | ') : '(none)'}`);
      }
      const post = await live(base, '?provider=binance&symbol=BTCUSDT&timeframe=1h', 600, 'POST');
      say(`POST /api/live -> ${post.status}`);
      const wsCount = (): number => upstream.requests.filter((q) => q.kind === 'ws').length;
      const startWs = wsCount();
      const open: http.ClientRequest[] = [];
      for (let i = 0; i < 40; i++) {
        const u = new URL(base);
        const req = http.request({ host: u.hostname, port: u.port, path: '/api/live?provider=binance&symbol=BTCUSDT&timeframe=1h' }, (res) => res.resume());
        req.on('error', () => undefined);
        req.end();
        open.push(req);
      }
      await new Promise((r) => setTimeout(r, 1500));
      say(`40 browser streams on one feed -> upstream websockets opened: ${wsCount() - startWs} (the relay shares one per feed)`);
      for (const r of open) r.destroy();
      await new Promise((r) => setTimeout(r, 1500));
      const afterShared = wsCount();
      const many: http.ClientRequest[] = [];
      for (let i = 0; i < 60; i++) {
        const u = new URL(base);
        const req = http.request({ host: u.hostname, port: u.port, path: `/api/live?provider=binance&symbol=SYM${i}USDT&timeframe=1h` }, (res) => res.resume());
        req.on('error', () => undefined);
        req.end();
        many.push(req);
      }
      await new Promise((r) => setTimeout(r, 2000));
      say(`60 streams on 60 different symbols -> upstream websockets opened: ${wsCount() - afterShared} (no limit on feeds per caller, no auth on /api/live)`);
      for (const r of many) r.destroy();
      await new Promise((r) => setTimeout(r, 1500));
    });

    await stage('/api/status', async () => {
      await show(base, 'status', '/api/status');
      await show(base, 'status with a refresh (runs a round of upstream probes)', '/api/status?refresh=1');
      await show(base, 'status refresh twice quickly', '/api/status?refresh=1');
      await show(base, 'status with refresh=2', '/api/status?refresh=2');
    });

    await stage('the market-data service goes away', async () => {
      await upstream.stop();
      await show(base, 'history with the upstream down (connection refused)', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=5');
      await show(base, 'search with the upstream down', '/api/search?provider=binance&q=ETH');
      await show(base, 'symbols with the upstream down (a cached list may still answer)', '/api/symbols?provider=binance');
      const l = await live(base, '?provider=binance&symbol=BTCUSDT&timeframe=1h', 2500);
      say(`live with the upstream down: ${l.status}, events: ${l.events.join(' | ') || '(none)'}`);
      await show(base, 'status after the failures (should show them)', '/api/status');
      await upstream.start();
      await show(base, 'history after the upstream came back', '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=5');
    });

    await stage('an upstream that accepts the connection and never answers (the timeout)', async () => {
      await new Promise<void>((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
      const holePort = (blackhole.address() as net.AddressInfo).port;
      hole = await startServer(`http://127.0.0.1:${holePort}`);
      const one = await raw(hole.base, '/api/history?provider=coinbase&symbol=BTC-USD&timeframe=1h&bars=5', 'GET', 45_000);
      say(`coinbase history (one host), upstream silent: -> ${one.status} ${one.type} after ${one.ms} ms  ${short(one.body)}`);
      const two = await raw(hole.base, '/api/history?provider=binance&symbol=BTCUSDT&timeframe=1h&bars=5', 'GET', 70_000);
      say(`binance history (two hosts: api.binance.com then the data-api.binance.vision mirror), upstream silent: -> ${two.status} ${two.type} after ${two.ms} ms  ${short(two.body)}`);
      say('   (the limit is 25 s per host in server/providers/upstream.ts, so the browser can wait hosts x 25 s)');
      // the browser goes away after 1 s: the server must drop its upstream connection
      const u = new URL(hole.base);
      for (const s of sockets) s.destroy(); // a clean count: only connections made from here on
      await new Promise((res) => setTimeout(res, 300));
      const before = sockets.size;
      const req = http.request({ host: u.hostname, port: u.port, path: '/api/history?provider=coinbase&symbol=ETH-USD&timeframe=1h&bars=5' }, (res) => res.resume());
      req.on('error', () => undefined);
      req.end();
      await new Promise((res) => setTimeout(res, 1000));
      const during = sockets.size;
      req.destroy();
      await new Promise((res) => setTimeout(res, 1500));
      const soon = sockets.size;
      await new Promise((res) => setTimeout(res, 5000));
      say(`upstream connections open on the silent service: before=${before}, while the browser waits=${during}, 1.5 s after the browser left=${soon}, 6.5 s after=${sockets.size}`);
      say('   (a count that stays above "before" means the server keeps waiting on an upstream call nobody wants until its own 25 s limit)');
      const h = await raw(hole.base, '/api/health', 'GET', 3000);
      say(`health after that: ${h.status} in ${h.ms} ms`);
      const st = await raw(hole.base, '/api/status');
      say(`status after the timeout: ${short(st.body, 400)}`);
      await stop(hole.child);
      hole = null;
    });

    say('');
    say('## server log (warnings and errors only)');
    for (const l of main.log().split('\n').filter((x) => /\[api\]|error|Error|warn/i.test(x)).slice(0, 25)) say(`    ${l.slice(0, 200)}`);
  } finally {
    await stop(main?.child ?? null);
    await stop(hole?.child ?? null);
    for (const s of sockets) s.destroy();
    blackhole.close();
    await upstream.close();
    rmSync(sibling, { recursive: true, force: true });
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${lines.join('\n')}\n`);
    process.stdout.write(`${path.relative(process.cwd(), OUT)}\n`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`server-probe: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
