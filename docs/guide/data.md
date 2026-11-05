# Data

## Providers

Pick a provider in the top bar. All remote data is fetched by the Vost server, so the browser never needs a key or a cross-origin call.

| Provider | Coverage | Live |
|---|---|---|
| Binance, Coinbase, Kraken, Bybit, OKX | Crypto spot | Yes |
| Hyperliquid Perps and Hyperliquid Spot | Crypto perpetuals and spot (latest 5000 bars per timeframe) | Yes |
| Yahoo Finance | Stocks, ETFs, indices, FX (delayed) | No |
| Demo (offline) | Synthetic, deterministic | No |

Limits per provider (such as Kraken's latest 720 candles, or Yahoo's intraday history) are in the [data sources](../DATA-SOURCES.md) survey and the README's table. The Demo provider needs no network.

### How history loads

By default a chart from a market provider (or Demo) opens on its latest 1000 bars and loads older bars in pages of 1000 as you scroll or zoom back, so a chart opens fast and the view stays where it is while older bars arrive. Paging stops at the start of the provider's history (or at 200000 loaded bars), and a failed page shows one warning in the inbox and is retried the next time you scroll back. There is no **Number of bars** menu in this mode. A local dataset, a chart range and bar replay never page.

The **Settings** popup (the gear at the right end of the top bar; see [Getting started](getting-started.md#the-settings-popup)), under **Charts**, **Chart history**, switches to the older behaviour by picking **Load all bars at once**. The choice is saved and the open charts reload at once: the **Number of bars** menu in the **Chart data** pop-up in the top bar (500 to 20k) sets how many bars one request loads, and nothing is paged in as you scroll. A backtest or optimizer run on Full data, or with a From before the loaded bars, still loads the older history it needs.

![Older bars paged in as the chart is zoomed out](../evidence/chart-history/chart-history-zoomed-out-desktop.png)

![A chart on Binance data](../evidence/chart/chart-desktop.png)

## How often data updates

Each kind of data has its own rhythm. "Fetched" means the Vost server asks the provider; "sent" means the server pushes to your browser.

| Data | Fetched from the provider | Sent to the browser |
|---|---|---|
| Live candles (Binance, Coinbase, Kraken, Bybit, OKX, Hyperliquid) | One websocket per feed, shared by every tab. How often it updates is set by the exchange (see [update rates](../DATA-SOURCES.md#update-rates)). | Every update is forwarded as soon as it arrives, with no extra delay or batching. One event stream per tab carries all its charts, with a keepalive every 15 s, and it reconnects by itself. |
| History | Only when a chart opens, changes or scrolls back (pages of 1000 bars). A recorded market loads from the server's store and fetches only what is missing. | On request, as the chart loads. |
| Yahoo Finance and Demo | No live stream. Yahoo data is itself delayed by the provider. | The chart shows what was loaded and refreshes only when you reload or change it. |
| Watchlist quotes | About once a minute: a row is checked every 15 s and its quote refetched once it is 60 s old, and only while the tab is visible. | On each refetch. |
| Alerts | Exchanges are watched on the live stream. Yahoo is polled every `VOST_ALERT_POLL` seconds (60 by default); see [Alerts](alerts.md). | Fired alerts arrive as they trigger. |
| Connection health checks | About once a minute (`VOST_STATUS_INTERVAL`); see [Connection light](charts.md#connection-light). | On each check. |
| Recorder hole filling | Every 15 minutes and after a feed drop, paced per provider. | Not applicable (stays on the server). |
| Symbol lists | Cached for 24 hours. | On request. |

## CSV import

Press **Import CSV** in the top bar, drop a file (or click to browse, or paste text). The parser detects the delimiter, a header row, the columns and the timestamp format, and shows a preview where you can change the delimiter, header, date order and the column roles. Name the dataset and import: it charts at once, with no network. **Load demo dataset** there makes synthetic data. Ready-made samples are in `examples/` in the repo. The README has the [list of formats](../../README.md#csv-import--the-offline-workflow) the parser accepts.

## Local library

Open **Data and library** from the icon rail. **Data** shows what is on the chart (range, bar count, last close) with **Save to library** and **Export CSV**. **Local library** lists the datasets you kept: click one to chart it, export it as CSV or delete it. Datasets are saved on the server, in its data folder, so you can chart and backtest them with no market-data network.

## Recorded markets

The server records some markets all the time into a candle store (`candles.sqlite` in `VOST_DATA_DIR`). By default that is BTC and ETH on Binance, Coinbase and Hyperliquid Perps, on every timeframe, kept back to 20000 bars. For you this means a recorded market loads from disk and Vost asks the exchange only for what is missing, so long histories open fast. Nothing changes in the UI; the store is safe to delete (history is refetched). To change what is recorded, see `VOST_RECORD` and `VOST_RECORD_BARS` in the [README configuration table](../../README.md#configuration) and [deployment](../DEPLOYMENT.md).
