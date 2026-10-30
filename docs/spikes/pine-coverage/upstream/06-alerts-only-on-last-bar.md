# alert() and alertcondition() are recorded only on the last bar by default

PineTS version: 0.13.0. Probe case: `alert / alertcondition, alert-fn` in `../output.txt`. Draft only; the owner files it.

## Script and reproduction

```js
import { PineTS } from 'pinets';
// raw PineTS, array data (may be filed as a docs or default question)
const data = Array.from({ length: 120 }, (_, i) => ({
  openTime: (1699920000 + i * 86400) * 1000, closeTime: (1699920000 + (i + 1) * 86400) * 1000 - 1,
  open: 100 + i * 0.3, high: 102 + i * 0.3, low: 98 + i * 0.3, close: 101 + i * 0.3, volume: 1000,
}));
const ctx = await new PineTS(data, 'TEST', 'D').run(`//@version=6
indicator("a")
alertcondition(close > 0, "always", "msg")
if close > 0
    alert("crossed", alert.freq_once_per_bar)
plot(close)`);
console.log(ctx.alerts);
```

## Expected (TradingView)

On every bar where the condition holds, an alert fires (once per bar for `freq_once_per_bar`), as in a TradingView historical replay of alerts.

## Actual (PineTS 0.13.0, from `output.txt`)

`alerts: 1 (alertcondition, bar 119)` and `alerts: 1 (alert, bar 119)`: only the last bar. Vost works around it with `setAlertMode('all')`. Question for upstream: is the last-bar default intended, and can the docs say so?
