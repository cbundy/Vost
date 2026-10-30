# barstate.isrealtime, isconfirmed and isnew are true on the last bar of a purely historical run

PineTS version: 0.13.0. Probe case: `barstate / barstate-fields` in `../output.txt`. Draft only; the owner files it.

## Script and reproduction

```js
import { PineTS } from 'pinets';
// raw PineTS, array data
const data = Array.from({ length: 120 }, (_, i) => ({
  openTime: (1699920000 + i * 86400) * 1000, closeTime: (1699920000 + (i + 1) * 86400) * 1000 - 1,
  open: 100 + i * 0.3, high: 102 + i * 0.3, low: 98 + i * 0.3, close: 101 + i * 0.3, volume: 1000,
}));
const ctx = await new PineTS(data, 'TEST', 'D').run(`//@version=6
indicator("b")
plot(barstate.isrealtime ? 1 : 0, "rt")
plot(barstate.ishistory ? 1 : 0, "hist")
plot(barstate.isnew ? 1 : 0, "new")`);
console.log(ctx.plots.rt.data.at(-1).value, ctx.plots.hist.data.at(-1).value);
```

## Expected (TradingView)

All bars of data that is entirely in the past are history: `isrealtime = 0`, `ishistory = 1` on the last bar too (TradingView sets `isrealtime` only for bars that arrive after load).

## Actual (PineTS 0.13.0, from `output.txt`)

`first=0, last=1, conf=1, rt=1, hist=0, new=1` on the last bar: it is treated as realtime.
