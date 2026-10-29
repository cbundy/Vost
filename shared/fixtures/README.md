# Fixtures

`binance-btcusdt.json`: real Binance BTCUSDT klines (`[time, open, high, low, close, volume]`, time in unix seconds)
fetched from `GET /api/v3/klines` with `endTime` 2026-08-31T23:59:59Z: `hourly` (1h) with the exchange's own `h4` (4h),
and `daily` (1d) with the exchange's own `weekly` (1w) and `monthly` (1M). Used by `shared/timeframes.test.ts` to
check that built bars equal the exchange's native bars.
