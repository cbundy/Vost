# Deploying Vost

Vost is a static web client plus a tiny zero-dependency Node server. The server does three things:

1. serves `client/dist` (the built web app),
2. answers the market-data API (`/api/providers`, `/api/history`, `/api/symbols`, `/api/search`): it calls the public provider APIs (Binance, Yahoo, …) on the browser's behalf, because many of them send no CORS headers,
3. keeps price alerts (`/api/alerts`) and watches prices for them around the clock, even with every browser tab closed.
4. looks up and keeps the TradingView libraries that Pine scripts import (`/api/pine/libraries`).

There are three files of state on disk, all in the data folder (`VOST_DATA_DIR`): the alerts file, `alerts.json`, the Pine libraries file, `pine-libraries.json` (open-source TradingView libraries the server fetched for scripts that import them, and libraries you pasted), and a candle store, `candles.sqlite` (a SQLite file the server opens with Node's built-in `node:sqlite`, so no npm dependency is added). The candle store holds chart history for the markets the server records (see [Recorded markets](#recorded-markets)); it is safe to delete, because the history is then fetched from the exchange again. Everything else is in memory (the symbol-list cache, the open exchange websockets). The server is TypeScript that Node runs directly (type stripping), so there is no server build step and no npm dependency at runtime. Everything else — fetch orchestration, CSV parsing, indicators, backtests — runs in the visitor's browser.

- [Docker](#docker)
- [Docker Compose](#docker-compose)
- [Plain Node / systemd](#plain-node--systemd)
- [Reverse proxy & TLS (nginx)](#reverse-proxy--tls-nginx)
- [Behind a sub-path](#behind-a-sub-path)
- [Static-only hosting](#static-only-hosting)
- [Environment variables](#environment-variables)
- [Health checks & updates](#health-checks--updates)
- [Troubleshooting](#troubleshooting)

---

## Docker

A multi-stage `Dockerfile` is included: it installs dependencies, builds the client and produces a small runtime image with only the server + built assets.

```bash
docker build -t vost .
docker run -d --name vost -p 8787:8787 --restart unless-stopped vost
```

Open <http://localhost:8787>. The image runs as a non-root user. Mount a volume on `/data` to keep alerts across container re-creation (`-v vost-data:/data`); without it they live and die with the container.

## Docker Compose

```bash
docker compose up -d --build
```

The included `docker-compose.yml`:

- publishes port `8787`,
- restarts unless stopped,
- maps `PORT`/`HOST` from `.env` (copy `.env.example` → `.env`),
- adds a container health check hitting `/api/health`.

Updating:

```bash
git fetch --tags
git checkout vX.Y.Z   # the release to run, from the Releases page
docker compose up -d --build
```

## Plain Node / systemd

Requirements: Node **24** recommended (`node --version`); Node 22.18+ is the minimum supported (older versions print `Vost needs Node 22.18 or newer` and exit).

```bash
git clone https://github.com/cbundy/Vost.git
cd Vost
npm ci            # or npm install
npm run build     # typecheck + bundle -> client/dist
PORT=8787 npm start
```

Ready-made systemd unit (`/etc/systemd/system/vost.service`):

```ini
[Unit]
Description=Vost — self-hosted charts & backtesting
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=vost
WorkingDirectory=/opt/vost
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=HOST=127.0.0.1
ExecStart=/usr/bin/node server/index.mjs
Restart=on-failure
RestartSec=3

# Hardening (the server only needs to read its own directory)
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /opt/vost --shell /usr/sbin/nologin vost
sudo rsync -a --exclude node_modules --exclude .git ./ /opt/vost/
cd /opt/vost && npm ci && npm run build
sudo chown -R vost:vost /opt/vost
sudo systemctl enable --now vost
```

`HOST=127.0.0.1` makes the app reachable only through your reverse proxy — recommended for internet-facing hosts.

## Reverse proxy & TLS (nginx)

Assuming Vost runs on `127.0.0.1:8787`:

```nginx
server {
    listen 443 ssl http2;
    server_name charts.example.com;

    ssl_certificate     /etc/letsencrypt/live/charts.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/charts.example.com/privkey.pem;

    # Security headers (static app, no inline scripts required)
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # Live candles: a long-lived event stream, so no buffering and no short read timeout
    location /api/live {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name charts.example.com;
    return 301 https://$host$request_uri;
}
```

Notes:

- `/api/live` is a server-sent-events stream. Without the `location /api/live` block above (`proxy_buffering off`, a long `proxy_read_timeout`) the proxy holds the events back or cuts the stream, and the live indicator will not recover cleanly. The server also sends a `: ping` comment every 15 s and replies with `X-Accel-Buffering: no`.
- Hashed assets (`/assets/*.js`, `*.css`) are served with `Cache-Control: immutable`; `index.html` with `no-cache`. Don't override this — it's what makes updates instant.
- If you gate the app behind HTTP basic auth or an SSO proxy, protect `/` **and** `/api/*` so the market-data API isn't left open.

## Behind a sub-path

The client calls `/api/...` with absolute paths, so it assumes it's served from the domain root. The simplest reliable setup for `https://example.com/charts/` is to keep Vost at the root, or mount it on a dedicated subdomain (`charts.example.com`) and use the nginx block above. Sub-path mounting is possible with a prefix-stripping proxy but is not a tested configuration yet.

## Static-only hosting

You can skip the Node server (GitHub Pages, Netlify, S3, nginx serving files) by deploying `client/dist/` anywhere, but only the offline features work there:

- **CSV import, the Demo provider and all backtesting work** - they never touch the network.
- **Every remote provider (Binance, Coinbase, Kraken, Bybit, OKX, Hyperliquid Perps, Hyperliquid Spot, Yahoo) needs the Node server**: the browser no longer calls those APIs itself, so without `/api/*` they fail to load.

`npm run dev` automatically proxies `/api/*` from Vite (:5173) to the Node server (:8787).

## Environment variables

| Variable | Applies to | Default | Meaning |
|---|---|---|---|
| `PORT` | server (runtime) | `8787` | HTTP listen port |
| `HOST` | server (runtime) | `0.0.0.0` | Bind address; use `127.0.0.1` behind a proxy |
| `VOST_STATUS_INTERVAL` | server (runtime) | `60` | Seconds between background health checks of the exchanges (see `/api/status`); `0` turns them off, and the status then stays `unknown` until someone presses "Test now" or real requests report in |
| `VOST_DATA_DIR` | server (runtime) | `<repo>/data` (`/data` in the Docker image) | Folder for `alerts.json`, `pine-libraries.json` and `candles.sqlite`, created on first write. If it is not writable the server still starts, alerts can be listed but every change answers `503` naming this variable, Pine libraries are still fetched and served but not kept (pasting one answers `503`), and the candle store is off (charts then come from the exchange as before) |
| `VOST_RECORD` | server (runtime) | `binance:BTCUSDT binance:ETHUSDT coinbase:BTC-USD coinbase:ETH-USD hyperliquid-perps:BTC hyperliquid-perps:ETH` | The markets the server records at all times, separated by commas or spaces. Each entry is `provider:SYMBOL` (every timeframe the provider's live feed supports) or `provider:SYMBOL:tf/tf` (those timeframes only), e.g. `binance:BTCUSDT:1h/1d`. `off` records nothing. A bad entry is skipped with a `[recorder]` warning. See [Recorded markets](#recorded-markets) |
| `VOST_RECORD_BARS` | server (runtime) | `20000` | Bars kept per recorded series; an integer of at least 100 (a bad value logs a warning and uses the default) |
| `VOST_ALERT_POLL` | server (runtime) | `60` | Seconds between price polls for alerts on providers without a live feed (Yahoo); values below 10 count as 10. Binance, Coinbase, Kraken, Bybit, OKX and Hyperliquid alerts use the shared live stream instead |
| `VOST_TELEGRAM_BOT_TOKEN` | server (runtime) | unset | Bot token from [@BotFather](https://t.me/BotFather) (`/newbot`). With `VOST_TELEGRAM_CHAT_ID` also set, every alert that fires sends one Telegram message. **A secret**: it is never logged or returned by the API, but keep it out of git and tickets. Needs outbound access to `api.telegram.org` |
| `VOST_TELEGRAM_CHAT_ID` | server (runtime) | unset | Chat that receives the messages. Send your bot a message, then open `https://api.telegram.org/bot<token>/getUpdates` and read `message.chat.id`. If only one of the two Telegram variables is set the server logs a warning and sends nothing |
| `VOST_SERVER_URL` | Vite dev server | `http://localhost:8787` | Upstream for the dev-time `/api` proxy |

Variables are read once at process start. See [`.env.example`](../.env.example).

## Health checks & updates

- `GET /api/health` → `{ ok, version, uptimeSeconds, node, clientsBuilt }`. `version` is the running release (the top bar and the startup log show the same number). Use it for Docker health checks, uptime monitors and load-balancer probes.
- `GET /api/status` → `{ server: { state, version, uptimeSeconds }, intervalSeconds, checks: [...], candles: { on, series, rows, bytes }, recorder: { on, depthBars, series: [{ provider, symbol, timeframe, live, lastCandleTime, missingBars, refills, lastRefillAt, lastError }] } }`: one check per exchange and data type (price history, symbol lookup, live stream; 23 in all), each with `state` (`ok`, `degraded`, `down`, `unknown`), `latencyMs`, `checkedAt`, `lastOkAt`, `error` and `source` (`probe`, `relay` or `traffic`). It backs the connection light in the top bar; add `?refresh=1` to run a fresh round of checks first (rate limited: a refresh within 15 s of the last round reuses it). Unlike `/api/health` it reports on the exchanges, not just on Vost. The server makes these test requests itself about every `VOST_STATUS_INTERVAL` seconds, so an outbound firewall must allow the same exchange hosts as the data requests, and every state change is logged as `[status] <provider> <feed> <old> -> <new>`.
- Updating to a release = `git fetch --tags && git checkout vX.Y.Z && npm ci && npm run build && restart`. Hashed asset filenames change, so clients pick up the new build on next load; no cache-busting dance needed.
- `GET /api/alerts` → `{ alerts: [...], telegram: { configured } }`; `POST /api/alerts/telegram-test` sends a test message (`200 { ok: true }`, `503` when Telegram is not set up, `502` when Telegram refuses or cannot be reached; same-origin and JSON like the other writes); each fired alert records `telegram` (`sent`, `failed` or `off`) and, on failure, `telegramError`; `POST /api/alerts`, `PUT /api/alerts/<id>` and `DELETE /api/alerts/<id>` change them, and `GET /api/alerts/events` is an event stream of every change and every firing. Alert changes are same-origin only: they must be `application/json` and must come from the Vost page itself (a request with a foreign `Origin` header or `Sec-Fetch-Site: cross-site` gets `403`), and alert replies carry no CORS header. A reverse proxy must therefore pass the `Host` header through unchanged.
- `GET /api/pine/libraries/<user>/<name>/<version>` → `{ path, source, origin: "tradingview" | "pasted", scriptId?, fetchedAt }`: the stored copy, else a lookup on TradingView (saved on success). `404 { error, reason: "not-found" | "closed-source" }` when TradingView has no open-source copy (remembered for 10 minutes), `502` when TradingView cannot be reached, `400` for a path that is not `user/name/version`. `GET /api/pine/libraries` lists what is stored (no source). `PUT` on the same path with `{ "source": "..." }` (a Pine v5 or v6 library, at most 1 MB) saves a pasted library and `DELETE` removes one; both are same-origin only like the alert writes (`403` for a foreign `Origin` or `Sec-Fetch-Site: cross-site`, no CORS header, `503` naming `VOST_DATA_DIR` when the folder is not writable). The lookup uses TradingView's own web endpoints, which are not an official API and may change; pasting a library is the fallback. An outbound firewall must allow `www.tradingview.com` and `pine-facade.tradingview.com`. Each lookup is logged as `[pine-libraries] <path> <outcome> (...)`.
- The server writes to disk only to save `alerts.json` (atomically, on every change), `pine-libraries.json` (atomically, when a library is fetched, pasted or removed; a file it cannot read is renamed `pine-libraries.json.bad-<time>` and the server starts with none) and to keep `candles.sqlite` (with its `-wal` and `-shm` siblings while it runs). Back up `alerts.json` by copying it; a file it cannot read is renamed `alerts.json.bad-<time>` and the server starts with no alerts. A `candles.sqlite` that is corrupt or of another schema version is renamed `candles.sqlite.bad-<time>` (with its siblings) and a fresh one is created; if that fails too the store is off and the server carries on.

## Recorded markets

The server keeps a list of markets recorded and live at all times (`VOST_RECORD`; by default BTC and ETH on Binance, Coinbase and Hyperliquid, on every timeframe, back to 20000 bars). On start it fills each series' history from the exchange into `candles.sqlite`, then holds one live connection per series that writes every closed candle to disk. After a dropped connection or a restart it refills the missed span from the exchange, and every 15 minutes it re-checks each series for holes and deletes candles older than the depth (`VOST_RECORD_BARS`). `/api/history` answers a recorded series from disk and asks the exchange only for what is missing and for the forming bar.

What to expect:

- **Always-open connections.** One websocket per series stays open for as long as the server runs: about 45 with the default list. Your firewall must allow the exchange websocket hosts outbound.
- **The first start fetches a lot.** Each series is filled back to the depth, newest first, one request at a time per exchange with a pause between requests (Binance and Coinbase 250 ms, Hyperliquid Perps and Spot share one queue, 1 s; pages of 1000, 300 and 5000 bars). With the default list that is a few thousand requests and takes up to about ten minutes; charts keep working meanwhile (a part not stored yet comes from the exchange). A restart fetches only the bars missed since. Exchanges that hold less history than the depth (weekly and monthly bars, Hyperliquid's latest 5000 bars) are filled with what exists, once.
- **Rate limits.** On HTTP 429 or 418 an exchange's fill pauses for 60 s, doubling up to 15 minutes, and carries on after a success. The other exchanges are not held up.
- **Disk.** Measured by a test: 20000 one-minute rows take about 1.8 MB, around 90 bytes a row. The default list holds roughly 600000 rows at most (the exchanges hold fewer on weekly and monthly bars, and Hyperliquid keeps 5000), so expect on the order of 50 MB. A shorter `VOST_RECORD_BARS` shrinks it in proportion.
- **Changing the list.** A series that leaves the list is no longer served from disk or updated. Its rows stay until you delete them: the server logs `[recorder] not recorded any more: ...` at start. To drop them, stop the server and delete `candles.sqlite` (with its `-wal` and `-shm` siblings); it is rebuilt for the current list on the next start.
- **Where to look.** The start log prints `[recorder] on: N series (...)`. Each fill logs `[recorder] <provider> <symbol> <tf> filled <from>..<to>: <n> candles (cause: start | reconnect | sweep)`. `recorder` in `GET /api/status` shows per series the feed state, the newest stored bar, the bars still missing, the fills done since start and the last error. With the candle store off (data folder not writable) nothing is recorded.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Vost needs Node 22.18 or newer` | The server runs TypeScript directly and needs Node 22.18+ (24 recommended). Upgrade Node. |
| Yahoo returns `429` | Shared/datacenter IPs are rate-limited by Yahoo's edge. The server retries automatically; if it persists, wait or switch networks. CSV import always works. |
| Stale page after deploy | Hard-refresh once. `index.html` is `no-cache`, but a layer between the browser and Vost may cache HTML — check your reverse proxy isn't overriding `Cache-Control`. |
| Port already in use | `PORT=9090 npm start`, or update `docker-compose.yml`. |
| Client shows "HTTP 404" or "fetch failed" for a remote provider | You're on a static-only deployment without the Node server. Serve the app through the Node server (or Docker). |

## Data provider terms

The bundled providers use only public, keyless endpoints (Binance, Coinbase, Kraken, Bybit, OKX and Hyperliquid REST/WS, Yahoo chart API). They are intended for **personal research use**; if you run a heavily-trafficked public instance, review each provider's terms of service and rate limits first — or plug in your own licensed data API (see [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-data-provider)).
