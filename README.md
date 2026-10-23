<div align="center">

# Vost

**Self-hosted, open-source charts & backtesting — a TradingView alternative you actually own.**

Pull free public market data, import your own CSV files, chart them with [lightweight-charts](https://github.com/tradingview/lightweight-charts), and run **unlimited** backtests with a parameter optimizer — all from a single Node process with **zero runtime dependencies**.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)
[![CI](https://github.com/AuthorShin/Vost/actions/workflows/ci.yml/badge.svg)](https://github.com/AuthorShin/Vost/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen.svg)](#quick-start)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## Why Vost?

| | |
|---|---|
| 🔑 **No accounts, no keys, no quotas** | Data comes from free public APIs (Binance, Yahoo Finance, Stooq) or your own files. Nothing is metered, nothing phones home. |
| 📴 **Works completely offline** | Import an OHLCV CSV → chart it → backtest it. Parsing, storing and computing all happen **in your browser**. Airplane-mode friendly. |
| ♾️ **Unlimited backtests** | No "upgrade to run more". The engine runs client-side in a Web Worker; even 100k-bar datasets and thousands-of-combinations grid searches are just local CPU. |
| 🏠 **Self-hosted in one command** | `docker compose up` or `npm start`. A single Node process serves the app and a *whitelisted* data proxy. |
| 🧪 **A backtester that respects reality** | Next-bar-open fills, fees & slippage in bps, stop loss / take profit, long & short, position sizing, equity curve, drawdown, Sharpe/Sortino/Calmar… |
| 🧩 **Hackable** | ~40 lines to plug in your own market-data API. Custom signal logic in plain JavaScript. Everything is TypeScript, everything is tested. |

## Feature tour

**Charting**
- Candlestick chart with volume, powered by TradingView's open-source *lightweight-charts* (v5, panes supported)
- Indicators: SMA, EMA, Bollinger Bands, VWAP, Volume, RSI, MACD — configurable periods & colors, live editing
- Crosshair legend with OHLC + change + volume, fit-to-screen, PNG screenshot, CSV export
- Live streaming candles from Binance websockets (auto-reconnect, data-stream fallback host)

**Data**
- **Binance** — free public crypto klines + realtime websocket, no key
- **Yahoo Finance** — stocks, ETFs, indices, forex, crypto (delayed), no key
- **Stooq** — free historical stocks/indices/FX/crypto CSV downloads, no key
- **Demo** — deterministic synthetic candles, fully offline
- **CSV import** — auto-detects delimiter, header, column roles, and ~8 timestamp formats (see [CSV support](#csv-import--the-offline-workflow))
- Local library: imported datasets persist in browser storage; chart & backtest with the network off

**Backtesting**
- Built-in strategies: SMA/EMA crossover, MACD, RSI mean-reversion, Bollinger (breakout & reversion), Donchian breakout, Buy & hold — plus **custom JavaScript strategies**
- Engine: single position, next-bar-open fills, bps fees & slippage per side, intrabar stops/takes (stop-first conservative assumption, gap-through fills), shorts optional
- Results: 20+ metrics (CAGR, Sharpe, Sortino, Calmar, max drawdown & duration, profit factor, exposure, expectancy…), equity + underwater chart, full trade log, CSV exports, trade markers drawn on the chart
- **Optimizer**: grid-search one or two parameters, ranked by any metric, with a clickable heatmap — apply the best combo and re-run in one click

## Quick start

### Docker (recommended for self-hosting)

```bash
git clone https://github.com/AuthorShin/Vost.git
cd Vost
docker compose up -d
```

Open <http://localhost:8787>. Done.

### Local (Node 24 recommended, 20.19+ supported)

```bash
git clone https://github.com/AuthorShin/Vost.git
cd Vost
npm install
npm run build     # typecheck + bundle the web client
npm start         # serves http://localhost:8787
```

### Development

```bash
npm run dev        # API server (:8787) + Vite dev server (:5173) with HMR
npm test           # unit + integration tests (vitest)
npm run typecheck  # strict TypeScript
```

## Data sources

| Provider | Coverage | Key needed | Live | Notes |
|---|---|---|---|---|
| **Binance** | Crypto (1000+ pairs) | No | ✅ | Public REST + websocket. Falls back to `data-api.binance.vision` when the main host is region-blocked. |
| **Coinbase** | Crypto spot | No | — | Public REST candles (300 per request). The public feed has no candle channel, so no live streaming. |
| **Kraken** | Crypto spot | No | ✅ | Public REST + websocket v2. History is limited to the latest 720 candles per timeframe. |
| **Bybit** | Crypto spot | No | ✅ | Public v5 REST (1000 per request) + websocket. |
| **OKX** | Crypto spot | No | ✅ | Public v5 history candles (100 per request) + websocket. |
| **Yahoo Finance** | Stocks, ETFs, indices, FX, crypto | No | — | Public chart API (delayed). Intraday history limits apply (1m ≈ 7 days, 1h ≈ 2 years). |
| **Stooq** | Stocks, indices, FX, crypto | No | — | Daily/weekly/monthly CSV downloads. Some cloud/VPS IPs are challenged by Stooq's bot protection — Yahoo or CSV import are good fallbacks there. |
| **Demo (offline)** | Synthetic | No | — | Deterministic random walk — try the whole app with zero network. |
| **CSV import** | Anything you have | No | — | Fully offline workflow. See below. |

For a full comparison of these and candidate providers (limits, CORS, keys, terms), see [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

All remote requests go through the app's own tiny proxy (`/api/proxy?url=…`) which only forwards to a **whitelist** of hosts (`server/index.mjs → ALLOWED_HOSTS`). Your browser never talks to third parties directly unless you deploy static-only with `VITE_DIRECT=true`.

> **Bring your own API:** implement the `DataProvider` interface in `client/src/lib/providers/` and register it — the UI picks it up automatically in the provider dropdown. See [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-data-provider).

## CSV import — the offline workflow

Drag a file (or paste text) into **Import CSV**. The parser auto-detects:

- **Delimiter**: comma, semicolon, tab, pipe, space
- **Header**: present/absent (and MT4/MT5 `<DATE>` `<TIME>` style headers)
- **Columns**: time/date, open, high, low, close, volume — matched by name or by position
- **Timestamps**: UNIX seconds / milliseconds / nanoseconds, `YYYY-MM-DD`, `YYYY/MM/DD`, `dd/mm/yyyy` & `mm/dd/yyyy`, `YYYYMMDD`, `2024.01.02 09:30`, Excel serial numbers, month names
- **Split DATE + TIME columns** (classic MT4/MT5 exports)
- Rows are validated (high ≥ max(o,c), low ≤ min(o,c)), duplicates collapsed, and the bar interval is inferred

Everything is editable in a column-mapping preview before import. Two ready-made examples live in [`examples/`](examples/):

```bash
# standard daily CSV with header
open examples/sample-daily.csv
# tab-separated MT5-style export with split DATE/TIME
open examples/sample-mt5-format.csv
```

Imported datasets live in your browser's local storage (Library section in the sidebar) and can be exported back to CSV at any time.

## Backtesting

Signals are computed per bar from data **up to and including that bar**, then executed at the **next bar's open** — no look-ahead, ever. Fees and slippage are charged on both sides in basis points.

| Strategy | Idea | Parameters |
|---|---|---|
| SMA crossover | Golden/death cross | fast, slow, direction |
| EMA crossover | Faster cross | fast, slow, direction |
| MACD | Histogram > 0 | fast, slow, signal, direction |
| RSI mean reversion | Buy the oversold cross back up | length, oversold, overbought, direction |
| Bollinger | Band breakout or mean reversion, exit at middle | length, mult, mode, direction |
| Donchian breakout | Turtle-style channel break | entry, exit, direction |
| Buy & hold | The benchmark | — |
| Custom (JS) | Your code | your params (JSON) |

Risk controls: initial capital, position size (% of equity), fees (bps), slippage (bps), stop loss %, take profit %, long/short toggle.

The **Optimizer** runs full backtests over a 1D or 2D parameter grid inside the same Web Worker (progress bar included), ranks results by any metric, and renders a heatmap. Click a cell → parameters applied → backtest re-run.

Custom strategies are plain JavaScript with indicator helpers, executed in the worker:

```js
// Available: candles, params, indicators {sma, ema, rsi, macd, bollinger, atr,
// vwap, highest, lowest, stdev, crossover, crossunder}
// Return per-bar signals: 1 = long, 0 = flat, -1 = short, null = warm-up
const fast = indicators.sma(undefined, params.fast || 10);
const slow = indicators.sma(undefined, params.slow || 30);
const signals = new Array(candles.length).fill(null);
for (let i = 0; i < candles.length; i++) {
  if (fast[i] == null || slow[i] == null) continue;
  signals[i] = fast[i] > slow[i] ? 1 : 0;
}
return signals;
```

Full guide: [docs/STRATEGIES.md](docs/STRATEGIES.md).

## Architecture

```
Vost/
├── client/                    # Vite + React + TypeScript web app
│   └── src/
│       ├── components/        # UI: chart panel, top bar, dock, CSV modal…
│       ├── lib/
│       │   ├── providers/     # data providers (binance, yahoo, stooq, demo)
│       │   ├── backtest/      # engine, metrics, strategies, optimizer
│       │   ├── csv.ts         # dialect-tolerant CSV import engine
│       │   ├── indicators.ts  # SMA/EMA/RSI/MACD/BB/ATR/VWAP…
│       │   └── workers/       # backtest Web Worker
│       └── state/             # zustand store (prefs, datasets, runs)
├── server/
│   └── index.mjs              # zero-dep Node server: static + whitelisted proxy
├── examples/                  # ready-to-import sample CSVs
└── docs/                      # strategy authoring & deployment guides
```

- The **server** does two things: serve `client/dist` and forward `/api/proxy?url=` requests to allow-listed market-data hosts (needed because Yahoo/Stooq send no CORS headers). No database, no state.
- The **client** holds everything else: fetching, CSV parsing, indicator math, backtests (in a Web Worker), persistence (localStorage). This is what makes offline mode work.

### Configuration

| Variable | Where | Default | Meaning |
|---|---|---|---|
| `PORT` | server | `8787` | HTTP port |
| `HOST` | server | `0.0.0.0` | Bind address (use `127.0.0.1` behind a reverse proxy) |
| `VITE_DIRECT` | build-time | unset | `true` → skip the proxy and fetch upstreams directly (static-only hosting; CORS applies) |
| `VITE_PROXY_PREFIX` | build-time | `/api/proxy` | Override the proxy path prefix |
| `VOST_SERVER_URL` | dev | `http://localhost:8787` | Target for the Vite dev proxy |

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Docker, systemd, nginx/TLS examples and static-hosting notes.

## Roadmap

- [ ] Drawing tools (trend lines, fibs, rectangles)
- [ ] Alerts on price/indicator conditions
- [ ] Multiple chart layouts & compare mode
- [ ] More providers: keyless crypto exchanges (Coinbase, Kraken, Bybit, OKX) then free-key Twelve Data and Alpha Vantage - see [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)
- [ ] Walk-forward & portfolio (multi-asset) backtesting
- [ ] PWA install for full offline app caching
- [ ] Indicator/strategy plugin files loaded from disk

PRs are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

Vost is a tool for research and education. Market data may be delayed, incomplete or inaccurate; backtest results are hypothetical and ignore many real-world effects (liquidity, funding, borrow costs, survivorship bias…). Nothing here is financial advice. Respect the terms of service of any data provider you use.

## License

[MIT](LICENSE) — do whatever you want, no warranty.
