# Data sources survey

Reference for the market-data providers Vost supports or could add. Issue #11 (Coinbase, Kraken, Bybit, OKX providers) should use this as its reference.

How to read it:

- Keyless endpoints were each called once on 2026-10-23 from the dev container. The result is in the "Checked" line of each section.
- Limits are quoted from each provider's own docs (linked per section). Where a limit is from memory of the docs and the page was not read for this survey, it is marked "verify". Free-tier limits change often; check the linked page before building.
- "Proxy hosts" are the hosts that would be added to `ALLOWED_HOSTS` in `server/index.mjs`. A host with browser CORS enabled can be called directly with `VITE_DIRECT=true`; otherwise it needs the proxy.
- "Today" means a provider is registered in `client/src/lib/providers/`.

## Summary

| Source | Assets | Key | Live / websocket | Max candles per request | Browser CORS (checked) | Supported today |
|---|---|---|---|---|---|---|
| Binance | Crypto spot | No | Yes (ws) | 1000 | Yes (`*`) | Yes |
| Yahoo Finance | Stocks, ETFs, indices, FX, crypto | No | No (delayed) | Range based | No | Yes |
| Stooq | Stocks, indices, FX, crypto | No | No | Whole history (CSV) | Bot check blocks | Yes |
| Coinbase Exchange | Crypto spot | No | Yes (ws, no candle channel) | 300 | Yes (`*`) | Yes (history only) |
| Kraken | Crypto spot | No | Yes (ws) | 720 | No | Yes |
| Bybit | Crypto spot, derivatives | No | Yes (ws) | 1000 | Echoes origin | Yes (spot) |
| OKX | Crypto spot, derivatives | No | Yes (ws) | 100 (history) | Echoes origin | Yes (spot) |
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
- History: 1000 per request, paginate backwards with `endTime`; overall back to the pair's listing date.
- Rate limits: weight based, 6000 weight per minute per IP (reported by `exchangeInfo`); a klines call costs 2 weight. [Docs](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-api-information).
- CORS / proxy: CORS `*`. Proxy hosts already allowed: `api.binance.com`, `api1`-`api4.binance.com`, `data-api.binance.vision`. The `.com` host is region blocked in some countries; `data-api.binance.vision` is the market-data-only mirror.
- Live: websocket `wss://stream.binance.com:9443/ws/<symbol>@kline_<interval>` (used by Vost). [Docs](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams).
- Key: none for market data.
- ToS: market data is for personal use; redistribution needs Binance's permission. [Terms](https://www.binance.com/en/terms).
- Checked 2026-10-23: `api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000` returned 200 with 1000 candles; `data-api.binance.vision` same path returned 200 with 1000 candles; `data-api.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT` returned 200.

## Yahoo Finance (supported)

- Assets: stocks, ETFs, indices, FX, crypto, worldwide exchanges.
- Symbol listing: no list; search with `GET /v1/finance/search?q=`.
- Candles: `GET /v8/finance/chart/<symbol>?interval=&range=`.
- Timeframes: 1m, 2m, 5m, 15m, 30m, 60m/1h, 1d, 5d, 1wk, 1mo, 3mo. No 4h.
- History: intraday is capped (1m about 7 days, sub-hour about 60 days, 1h about 2 years); daily and up goes back to listing. Undocumented limits as observed by the community; Yahoo publishes no official API docs.
- Rate limits: unpublished; HTTP 429 when exceeded, and datacenter IPs are throttled harder.
- CORS / proxy: no CORS headers, so the proxy is needed. Proxy hosts already allowed: `query1.finance.yahoo.com`, `query2.finance.yahoo.com`.
- Live: none (quotes are delayed by up to 15 minutes on some exchanges).
- Key: none.
- ToS: the API is unofficial and for personal use only; no redistribution. [Yahoo terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html).
- Checked 2026-10-23: `query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1mo` returned 200 with chart JSON; `/v1/finance/search?q=apple` returned 200 with quotes.

## Stooq (supported)

- Assets: stocks (`aapl.us`), indices, FX, some crypto.
- Symbol listing: none by API; symbols are looked up on the website.
- Candles: `GET /q/d/l/?s=<symbol>&i=<d|w|m>` returns CSV.
- Timeframes: daily, weekly, monthly only.
- History: whole available history in one response.
- Rate limits: unpublished; a daily hit limit exists and is enforced by a bot check.
- CORS / proxy: proxy needed. Proxy hosts already allowed: `stooq.com`, `stooq.pl`.
- Live: none.
- Key: none, though recent Stooq changes may require a browser-solved challenge.
- ToS: no API terms published; treat as personal use. [Site](https://stooq.com).
- Checked 2026-10-23: `stooq.com/q/d/l/?s=aapl.us&i=d` returned HTTP 200 but the body was an HTML page saying "This site requires JavaScript to verify your browser", not CSV. Stooq is blocked from this container; the README already names Yahoo and CSV import as fallbacks.

## Coinbase Exchange (supported, history only)

- Assets: crypto spot (`BTC-USD`, USD, EUR, GBP and stablecoin quotes).
- Symbol listing: `GET https://api.exchange.coinbase.com/products`.
- Candles: `GET /products/<id>/candles?granularity=<seconds>&start=&end=`.
- Timeframes: 1m, 5m, 15m, 1h, 6h, 1d only (granularity 60, 300, 900, 3600, 21600, 86400). No 4h; build it from 1h. Vost offers 1m, 5m, 15m, 1h and 1d (it has no 6h timeframe).
- History: at most 300 candles per request; paginate by `start`/`end`. Candles are only returned for periods with trades.
- Rate limits: public endpoints 10 requests per second per IP (burst 15). [Docs](https://docs.cdp.coinbase.com/exchange/docs/rest-rate-limits).
- CORS / proxy: CORS `*`, so direct calls work. For the proxy add `api.exchange.coinbase.com`.
- Live: websocket `wss://ws-feed.exchange.coinbase.com`. [Docs](https://docs.cdp.coinbase.com/exchange/docs/websocket-overview). The feed has no candle channel, so Vost does not offer live streaming for Coinbase.
- Key: none for market data.
- ToS: market data is for use by the user; redistribution is restricted. [Terms](https://www.coinbase.com/legal/market_data).
- Docs: [API reference](https://docs.cdp.coinbase.com/exchange/docs/welcome).
- Checked 2026-10-23: `api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600` returned 200 with 350 rows (newest first, rows `[time, low, high, open, close, volume]`); `/products` returned 200 with 843 products. Note the 350 rows exceed the documented 300 cap; code for 300.

## Kraken (supported)

- Assets: crypto spot (and some fiat pairs); odd names such as `XBT` for BTC and `XXBTZUSD` as result keys.
- Symbol listing: `GET https://api.kraken.com/0/public/AssetPairs`.
- Candles: `GET /0/public/OHLC?pair=&interval=<minutes>&since=`.
- Timeframes: 1, 5, 15, 30, 60, 240, 1440, 10080, 21600 minutes.
- History: the last 720 candles only, regardless of `since`. Longer history needs the trades endpoint or the downloadable CSV files. Vost therefore caps Kraken history at 720 bars.
- Rate limits: public calls share a counter per IP; roughly 1 call per second sustained. [Docs](https://docs.kraken.com/api/docs/guides/spot-rest-ratelimits).
- CORS / proxy: no CORS headers seen, so use the proxy. Add `api.kraken.com`.
- Live: websocket v2 `wss://ws.kraken.com/v2`. [Docs](https://docs.kraken.com/api/docs/websocket-v2/ohlc).
- Key: none for public data.
- ToS: [Kraken terms](https://www.kraken.com/legal); redistribution not permitted without agreement.
- Docs: [REST API](https://docs.kraken.com/api/).
- Checked 2026-10-23: `api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60` returned 200 with 721 candles (720 plus the open one); `/0/public/AssetPairs` returned 200 with 1463 pairs.

## Bybit (supported, spot)

- Assets: crypto spot, linear and inverse derivatives (`category` selects).
- Symbol listing: `GET https://api.bybit.com/v5/market/instruments-info?category=spot`.
- Candles: `GET /v5/market/kline?category=&symbol=&interval=&limit=&start=&end=`.
- Timeframes: 1, 3, 5, 15, 30, 60, 120, 240, 360, 720 minutes, D, W, M.
- History: 1000 per request, paginate with `end`; overall back to listing.
- Rate limits: 600 requests per 5 seconds per IP across HTTP. [Docs](https://bybit-exchange.github.io/docs/v5/rate-limit).
- CORS / proxy: the server echoes the request origin in `access-control-allow-origin`, so direct calls work. For the proxy add `api.bybit.com`. Bybit blocks some regions (for example the US); use `api.bytick.com` as the alternate host (verify).
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
- History: 100 per request on `history-candles`, paginate by cursor; deep history is available.
- Rate limits: 20 requests per 2 seconds per IP for candle endpoints. [Docs](https://www.okx.com/docs-v5/en/#overview-rate-limits).
- CORS / proxy: origin is echoed, so direct calls work. For the proxy add `www.okx.com`.
- Live: websocket `wss://ws.okx.com:8443/ws/v5/business` for candles. [Docs](https://www.okx.com/docs-v5/en/#order-book-trading-market-data-ws-candlesticks-channel).
- Key: none for public data.
- ToS: [OKX terms](https://www.okx.com/help/terms-of-service); personal use.
- Docs: [API v5](https://www.okx.com/docs-v5/en/).
- Checked 2026-10-23: `www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=1H&limit=100` returned 200, code 0, 100 candles; `/api/v5/public/instruments?instType=SPOT` returned 200 with 1212 instruments.

## Alpha Vantage (not supported, free key)

Not requested from the container (needs a key). Facts are from the provider docs and pricing pages; verify before building.

- Assets: stocks, ETFs, FX, crypto, indices, commodities.
- Symbol listing: `function=SYMBOL_SEARCH` (search) and `LISTING_STATUS` (CSV of US listings).
- Candles: `function=TIME_SERIES_INTRADAY|DAILY|WEEKLY|MONTHLY`, `FX_DAILY`, `DIGITAL_CURRENCY_DAILY`.
- Timeframes: intraday 1, 5, 15, 30, 60 min, then daily, weekly, monthly.
- History: `outputsize=full` returns the full daily history (20+ years); intraday goes back by month with the `month` parameter. Some intraday and adjusted endpoints are premium only.
- Rate limits: free tier is 25 requests per day (verify). [Docs](https://www.alphavantage.co/documentation/), [premium plans](https://www.alphavantage.co/premium/).
- CORS / proxy: not checked; plan on the proxy. Add `www.alphavantage.co`.
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
- CORS / proxy: not checked; plan on the proxy. Add `api.twelvedata.com`.
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
- CORS / proxy: not checked; plan on the proxy. Add `finnhub.io`.
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
- CORS / proxy: not checked; plan on the proxy. Add `api.tiingo.com`.
- Live: websocket for IEX, FX and crypto (restricted on the free plan, verify).
- Key: free token; `Authorization: Token <key>` header or `token` query parameter.
- ToS: free plan is for personal use only. [Terms](https://www.tiingo.com/about/terms).

## Link check

Provider docs links were requested with `curl -sIL` on 2026-10-23. The ones used above returned 200, except `developers.binance.com` (202, a bot-challenge page that serves content in a browser) and `finnhub.io/docs/api` and `finnhub.io/pricing` (302, redirected; the final page was not followed to a 200 here). Other links (terms pages, rate limit sub-pages) were not individually checked.
