# Built timeframes probe

`probe.ts` builds a timeframe from a lower one with the real builder (`server/providers/built.ts`) on live exchange
data and compares it with the exchange's own bars. Run `node docs/spikes/built-timeframes/probe.ts` (exits 0); the
output it printed is in `output.txt`.

Findings:
- Binance 4h from 1h, 1w and 1M from 1d: identical to the native bars (open, high, low, close, volume).
- Yahoo AAPL 1d from 1h: every bar lines up in time (stamped at the 9:30 ET open), the exchange-local session
  calendar works. Prices differ by cents and volume is lower: Yahoo's daily bar carries the opening and closing
  auction prints and full consolidated volume, the hourly bars do not. A built Yahoo bar is therefore close to,
  not equal to, a native one; the only Yahoo timeframe that is built is 4h, which has no native bar to differ from.
- Kraken 1w: Kraken's own weeks start on Thursday, built weeks on Monday, so none line up. Kraken 1w is native and
  is never built; only 1M is built for Kraken.
- The probe found that Yahoo's `range` for hourly bars was sized in days and never capped (the interval code is
  `60m`, the tables were keyed `1h`), so any hourly request above about 730 bars failed with HTTP 422. Fixed in
  `server/providers/yahoo.ts`; a built 4h chart needs several hundred hourly bars.
