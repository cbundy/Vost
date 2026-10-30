# request.security drops the exchange prefix before the provider sees the symbol

PineTS version: 0.13.0. Probe case: none (found while building issue 335, see `client/src/lib/pine/requestRouting.ts`). Draft only; the owner files it.

## Script and reproduction

```js
import { PineTS } from 'pinets';
const log = [];
const provider = {
  async getMarketData(tickerId, timeframe) {
    log.push(['md', tickerId, timeframe]);
    const t = 1699920000000;
    return Array.from({ length: 48 }, (_, i) => ({
      openTime: t + i * 3600000, closeTime: t + (i + 1) * 3600000 - 1,
      open: 1, high: 2, low: 0.5, close: 1 + i, volume: 1,
    }));
  },
  async getSymbolInfo(tickerId) { log.push(['si', tickerId]); return null; },
  configure() {},
};
await new PineTS(provider, 'BTCUSDT', '60').run(`//@version=6
indicator("a")
plot(request.security("BYBIT:BTCUSDT", "", close))
plot(request.security("COINBASE:ETH-USD", "D", close))`);
console.log(JSON.stringify(log));
```

## Expected (TradingView)

A request for `BYBIT:BTCUSDT` reads Bybit's symbol, a different market from `BINANCE:BTCUSDT`. The provider is asked for the full ticker id (`BYBIT:BTCUSDT`) so it can pick the exchange.

## Actual (PineTS 0.13.0)

`[["md","BTCUSDT","60"],["si","BTCUSDT"],["md","ETH-USD","D"],["si","ETH-USD"]]`. The first request never reaches the provider: the same-symbol, same-timeframe shortcut compares the stripped ticker with the chart's and returns the chart's own close. The second reaches the provider as `ETH-USD`, with the prefix gone (`security.ts` keeps `resolvedSymbol.split(':')[1]`; `security_lower_tf.ts` does the same). With `"D"` and `BYBIT:BTCUSDT` a host that serves the chart's own ticker answers with the chart's own market, silently. A host cannot route by exchange without patching the private `_initializeContext`.

Ask: pass the full ticker id (prefix included) to `getMarketData` and `getSymbolInfo`, and make the same-symbol shortcut compare prefixes too (or leave the stripped form to the bundled providers).
