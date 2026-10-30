# request.security with array data and no provider silently returns the chart bar

PineTS version: 0.13.0. Probe case: `request / security-higher-tf, security-other-symbol` in `../output.txt`. Draft only; the owner files it.

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
plot(request.security("AAPL", "D", close), "AAPL close")
plot(request.security(syminfo.tickerid, "W", open), "weekly open")
plot(close, "chart close")`);
console.log(ctx.warnings, ctx.plots["AAPL close"].data.at(-1).value, ctx.plots["chart close"].data.at(-1).value);
```

## Expected (TradingView)

With no data source for the symbol or timeframe, an error or a warning that says so (or a documented provider hook that supplies the data). A weekly open differs from the daily open and another symbol differs from the chart.

## Actual (PineTS 0.13.0, from `output.txt`)

`plots[2]: AAPL close=143.83, chart close=143.83` and `weekly open=140.89, daily open=140.89`: the chart's own bar, with no error and no warning, so a script cannot tell the data is wrong.
