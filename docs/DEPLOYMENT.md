# Deploying Vost

Vost is a static web client plus a tiny zero-dependency Node server. The server does three things:

1. serves `client/dist` (the built web app),
2. answers the market-data API (`/api/providers`, `/api/history`, `/api/symbols`, `/api/search`): it calls the public provider APIs (Binance, Yahoo, Stooq, …) on the browser's behalf, because many of them send no CORS headers,
3. keeps price alerts (`/api/alerts`) and watches prices for them around the clock, even with every browser tab closed.

There is no database. The one piece of state on disk is the alerts file, `alerts.json`, in the data folder (`VOST_DATA_DIR`); everything else is in memory (the symbol-list cache, the open exchange websockets). The server is TypeScript that Node runs directly (type stripping), so there is no server build step and no npm dependency at runtime. Everything else — fetch orchestration, CSV parsing, indicators, backtests — runs in the visitor's browser.

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
- **Every remote provider (Binance, Coinbase, Kraken, Bybit, OKX, Yahoo, Stooq) needs the Node server**: the browser no longer calls those APIs itself, so without `/api/*` they fail to load.

`npm run dev` automatically proxies `/api/*` from Vite (:5173) to the Node server (:8787).

## Environment variables

| Variable | Applies to | Default | Meaning |
|---|---|---|---|
| `PORT` | server (runtime) | `8787` | HTTP listen port |
| `HOST` | server (runtime) | `0.0.0.0` | Bind address; use `127.0.0.1` behind a proxy |
| `VOST_STATUS_INTERVAL` | server (runtime) | `60` | Seconds between background health checks of the exchanges (see `/api/status`); `0` turns them off, and the status then stays `unknown` until someone presses "Test now" or real requests report in |
| `VOST_DATA_DIR` | server (runtime) | `<repo>/data` (`/data` in the Docker image) | Folder for `alerts.json`, created on first write. If it is not writable the server still starts, alerts can be listed but every change answers `503` naming this variable |
| `VOST_ALERT_POLL` | server (runtime) | `60` | Seconds between price polls for alerts on providers without a live feed (Yahoo, Stooq); values below 10 count as 10. Binance, Coinbase, Kraken, Bybit and OKX alerts use the shared live stream instead |
| `VOST_TELEGRAM_BOT_TOKEN` | server (runtime) | unset | Bot token from [@BotFather](https://t.me/BotFather) (`/newbot`). With `VOST_TELEGRAM_CHAT_ID` also set, every alert that fires sends one Telegram message. **A secret**: it is never logged or returned by the API, but keep it out of git and tickets. Needs outbound access to `api.telegram.org` |
| `VOST_TELEGRAM_CHAT_ID` | server (runtime) | unset | Chat that receives the messages. Send your bot a message, then open `https://api.telegram.org/bot<token>/getUpdates` and read `message.chat.id`. If only one of the two Telegram variables is set the server logs a warning and sends nothing |
| `VOST_SERVER_URL` | Vite dev server | `http://localhost:8787` | Upstream for the dev-time `/api` proxy |

Variables are read once at process start. See [`.env.example`](../.env.example).

## Health checks & updates

- `GET /api/health` → `{ ok, version, uptimeSeconds, node, clientsBuilt }`. `version` is the running release (the top bar and the startup log show the same number). Use it for Docker health checks, uptime monitors and load-balancer probes.
- `GET /api/status` → `{ server: { state, version, uptimeSeconds }, intervalSeconds, checks: [...] }`: one check per exchange and data type (price history, symbol lookup, live stream; 17 in all), each with `state` (`ok`, `degraded`, `down`, `unknown`), `latencyMs`, `checkedAt`, `lastOkAt`, `error` and `source` (`probe`, `relay` or `traffic`). It backs the connection light in the top bar; add `?refresh=1` to run a fresh round of checks first (rate limited: a refresh within 15 s of the last round reuses it). Unlike `/api/health` it reports on the exchanges, not just on Vost. The server makes these test requests itself about every `VOST_STATUS_INTERVAL` seconds, so an outbound firewall must allow the same exchange hosts as the data requests, and every state change is logged as `[status] <provider> <feed> <old> -> <new>`.
- Updating to a release = `git fetch --tags && git checkout vX.Y.Z && npm ci && npm run build && restart`. Hashed asset filenames change, so clients pick up the new build on next load; no cache-busting dance needed.
- `GET /api/alerts` → `{ alerts: [...], telegram: { configured } }`; `POST /api/alerts/telegram-test` sends a test message (`200 { ok: true }`, `503` when Telegram is not set up, `502` when Telegram refuses or cannot be reached; same-origin and JSON like the other writes); each fired alert records `telegram` (`sent`, `failed` or `off`) and, on failure, `telegramError`; `POST /api/alerts`, `PUT /api/alerts/<id>` and `DELETE /api/alerts/<id>` change them, and `GET /api/alerts/events` is an event stream of every change and every firing. Alert changes are same-origin only: they must be `application/json` and must come from the Vost page itself (a request with a foreign `Origin` header or `Sec-Fetch-Site: cross-site` gets `403`), and alert replies carry no CORS header. A reverse proxy must therefore pass the `Host` header through unchanged.
- The server writes to disk only to save `alerts.json` (atomically, on every change). Back it up by copying that file; a file it cannot read is renamed `alerts.json.bad-<time>` and the server starts with no alerts.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Vost needs Node 22.18 or newer` | The server runs TypeScript directly and needs Node 22.18+ (24 recommended). Upgrade Node. |
| Yahoo returns `429` | Shared/datacenter IPs are rate-limited by Yahoo's edge. The server retries automatically; if it persists, wait or switch networks. CSV import always works. |
| Stooq returns `403` (HTML challenge) | Stooq's bot protection challenges many cloud/VPS IPs. Use Yahoo, Binance or CSV import instead. |
| Stale page after deploy | Hard-refresh once. `index.html` is `no-cache`, but a layer between the browser and Vost may cache HTML — check your reverse proxy isn't overriding `Cache-Control`. |
| Port already in use | `PORT=9090 npm start`, or update `docker-compose.yml`. |
| Client shows "HTTP 404" or "fetch failed" for a remote provider | You're on a static-only deployment without the Node server. Serve the app through the Node server (or Docker). |

## Data provider terms

The bundled providers use only public, keyless endpoints (Binance, Coinbase, Kraken, Bybit and OKX REST/WS, Yahoo chart API, Stooq CSV downloads). They are intended for **personal research use**; if you run a heavily-trafficked public instance, review each provider's terms of service and rate limits first — or plug in your own licensed data API (see [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-data-provider)).
