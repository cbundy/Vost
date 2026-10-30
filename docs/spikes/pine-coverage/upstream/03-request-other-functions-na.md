# request.financial, economic, seed, dividends, splits and earnings return na with only a warning

PineTS version: 0.13.0. Probe case: `request / request-financial, request-economic, request-seed, request-dividends-splits-earnings` in `../output.txt`. Draft only; the owner files it.

## Script and reproduction

```js
import { PineTS } from 'pinets';
// raw PineTS, array data
const data = Array.from({ length: 120 }, (_, i) => ({
  openTime: (1699920000 + i * 86400) * 1000, closeTime: (1699920000 + (i + 1) * 86400) * 1000 - 1,
  open: 100 + i * 0.3, high: 102 + i * 0.3, low: 98 + i * 0.3, close: 101 + i * 0.3, volume: 1000,
}));
const ctx = await new PineTS(data, 'TEST', 'D').run(`//@version=6
indicator("r")
plot(request.financial("NASDAQ:AAPL", "TOTAL_REVENUE", "FQ"), "fin")
plot(request.economic("US", "GDP"), "gdp")
plot(request.dividends("NASDAQ:AAPL"), "div")`);
console.log(ctx.warnings);
```

## Expected (TradingView)

Real values, or a runtime error / a provider hook when the data is not available. TradingView returns data for these.

## Actual (PineTS 0.13.0, from `output.txt`)

`fin=NaN | warnings: 1`, `gdp=NaN | warnings: 1`, `div=NaN | warnings: 1` (and the same for seed, splits and earnings). The script runs on and only `ctx.warnings` records it. Question for upstream: is a hook for these planned, and should the default be an error?
