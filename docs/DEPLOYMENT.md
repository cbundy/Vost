# Deploying Vost

Vost is a static web client plus a tiny Node server with no runtime npm packages. The server does three things:

1. serves `client/dist` (the built web app),
2. answers the market-data API (`/api/providers`, `/api/history`, `/api/symbols`, `/api/search`): it calls the public provider APIs (Binance, Yahoo, …) on the browser's behalf, because many of them send no CORS headers,
3. keeps price alerts (`/api/alerts`) and watches prices for them around the clock, even with every browser tab closed.
4. looks up and keeps the TradingView libraries that Pine scripts import (`/api/pine/libraries`),
5. builds the crypto lists of the market search from CoinGecko or CoinMarketCap (`/api/market-lists`).

There is state on disk, all in the data folder (`VOST_DATA_DIR`): the alerts file, `alerts.json`, the `settings/` folder (the app's settings, one `<name>.json` per setting; see the API list below), the `strategy-maker/` folder (the strategy maker's marked trades, find form and trained model; see the API list below), the `images/` folder (the pictures of the Image drawing, one file per picture named by its SHA-256, and `index.json`), the Pine libraries file, `pine-libraries.json` (open-source TradingView libraries the server fetched for scripts that import them, and libraries you pasted), and a candle store, `candles.sqlite` (a SQLite file the server opens with Node's built-in `node:sqlite`, so no npm dependency is added). The candle store holds chart history for the markets the server records (see [Recorded markets](#recorded-markets)); it is safe to delete, because the history is then fetched from the exchange again. Everything else is in memory (the symbol-list cache, the open exchange websockets). The server is TypeScript that Node runs directly (type stripping), so the server installs no npm package at runtime. The one built file is the engine bundle, `server/dist/engine.mjs`, which `npm run build` makes (the Docker image carries it); the server runs it in background worker threads (`VOST_JOB_WORKERS` sets how many). Everything else — CSV parsing, indicators, backtests — runs in the visitor's browser, but the app needs the server to start: it loads its settings, layouts, drawings, watchlists and datasets from the `settings/` folder at start and saves them there as you work.

- [Docker](#docker)
- [Docker Compose](#docker-compose)
- [Plain Node / systemd](#plain-node--systemd)
- [Reverse proxy & TLS (nginx)](#reverse-proxy--tls-nginx)
- [Behind a sub-path](#behind-a-sub-path)
- [Static-only hosting (not supported)](#static-only-hosting-not-supported)
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

Open <http://localhost:8787>. The image runs as a non-root user. Mount a volume on `/data` to keep your data across container re-creation (`-v vost-data:/data`): alerts, settings, layouts, drawings, watchlists, datasets, pictures and strategy maker data all live there. Without it they live and die with the container.

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
npm run build     # typecheck + bundle -> client/dist and server/dist/engine.mjs
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

    # Settings, datasets, pictures and strategy maker data are saved through /api; nginx's default 1 MB cap refuses big ones
    client_max_body_size 128m;

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
- The app saves your settings, layouts, drawings, watchlists, datasets, pictures and strategy maker data through `/api` (requests of up to 32 MB, 5 MB for a picture, 64 MB for the one-time settings move and 128 MB for a strategy maker import or move). A proxy's request-size cap below that (nginx defaults to 1 MB) answers `413`, and the app then reports the save as refused and does not retry it, so raise the cap as in `client_max_body_size` above.
- Hashed assets (`/assets/*.js`, `*.css`) are served with `Cache-Control: immutable`; `index.html` with `no-cache`. Don't override this — it's what makes updates instant.
- If you gate the app behind HTTP basic auth or an SSO proxy, protect `/` **and** `/api/*` so the market-data API isn't left open.

## Behind a sub-path

The client calls `/api/...` with absolute paths, so it assumes it's served from the domain root. The simplest reliable setup for `https://example.com/charts/` is to keep Vost at the root, or mount it on a dedicated subdomain (`charts.example.com`) and use the nginx block above. Sub-path mounting is possible with a prefix-stripping proxy but is not a tested configuration yet.

## Static-only hosting (not supported)

Deploying `client/dist/` alone (GitHub Pages, Netlify, S3, nginx serving files) is no longer supported. The app reads everything it keeps (settings, layouts, drawings, watchlists, datasets) from `/api/settings` when it starts, so without the Node server it shows "The Vost server cannot be reached" and builds no chart. Always serve the app through the Node server (or Docker).

`npm run dev` automatically proxies `/api/*` from Vite (:5173) to the Node server (:8787).

## Environment variables

| Variable | Applies to | Default | Meaning |
|---|---|---|---|
| `PORT` | server (runtime) | `8787` | HTTP listen port |
| `HOST` | server (runtime) | `0.0.0.0` | Bind address; use `127.0.0.1` behind a proxy |
| `VOST_STATUS_INTERVAL` | server (runtime) | `60` | Seconds between background health checks of the exchanges (see `/api/status`); `0` turns them off, and the status then stays `unknown` until someone presses "Test now" or real requests report in |
| `VOST_JOB_WORKERS` | server (runtime) | CPU count minus one (at least 1) | Worker threads the server runs its background jobs on, using `server/dist/engine.mjs` (made by `npm run build`; without it the server still starts and a job reports `server jobs unavailable: run npm run build`). A positive integer; anything else uses the default |
| `VOST_DATA_DIR` | server (runtime) | `<repo>/data` (`/data` in the Docker image) | Folder for `alerts.json`, `pine-libraries.json`, `candles.sqlite`, the `settings/`, `strategy-maker/` and `images/` folders (plus `settings-imported-<ms>.json` and `strategy-maker-imported-<ms>.json` archives), created on first write. If it is not writable the server still starts, alerts, settings and strategy maker data can be listed but every change answers `503` naming this variable, Pine libraries are still fetched and served but not kept (pasting one answers `503`), and the candle store is off (charts then come from the exchange as before) |
| `VOST_RECORD` | server (runtime) | `binance:BTCUSDT binance:ETHUSDT coinbase:BTC-USD coinbase:ETH-USD hyperliquid-perps:BTC hyperliquid-perps:ETH` | The markets the server records at all times, separated by commas or spaces. Each entry is `provider:SYMBOL` (every timeframe the provider's live feed supports) or `provider:SYMBOL:tf/tf` (those timeframes only), e.g. `binance:BTCUSDT:1h/1d`. `off` records nothing. A bad entry is skipped with a `[recorder]` warning. See [Recorded markets](#recorded-markets) |
| `VOST_RECORD_BARS` | server (runtime) | `20000` | Bars kept per recorded series; an integer of at least 100 (a bad value logs a warning and uses the default) |
| `VOST_ALERT_POLL` | server (runtime) | `60` | Seconds between price polls for alerts on providers without a live feed (Yahoo); values below 10 count as 10. Binance, Coinbase, Kraken, Bybit, OKX and Hyperliquid alerts use the shared live stream instead |
| `VOST_TELEGRAM_BOT_TOKEN` | server (runtime) | unset | Bot token from [@BotFather](https://t.me/BotFather) (`/newbot`). With `VOST_TELEGRAM_CHAT_ID` also set, every alert that fires sends one Telegram message. **A secret**: it is never logged or returned by the API, but keep it out of git and tickets. Needs outbound access to `api.telegram.org` |
| `VOST_TELEGRAM_CHAT_ID` | server (runtime) | unset | Chat that receives the messages. Send your bot a message, then open `https://api.telegram.org/bot<token>/getUpdates` and read `message.chat.id`. If only one of the two Telegram variables is set the server logs a warning and sends nothing |
| `VOST_COINMARKETCAP_API_KEY` | server (runtime) | unset | Optional free CoinMarketCap key. With it the crypto market lists (`/api/market-lists`) ask CoinMarketCap first and CoinGecko second; without it only CoinGecko is used. **A secret**: it is never logged or returned by the API (not even when CoinMarketCap echoes it in an error), but keep it out of git and tickets. Needs outbound access to `pro-api.coinmarketcap.com` |
| `VOST_SERVER_URL` | Vite dev server | `http://localhost:8787` | Upstream for the dev-time `/api` proxy |

Variables are read once at process start. See [`.env.example`](../.env.example).

## Health checks & updates

- `GET /api/health` → `{ ok, version, uptimeSeconds, node, clientsBuilt }`. `version` is the running release (the top bar and the startup log show the same number). Use it for Docker health checks, uptime monitors and load-balancer probes.
- `GET /api/status` → `{ server: { state, version, uptimeSeconds }, intervalSeconds, checks: [...], candles: { on, series, rows, bytes }, recorder: { on, depthBars, series: [{ provider, symbol, timeframe, live, lastCandleTime, missingBars, refills, lastRefillAt, lastError }] } }`: one check per exchange and data type (price history, symbol lookup, live stream; 23 in all), each with `state` (`ok`, `degraded`, `down`, `unknown`), `latencyMs`, `checkedAt`, `lastOkAt`, `error` and `source` (`probe`, `relay` or `traffic`). It backs the connection light in the top bar; add `?refresh=1` to run a fresh round of checks first (rate limited: a refresh within 15 s of the last round reuses it). Unlike `/api/health` it reports on the exchanges, not just on Vost. The server makes these test requests itself about every `VOST_STATUS_INTERVAL` seconds, so an outbound firewall must allow the same exchange hosts as the data requests, and every state change is logged as `[status] <provider> <feed> <old> -> <new>`.
- Updating to a release = `git fetch --tags && git checkout vX.Y.Z && npm ci && npm run build && restart`. Hashed asset filenames change, so clients pick up the new build on next load; no cache-busting dance needed.
- `GET /api/alerts` → `{ alerts: [...], telegram: { configured } }`; `POST /api/alerts/telegram-test` sends a test message (`200 { ok: true }`, `503` when Telegram is not set up, `502` when Telegram refuses or cannot be reached; same-origin and JSON like the other writes); each fired alert records `telegram` (`sent`, `failed` or `off`) and, on failure, `telegramError`; `POST /api/alerts`, `PUT /api/alerts/<id>` and `DELETE /api/alerts/<id>` change them, and `GET /api/alerts/events` is an event stream of every change and every firing. Alert changes are same-origin only: they must be `application/json` and must come from the Vost page itself (a request with a foreign `Origin` header or `Sec-Fetch-Site: cross-site` gets `403`), and alert replies carry no CORS header. A reverse proxy must therefore pass the `Host` header through unchanged.
- `GET /api/pine/libraries/<user>/<name>/<version>` → `{ path, source, origin: "tradingview" | "pasted", scriptId?, fetchedAt }`: the stored copy, else a lookup on TradingView (saved on success). `404 { error, reason: "not-found" | "closed-source" }` when TradingView has no open-source copy (remembered for 10 minutes), `502` when TradingView cannot be reached, `400` for a path that is not `user/name/version`. `GET /api/pine/libraries` lists what is stored (no source). `PUT` on the same path with `{ "source": "..." }` (a Pine v5 or v6 library, at most 1 MB) saves a pasted library and `DELETE` removes one; both are same-origin only like the alert writes (`403` for a foreign `Origin` or `Sec-Fetch-Site: cross-site`, no CORS header, `503` naming `VOST_DATA_DIR` when the folder is not writable). The lookup uses TradingView's own web endpoints, which are not an official API and may change; pasting a library is the fallback. An outbound firewall must allow `www.tradingview.com` and `pine-facade.tradingview.com`. Each lookup is logged as `[pine-libraries] <path> <outcome> (...)`.
- `GET /api/market-lists` → `{ lists: [...] }`, five lists in order: `crypto-cap`, `crypto-volume` (top 30 by market cap and by 24h volume, mapped to Binance USDT pairs), `stocks-cap`, `stocks-volume` and `indices` (fixed, dated 2026-11-05). Each list has `id`, `title`, `source` (the site and endpoint that answered), `date`, `live`, `entries`, `excluded` and `skipped`, and `stale: true` or `error` when a crypto refresh failed. The crypto lists are fetched from `api.coingecko.com` (or `pro-api.coinmarketcap.com` first when `VOST_COINMARKETCAP_API_KEY` is set) plus Binance's symbol list, kept for 24 hours, shared by concurrent requests, and a failed load is retried at most once a minute (the last good list is served meanwhile, marked `stale`). An outbound firewall must allow those hosts. Each failure is logged once per refresh as `[market-lists] <list> <host> <status or reason>`, never with the key.
- `GET /api/settings` → `{ values: { <name>: <value> } }`, every stored setting; `GET /api/settings/<name>` → the value, or `404`. `PUT /api/settings/<name>` with a JSON body (at most 32 MB) stores it (`204`) and `DELETE` removes it (`204`, or `404`). A name is 1 to 128 letters, digits, `.`, `_` or `-`, starting with a letter or digit (`400` otherwise; `import` is reserved). `POST /api/settings/import` with `{ "values": { ... } }` (at most 64 MB) stores each valid name the server does not have yet and never overwrites one it has; the values it did not adopt are written together to `settings-imported-<ms>.json` in the data folder, and the answer is `{ adopted: [...], archived: [...], file: <file name or null> }`. Settings are same-origin only like the alert writes: `403` for a foreign `Origin` or `Sec-Fetch-Site: cross-site` on a write, no CORS header on any reply (reads and `OPTIONS` included), `415` without a JSON content type, `405` for another method, `413` over the size cap, and `503` naming `VOST_DATA_DIR` when the folder is not writable (reads still work). Every `403` and `503` is logged as `[settings] <status> <method> <path>: <reason>`.
- `GET /api/images` → `{ count, bytes, writable }`. `PUT /api/images/<key>?w=<w>&h=<h>` stores a picture of the Image drawing: the body is the raw bytes, `<key>` is their SHA-256 in 64 lowercase hex characters, `w` and `h` are its size (integers 1 to 16384) and the content type is `image/png`, `image/jpeg`, `image/gif` or `image/webp`. It answers `201 { key, w, h }` for a new picture and `200` for one already stored, `400` for a bad key, size or hash, `415 { code: "type" }` when the type or the bytes are not one of the four, `413 { code: "size" }` over 5 MB and `507 { code: "store" }` when the store would pass 50 MB. `GET /api/images/<key>` returns the bytes (cached for a year, `immutable`) or `404`. `POST /api/images/sweep` with `{ "refs": [key, ...] }` (JSON, at most 1 MB) keeps the pictures named in `refs` or anywhere in a stored setting, and removes the others that were last in use over 24 hours ago; the answer is `{ removed: [...] }`, and if the settings cannot be read nothing is removed. Pictures are same-origin only like the settings: `403` for a foreign `Origin` or `Sec-Fetch-Site: cross-site` on a write, no CORS header on any reply, and `503` naming `VOST_DATA_DIR` when the folder is not writable. Every `403` and `503` is logged as `[images] <status> <method> <path>: <reason>`.
- `/api/strategy-maker` keeps the strategy maker's data, same-origin only exactly like `/api/settings` (`403`, `415`, `405`, `413`, `503` naming `VOST_DATA_DIR`, no CORS header on any reply; every `403` and `503` is logged as `[strategy-maker] <status> <method> <path>: <reason>`). `GET /api/strategy-maker/sets` → `{ sets: [...] }`; `GET`, `PUT` (at most 32 MB, the body's `id` must equal the path's, `400` otherwise, `204`) and `DELETE` on `/api/strategy-maker/sets/<URI-encoded set id>`; the same on `/api/strategy-maker/inputs` (the find form) and `/api/strategy-maker/model`; `404` when absent. `POST /api/strategy-maker/import` with `{ sets, model }` (at most 128 MB) overwrites all-or-nothing: every file is written to a temp file first and renamed only when all succeeded (`503` and nothing changed otherwise). `POST /api/strategy-maker/migrate` with `{ sets, inputs, model }` (at most 128 MB) stores each record the server lacks, counts a record equal to the server's as present, and keeps the server's copy of a differing one while writing the browser's to `strategy-maker-imported-<ms>.json` in the data folder (never overwriting an existing file); the answer is `{ adopted, present, archived, file }` and it is logged as `[strategy-maker] migrate: adopted N, present P, archived A (<file>)`.
- The server writes to disk only to save `alerts.json` (atomically, on every change), `pine-libraries.json` (atomically, when a library is fetched, pasted or removed; a file it cannot read is renamed `pine-libraries.json.bad-<time>` and the server starts with none) one file per setting under `settings/` (atomically; a file that is not valid JSON is renamed `<name>.json.bad-<ms>` and reads as missing), the `settings-imported-<ms>.json` archive an import may write, the pictures under `images/` (bytes first, then `index.json`, both atomically; an unreadable `index.json` is renamed `index.json.bad-<ms>` and the index starts empty), one file per strategy maker set (`strategy-maker/set-<sha256 of the set id>.json`) plus `inputs.json` and `model.json` there (atomically, an import all-or-nothing), the `strategy-maker-imported-<ms>.json` archive a migration may write, and to keep `candles.sqlite` (with its `-wal` and `-shm` siblings while it runs). Back up by copying the whole data folder (stop the server first for a consistent `candles.sqlite`, or skip that file, which is safe to lose); a file it cannot read is renamed `alerts.json.bad-<time>` and the server starts with no alerts. A `candles.sqlite` that is corrupt or of another schema version is renamed `candles.sqlite.bad-<time>` (with its siblings) and a fresh one is created; if that fails too the store is off and the server carries on.

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
