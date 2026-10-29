# Data sources survey

Reference for the market-data providers Vost supports or could add. Issue #11 (Coinbase, Kraken, Bybit, OKX providers) should use this as its reference.

How to read it:

- Keyless endpoints were each called once on 2026-10-23 from the dev container. The result is in the "Checked" line of each section.
- Limits are quoted from each provider's own docs (linked per section). Where a limit is from memory of the docs and the page was not read for this survey, it is marked "verify". Free-tier limits change often; check the linked page before building.
- "Server hosts" are the hosts a server adapter in `server/providers/` calls. Since the server makes every REST call, browser CORS no longer decides whether a provider works; the "Browser CORS (checked)" column is kept as a survey fact.
- "Today" means a provider is in `shared/providerCatalog.ts` with an adapter in `server/providers/`.

## Time ranges

`GET /api/history` takes an optional `from` (unix seconds). With it, `bars` is optional and ignored, and every remote provider returns exactly the candles with `from <= time <= to`, ascending, no duplicates; `to` defaults to now and a later `to` is clamped to now. With `to` and `bars` but no `from`, the result is `bars` candles ending at `to`. A span of more than 20000 bars (`floor((to - from) / interval seconds) + 1`, a month counted as 30 days) is a 400 advising a shorter span or a larger timeframe. A span with no candles is a 404 naming the provider, symbol and span; a span only partly covered by history returns what exists. A series the server records is served from the server's own candle store under the same contract, fetching from the exchange only what the store lacks.

## Built timeframes

A timeframe a provider lacks is built by the server from its nearest lower native timeframe whose bars nest exactly in it, and the picker offers it marked (`4h *`). `timeframes` in the catalog stays the native list; `builtTimeframes` is derived from it (`shared/timeframes.ts`): Coinbase 30m (from 15m), 4h (from 1h), 1w and 1M (from 1d), Kraken 1M (from 1d), Yahoo 4h (from 1h). A built bar is the open of the first base bar, the close of the last, the highest high, the lowest low and the summed volume, stamped at its bucket start. The `/api/history` contract above is unchanged: a request for a built timeframe reads the base timeframe (through the candle store when it is recorded) in chunks of at most 20000 base bars, newest first, and answers ascending, without duplicates, with the provider's 404 wording naming the built timeframe.

Calendar rules:
- Crypto providers use UTC: intraday and daily buckets are multiples of their length, weeks start on Monday 00:00 UTC, months on the 1st 00:00 UTC. (Kraken's own weekly bars start on Thursday; Kraken 1w is native and is not rebuilt.)
- Yahoo uses the exchange calendar from the chart `meta` (`exchangeTimezoneName` and the regular session start): a trading day is the exchange-local date and 4h buckets count from that day's session open, so a US stock gets 9:30-13:30 and 13:30-16:00 ET, DST included.
- No partial bar passes as complete: the base fetch reaches one bucket before the oldest wanted bar and the oldest bucket present is dropped. Only the newest bar, still forming, may be partial, as with native bars.
- Live candles of a built timeframe are built by the server from the live stream of its base timeframe, which is shared with any chart on that base. Each update sends the whole higher bar. On every connect and reconnect the bar in progress is seeded from the base history (so it never looks smaller than the real one; a failed seed is retried every 15 s and nothing is shown for that bar meanwhile). The bar is closed once, when the first base update of the next bucket arrives (no close flag is needed).

### Custom intervals

`/api/history` and `/api/live` also take any interval written as a number and a unit: `<N>m`, `<N>h`, `<N>d`, `<N>w` or `<N>M` (months), N a positive integer without leading zeros, at most 1440 minutes, 168 hours, 365 days, 52 weeks or 12 months (checked on the spelling as written). Only the canonical spelling is accepted: whole hours and whole days are folded (`120m` is `2h`, `1440m` is `1d`, `48h` is `2d`, `168h` is `7d`; `7d` and `12M` stay). A value that does not parse, or is not canonical, is a 400 before any upstream call; so is a canonical interval the provider can neither serve nor build (`<Provider> does not support timeframe <tf>`). `/api/providers` does not list them.

- Base: the largest native timeframe below the interval that nests. For minutes, hours and days, a native timeframe of at most a day whose length divides the interval; for weeks, any native timeframe of at most a day (never native 1w, which starts on other days on some exchanges); for months, one of at most a day or native 1M.
- Buckets (UTC): a minute/hour interval that divides a day is a multiple of its length; one shorter than a day that does not (7h) restarts at each UTC midnight, so the day's last bucket is shorter; an hour interval longer than a day (36h) counts from 1970-01-01 00:00 UTC. `Nd` counts N-day buckets from 1970-01-01, `Nw` N-week buckets from Monday 1970-01-05, `NM` N-month buckets from January 1970 (3M is calendar quarters, 12M calendar years).
- Buckets (session calendar): `Nd`, `Nw` and `NM` count the same way over exchange-local days and are stamped at the session open of their first day; minute/hour intervals of at most a day count from each day's session open; an hour interval longer than a day uses the UTC rule.
- Live: a canonical interval with a base streams through the built live folder on the base timeframe's shared socket, as a built timeframe does.
- In the app: the timeframe picker ends with **Add interval...**, which opens the "Custom intervals" dialog (a number and a unit, a preview of the canonical name and its base). It refuses a value outside the limits above, one already in the picker, and one the provider can neither serve nor build. Saved intervals (at most 20, in `prefs.v1` as `customTimeframes`) are listed in the picker by bar length, marked `*` like built timeframes, and hidden on a provider that cannot serve them; the demo provider generates any interval directly. Removing one moves every chart showing it to the provider's default timeframe.

### The "Build higher timeframes from lower ones" setting

Both `GET /api/history` and `GET /api/live` take an optional `source`: absent or `native` serves the exchange's own bars as above; `built` builds every timeframe above the provider's lowest one from the next lower native timeframe that nests (Binance chains 4h from 1h, 1d from 4h, 1w and 1M from 1d). The lowest native timeframe, and any timeframe that is built anyway, behave as without it. Any other value is a 400 naming the allowed values (on `/api/live` a JSON 400 before any event-stream header). A built live bar shares the base timeframe's upstream socket with any chart open on that base. The client keeps the choice in its saved preferences (`buildTimeframes`, off by default), shows it as a toggle next to the timeframe picker (in the More menu on narrower screens), and marks every built option with `*` while it is on. CSV datasets and the demo provider ignore it; watchlist quotes stay native.

### One live stream per tab

`GET /api/live?sub=<key>&sub=<key>...` serves several subscriptions on one event stream, so a grid of live charts uses one browser connection. A key is `<provider>:<timeframe>:<source>:<symbol>` (`source` is `native` or `built`; the symbol is everything after the third `:`), URL-encoded per parameter. Duplicate keys collapse to one; more than 16 distinct keys is a JSON 400. Every `status`, `kline` and `log` event carries `sub: <key>`. A key the server cannot serve gets one tagged `status` with `fatal: true` and the other keys keep streaming; the response ends only when every key failed. The client changes the set make-before-break (the new stream opens before the old one closes) so the charts that stay are not interrupted. The older query (`provider`, `symbol`, `timeframe`, `source`) is still served, with untagged events.

Things to know with the setting on:
- Built daily bars for stocks (Yahoo) can differ slightly from the exchange's official daily bars.
- OKX's own daily bars use UTC+8 days; built ones use UTC days.
- History is shorter on providers with short lower-timeframe history: Yahoo 1m covers about 7 days, and Kraken keeps 720 bars per timeframe, so the higher timeframes reach back less far.

A probe on live data is in `docs/spikes/built-timeframes/`: Binance 4h, 1w and 1M built from lower bars equal the native ones exactly.

## Summary

| Source | Assets | Key | Live / websocket | Max candles per request | Browser CORS (checked) | Supported today |
|---|---|---|---|---|---|---|
| Binance | Crypto spot | No | Yes (ws) | 1000 | Yes (`*`) | Yes |
| Yahoo Finance | Stocks, ETFs, indices, FX, crypto | No | No (delayed) | Range based | No | Yes |
| Stooq | Stocks, indices, FX, crypto | No | No | Whole history (CSV) | Bot check blocks | No (dropped 2026-10-29) |
| Coinbase Exchange | Crypto spot | No | Yes (ws trades, candles built by Vost) | 300 | Yes (`*`) | Yes |
| Kraken | Crypto spot | No | Yes (ws) | 720 | No | Yes |
| Bybit | Crypto spot, derivatives | No | Yes (ws) | 1000 | Echoes origin | Yes (spot) |
| OKX | Crypto spot, derivatives | No | Yes (ws) | 100 (history) | Echoes origin | Yes (spot) |
| Hyperliquid | Crypto perps and spot | No | Yes (ws) | 5000 (latest 5000 kept) | Not checked (Vost server calls it) | Yes (perps and spot) |
| Alpha Vantage | Stocks, FX, crypto | Free key | No | Full / compact series | Not checked (needs key) | No |
| Twelve Data | Stocks, FX, crypto, ETFs | Free key | Websocket (paid tiers, verify) | 5000 | Not checked (needs key) | No |
| Finnhub | Stocks, FX, crypto | Free key | Yes (ws trades) | Varies | Not checked (needs key) | No |
| Tiingo | Stocks, ETFs, FX, crypto | Free key | Yes (ws, IEX) | Date range | Not checked (needs key) | No |

Recommended next: Twelve Data and Alpha Vantage as the free-key equity and FX sources. Finnhub and Tiingo are lower priority (see their sections).

## Binance (supported)

- Assets: crypto spot pairs (`BTCUSDT`).
- Symbol listing: `GET /api/v3/exchangeInfo`.
- Candles: `GET /api/v3/klines?symbol=&interval=&limit=&endTime=`.
- Timeframes: 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M.
- History: 1000 per request, paginate backwards with `endTime`; overall back to the pair's listing date. A span (`from`/`to`) starts at `endTime = to*1000 + 999` and pages back until the oldest kline is at or before `from`.
- Rate limits: weight based, 6000 weight per minute per IP (reported by `exchangeInfo`); a klines call costs 2 weight. [Docs](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-api-information).
- Server hosts: `api.binance.com`, falling back to `data-api.binance.vision`. The `.com` host is region blocked in some countries; `data-api.binance.vision` is the market-data-only mirror. The browser does not call these (CORS `*` was observed).
- Live: websocket `wss://stream.binance.com:9443/ws/<symbol>@kline_<interval>` (used by Vost). [Docs](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams).
- Key: none for market data.
- ToS: market data is for personal use; redistribution needs Binance's permission. [Terms](https://www.binance.com/en/terms).
- Checked 2026-10-23: `api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000` returned 200 with 1000 candles; `data-api.binance.vision` same path returned 200 with 1000 candles; `data-api.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT` returned 200.

## Yahoo Finance (supported)

- Assets: stocks, ETFs, indices, FX, crypto, worldwide exchanges.
- Symbol listing: no list; search with `GET /v1/finance/search?q=`.
- Candles: `GET /v8/finance/chart/<symbol>?interval=&range=`.
- Timeframes: 1m, 2m, 5m, 15m, 30m, 60m/1h, 1d, 5d, 1wk, 1mo, 3mo. No 4h natively: Vost builds it from 1h (see Built timeframes).
- History: intraday is capped (1m about 7 days, sub-hour about 60 days, 1h about 2 years); daily and up goes back to listing. Undocumented limits as observed by the community; Yahoo publishes no official API docs. A span uses `period1=from&period2=to+1` instead of `range=`; `range=max` makes Yahoo coarsen bars to 1mo/3mo, so full history is asked with `period1=0` and a reply of another granularity than asked is an error; an intraday `from` older than the depth above is a 400 naming the earliest time served.
- Rate limits: unpublished; HTTP 429 when exceeded, and datacenter IPs are throttled harder.
- Server hosts: `query1.finance.yahoo.com` (no CORS headers, so only a server can call it).
- Live: none (quotes are delayed by up to 15 minutes on some exchanges).
- Key: none.
- ToS: the API is unofficial and for personal use only; no redistribution. [Yahoo terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html).
- Checked 2026-10-23: `query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1mo` returned 200 with chart JSON; `/v1/finance/search?q=apple` returned 200 with quotes.

## Stooq (dropped)

Dropped on 2026-10-29: its CSV download is behind a browser challenge that a server cannot answer, so it no longer returned data. Yahoo Finance and CSV import cover the same assets. Saved watchlist entries for it are removed when the app starts, and a chart left on it opens on the default market. CSV import still reads Stooq's own CSV export format. The notes below are kept as the record.

- Assets: stocks (`aapl.us`), indices, FX, some crypto.
- Symbol listing: none by API; symbols are looked up on the website.
- Candles: `GET /q/d/l/?s=<symbol>&i=<d|w|m>` returns CSV.
- Timeframes: daily, weekly, monthly only.
- History: whole available history in one response. A span is cropped from that one response.
- Rate limits: unpublished; a daily hit limit exists and is enforced by a bot check.
- Server hosts: `stooq.com` (no CORS headers, so only a server can call it).
- Live: none.
- Key: none, though recent Stooq changes may require a browser-solved challenge.
- ToS: no API terms published; treat as personal use. [Site](https://stooq.com).
- Checked 2026-10-23: `stooq.com/q/d/l/?s=aapl.us&i=d` returned HTTP 200 but the body was an HTML page saying "This site requires JavaScript to verify your browser", not CSV. Stooq is blocked from this container; the README already names Yahoo and CSV import as fallbacks.

## Coinbase Exchange (supported, live candles built from trades)

- Assets: crypto spot (`BTC-USD`, USD, EUR, GBP and stablecoin quotes).
- Symbol listing: `GET https://api.exchange.coinbase.com/products`.
- Candles: `GET /products/<id>/candles?granularity=<seconds>&start=&end=`.
- Timeframes: 1m, 5m, 15m, 1h, 6h, 1d only (granularity 60, 300, 900, 3600, 21600, 86400). No 4h, 30m, 1w or 1M. Vost serves 1m, 5m, 15m, 1h and 1d natively (it has no 6h timeframe) and builds 30m (from 15m), 4h (from 1h), 1w and 1M (from 1d).
- History: at most 300 candles per request; paginate by `start`/`end`. Candles are only returned for periods with trades. A span steps fixed 300-candle windows from `to` back to `from` by time, so a window without trades does not end it early.
- Rate limits: public endpoints 10 requests per second per IP (burst 15). [Docs](https://docs.cdp.coinbase.com/exchange/docs/rest-rate-limits).
- Server hosts: `api.exchange.coinbase.com` (CORS `*` was observed, but the server makes the call).
- Live: websocket `wss://ws-feed.exchange.coinbase.com`. [Docs](https://docs.cdp.coinbase.com/exchange/docs/websocket-overview). The feed has no candle channel, so the server subscribes to the `matches` channel (`{"type":"subscribe","product_ids":["BTC-USD"],"channels":["matches"]}`; a `last_match` first, then one `match` per trade, no ping needed) and builds each candle itself: open is the first trade, high and low the extremes, close the latest, volume the sum of sizes, in buckets aligned to the granularity (1d at UTC midnight). On every connect and reconnect the bar in progress is seeded from Coinbase's REST candle for that bucket (trades seen before the socket opened only widen high and low, so nothing is counted twice), so it never looks smaller than the real one; if the seed fails it is retried every 15 s and nothing is shown for that bar meanwhile. The built timeframes (30m, 4h, 1w, 1M) stream live from this feed's 15m, 1h and 1d bars.
- Key: none for market data.
- ToS: market data is for use by the user; redistribution is restricted. [Terms](https://www.coinbase.com/legal/market_data).
- Docs: [API reference](https://docs.cdp.coinbase.com/exchange/docs/welcome).
- Checked 2026-10-23: `api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600` returned 200 with 350 rows (newest first, rows `[time, low, high, open, close, volume]`); `/products` returned 200 with 843 products. Note the 350 rows exceed the documented 300 cap; code for 300.

## Kraken (supported)

- Assets: crypto spot (and some fiat pairs); odd names such as `XBT` for BTC and `XXBTZUSD` as result keys.
- Symbol listing: `GET https://api.kraken.com/0/public/AssetPairs`.
- Candles: `GET /0/public/OHLC?pair=&interval=<minutes>&since=`.
- Timeframes: 1, 5, 15, 30, 60, 240, 1440, 10080, 21600 minutes.
- History: the last 720 candles only, regardless of `since`. Longer history needs the trades endpoint or the downloadable CSV files. Vost therefore caps Kraken history at 720 bars. A span is cropped from those 720; a span that ends before them is a 404 naming the earliest time served.
- Rate limits: public calls share a counter per IP; roughly 1 call per second sustained. [Docs](https://docs.kraken.com/api/docs/guides/spot-rest-ratelimits).
- Server hosts: `api.kraken.com` (no CORS headers seen).
- Live: websocket v2 `wss://ws.kraken.com/v2`. [Docs](https://docs.kraken.com/api/docs/websocket-v2/ohlc). The built 1M streams live from the 1d feed.
- Key: none for public data.
- ToS: [Kraken terms](https://www.kraken.com/legal); redistribution not permitted without agreement.
- Docs: [REST API](https://docs.kraken.com/api/).
- Checked 2026-10-23: `api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60` returned 200 with 721 candles (720 plus the open one); `/0/public/AssetPairs` returned 200 with 1463 pairs.

## Bybit (supported, spot)

- Assets: crypto spot, linear and inverse derivatives (`category` selects).
- Symbol listing: `GET https://api.bybit.com/v5/market/instruments-info?category=spot`.
- Candles: `GET /v5/market/kline?category=&symbol=&interval=&limit=&start=&end=`.
- Timeframes: 1, 3, 5, 15, 30, 60, 120, 240, 360, 720 minutes, D, W, M.
- History: 1000 per request, paginate with `end`; overall back to listing. A span starts at `end = to*1000 + 999` and pages back until `from`.
- Rate limits: 600 requests per 5 seconds per IP across HTTP. [Docs](https://bybit-exchange.github.io/docs/v5/rate-limit).
- Server hosts: `api.bybit.com` (the server echoes the request origin in `access-control-allow-origin`, but the Vost server makes the call). Bybit blocks some regions (for example the US); use `api.bytick.com` as the alternate host (verify).
- Live: websocket `wss://stream.bybit.com/v5/public/spot`. [Docs](https://bybit-exchange.github.io/docs/v5/ws/connect).
- Key: none for market data.
- ToS: [Bybit terms](https://www.bybit.com/en/help-center/article/Terms-of-Service); personal use.
- Docs: [V5 API](https://bybit-exchange.github.io/docs/v5/intro).
- Checked 2026-10-23: `api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=60&limit=1000` returned 200, retCode 0, 1000 candles (newest first, strings); `instruments-info?category=spot` returned 200 with 527 instruments.

## OKX (supported, spot)

- Assets: crypto spot, swaps, futures, options (`BTC-USDT`).
- Symbol listing: `GET https://www.okx.com/api/v5/public/instruments?instType=SPOT`.
- Candles: `GET /api/v5/market/candles` (recent, up to 300) and `/api/v5/market/history-candles` (older, up to 100 per request), with `instId`, `bar`, `after`/`before` cursors.
- Timeframes: 1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 12H, 1D, 1W, 1M and others.
- History: 100 per request on `history-candles`, paginate by cursor; deep history is available. A span starts at `after = (to+1)*1000` and pages back until `from`.
- Rate limits: 20 requests per 2 seconds per IP for candle endpoints. [Docs](https://www.okx.com/docs-v5/en/#overview-rate-limits).
- Server hosts: `www.okx.com` (origin is echoed, but the Vost server makes the call).
- Live: websocket `wss://ws.okx.com:8443/ws/v5/business` for candles. [Docs](https://www.okx.com/docs-v5/en/#order-book-trading-market-data-ws-candlesticks-channel).
- Key: none for public data.
- ToS: [OKX terms](https://www.okx.com/help/terms-of-service); personal use.
- Docs: [API v5](https://www.okx.com/docs-v5/en/).
- Checked 2026-10-23: `www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=1H&limit=100` returned 200, code 0, 100 candles; `/api/v5/public/instruments?instType=SPOT` returned 200 with 1212 instruments.

## Hyperliquid (supported, perps and spot)

Two providers share one adapter file: "Hyperliquid Perps" (`hyperliquid-perps`) and "Hyperliquid Spot" (`hyperliquid-spot`).

- Endpoint: every REST call is `POST https://api.hyperliquid.xyz/info` with a JSON body (`content-type: application/json`).
- Perps list: `{"type":"meta"}` returns `universe[]` of `{name, szDecimals, maxLeverage, isDelisted?}` (235 markets, 56 of them `isDelisted: true`, on 2026-10-29). Seven names are mixed case (`kPEPE`, `kSHIB`, `kBONK`, `kLUNC`, `kFLOKI`, `kDOGS`, `kNEIRO`).
- Spot list: `{"type":"spotMeta"}` returns `tokens[]` (511) and `universe[]` of `{tokens:[base,quote], name, index}` (347 pairs). A token's `index` is not its position in `tokens[]` (the highest is 1308): look tokens up by `.index`.
- Coin naming: perps use the name (`BTC`, `kPEPE`); spot pairs use `@<index>` (HYPE/USDC is `@107`, UBTC/USDC `@142`, UETH/USDC `@151`, USOL/USDC `@156`) except `PURR/USDC`, which is its own name. Names are case-sensitive: `btc` answers HTTP 500 with body `null`. Vost symbols are `BTC`, `kPEPE` and `HYPE/USDC` (readable `<BASE>/<QUOTE>`, `@107` also accepted); the server maps any letter case to the exact coin and answers 404 for an unknown symbol.
- Candles: `{"type":"candleSnapshot","req":{"coin":"BTC","interval":"1h","startTime":<ms>,"endTime":<ms>}}` returns an ascending array of `{t,T,s,i,o,c,h,l,v,n}` (strings for prices and volume, `t` open time in ms, `T` close time). `endTime` is inclusive. A span with no data answers 200 `[]`.
- Timeframes: per the docs 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d, 3d, 1w, 1M (Vost offers 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M).
- Retention: only the latest 5000 candles per timeframe are kept (a 1h request from time 0 returned 5003 candles, the oldest in 2026-04), so 1m history covers about 3.5 days. A span starts at `endTime = to*1000 + 999` and pages back in windows of at most 5000 candles until `from` or an empty window.
- Rate limits: about 1200 weight per minute per IP across REST (per the docs; `candleSnapshot` costs extra weight per 60 candles returned). [Docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits).
- Live: websocket `wss://api.hyperliquid.xyz/ws`. Subscribe with `{"method":"subscribe","subscription":{"type":"candle","coin":"BTC","interval":"1m"}}`; the reply is a `subscriptionResponse` frame, then `{"channel":"candle","data":{t,T,s,i,o,c,h,l,v,n}}` frames where `s` is the coin and `i` the interval. There is no close flag: Vost marks a candle closed when a frame with a newer `t` arrives. Keepalive: send `{"method":"ping"}` (answered with `{"channel":"pong"}`) every 20 s, (per the docs, the server closes a socket silent for 60 s). Limits per IP (per the docs): 100 connections, 1000 subscriptions, 2000 messages per minute.
- Key: none for market data.
- ToS: personal use; check [Hyperliquid terms](https://app.hyperliquid.xyz/terms).
- Docs: [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint), [Websocket](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket).
- Checked 2026-10-29: `meta`, `spotMeta` and `candleSnapshot` (BTC 1h) answered 200 with the shapes above; a websocket subscribe to BTC 1m answered `subscriptionResponse`, then `candle` frames, and `{"method":"ping"}` answered `{"channel":"pong"}`; subscribing `@107` 1m streamed frames with `s: "@107"`.

## Alpha Vantage (not supported, free key)

Not requested from the container (needs a key). Facts are from the provider docs and pricing pages; verify before building.

- Assets: stocks, ETFs, FX, crypto, indices, commodities.
- Symbol listing: `function=SYMBOL_SEARCH` (search) and `LISTING_STATUS` (CSV of US listings).
- Candles: `function=TIME_SERIES_INTRADAY|DAILY|WEEKLY|MONTHLY`, `FX_DAILY`, `DIGITAL_CURRENCY_DAILY`.
- Timeframes: intraday 1, 5, 15, 30, 60 min, then daily, weekly, monthly.
- History: `outputsize=full` returns the full daily history (20+ years); intraday goes back by month with the `month` parameter. Some intraday and adjusted endpoints are premium only.
- Rate limits: free tier is 25 requests per day (verify). [Docs](https://www.alphavantage.co/documentation/), [premium plans](https://www.alphavantage.co/premium/).
- Server hosts: `www.alphavantage.co` (browser CORS not checked; the server would make the call).
- Live: none (polling only).
- Key: free key from the site; sent as the `apikey` query parameter, so the key would sit in the proxied URL.
- ToS: free tier is for personal, non-commercial use. [Terms](https://www.alphavantage.co/terms_of_service/).

## Twelve Data (not supported, free key)

Not requested from the container (needs a key); verify before building.

- Assets: stocks, ETFs, indices, FX, crypto.
- Symbol listing: `/stocks`, `/forex_pairs`, `/cryptocurrencies`, `/symbol_search`.
- Candles: `GET https://api.twelvedata.com/time_series?symbol=&interval=&outputsize=&apikey=`.
- Timeframes: 1min, 5min, 15min, 30min, 45min, 1h, 2h, 4h, 1day, 1week, 1month.
- History: up to 5000 points per request; overall depth varies by symbol.
- Rate limits: free "Basic" plan is 8 requests per minute and 800 per day (verify). [Docs](https://twelvedata.com/docs), [pricing](https://twelvedata.com/pricing).
- Server hosts: `api.twelvedata.com` (browser CORS not checked; the server would make the call).
- Live: websocket exists; availability on the free plan is limited (verify).
- Key: free key; `apikey` query parameter or `Authorization` header.
- ToS: free plan is for personal use; data display and redistribution rules per exchange. [Terms](https://twelvedata.com/terms).

## Finnhub (not supported, free key)

Not requested from the container (needs a key); verify before building.

- Assets: stocks (US free), FX, crypto.
- Symbol listing: `/stock/symbol?exchange=US`, `/forex/symbol`, `/crypto/symbol`.
- Candles: `/stock/candle?symbol=&resolution=&from=&to=`. Stock candles have been moved to paid plans; FX and crypto candles have a different availability. Verify on the docs before choosing Finnhub.
- Timeframes: 1, 5, 15, 30, 60, D, W, M.
- History: by `from`/`to` range.
- Rate limits: 60 API calls per minute on the free plan, with a 30 per second hard cap (verify). [Docs](https://finnhub.io/docs/api), [pricing](https://finnhub.io/pricing).
- Server hosts: `finnhub.io` (browser CORS not checked; the server would make the call).
- Live: websocket `wss://ws.finnhub.io` for trades.
- Key: free key; `token` query parameter or `X-Finnhub-Token` header (the header keeps the key out of the URL).
- ToS: personal use on free plans. [Terms](https://finnhub.io/terms-of-service).

## Tiingo (not supported, free key)

Not requested from the container (needs a key); verify before building.

- Assets: US stocks and ETFs (end of day), IEX intraday, FX, crypto.
- Symbol listing: a downloadable supported-tickers file; no search endpoint on the free plan (verify).
- Candles: `/tiingo/daily/<ticker>/prices?startDate=&endDate=`, `/iex/<ticker>/prices?resampleFreq=`, `/tiingo/crypto/prices`, `/tiingo/fx/<pair>/prices`.
- Timeframes: daily and up for equities; intraday from 1min via IEX, FX and crypto.
- History: end-of-day history goes back decades; intraday history is limited.
- Rate limits: free plan about 50 requests per hour, 1000 per day and 500 unique symbols per month (verify). [Docs](https://www.tiingo.com/documentation/general/overview), [pricing](https://www.tiingo.com/about/pricing).
- Server hosts: `api.tiingo.com` (browser CORS not checked; the server would make the call).
- Live: websocket for IEX, FX and crypto (restricted on the free plan, verify).
- Key: free token; `Authorization: Token <key>` header or `token` query parameter.
- ToS: free plan is for personal use only. [Terms](https://www.tiingo.com/about/terms).

## Link check

Provider docs links were requested with `curl -sIL` on 2026-10-23. The ones used above returned 200, except `developers.binance.com` (202, a bot-challenge page that serves content in a browser) and `finnhub.io/docs/api` and `finnhub.io/pricing` (302, redirected; the final page was not followed to a 200 here). Other links (terms pages, rate limit sub-pages) were not individually checked.
