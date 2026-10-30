# syminfo.* is empty or na with array data, so math.round_to_mintick returns NaN

PineTS version: 0.13.0. Probe case: `syminfo / syminfo-numbers, syminfo-strings; math / fn math.round_to_mintick(close)` in `../output.txt`. Draft only; the owner files it.

## Script and reproduction

```js
import { PineTS } from 'pinets';
// raw PineTS, array data
const data = Array.from({ length: 120 }, (_, i) => ({
  openTime: (1699920000 + i * 86400) * 1000, closeTime: (1699920000 + (i + 1) * 86400) * 1000 - 1,
  open: 100 + i * 0.3, high: 102 + i * 0.3, low: 98 + i * 0.3, close: 101 + i * 0.3, volume: 1000,
}));
const ctx = await new PineTS(data, 'TEST', 'D').run(`//@version=6
indicator("s")
plot(syminfo.mintick, "mintick")
plot(syminfo.pointvalue, "pv")
plot(str.length(syminfo.timezone), "len timezone")
plot(math.round_to_mintick(close), "rounded")`);
console.log(ctx.plots.mintick.data.at(-1).value, ctx.plots.rounded.data.at(-1).value);
```

## Expected (TradingView)

A way to give symbol info with the data (mintick, pointvalue, timezone, currency, type, session), and `math.round_to_mintick(close)` returning the price rounded to the tick.

## Actual (PineTS 0.13.0, from `output.txt`)

`mintick=na, pv=na, mincontract=na`; all string fields have length 0; `math.round_to_mintick(close)` is `NaN`.
