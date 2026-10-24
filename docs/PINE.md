# Pine Script support

Vost runs Pine Script (v5 and v6) with [PineTS](https://www.npmjs.com/package/pinets), a JavaScript Pine runtime. The version is pinned to `0.13.0`.

## License note

PineTS is licensed AGPL-3.0-only. Vost itself is unchanged and remains MIT-licensed.

## How it works

- `client/src/lib/pine/runtime.ts` exports `runPine(source, candles, inputs?)`. It feeds Vost candles (time in seconds) to PineTS as custom data and resolves to a typed result (`types.ts`).
- Indicators return their declaration (title, overlay), inputs with defaults and plots. Each plot has one value per candle, `null` where the script gave na.
- Strategies also return trades (closed and open) and the signed position at the close of each candle.
- Compile and runtime errors resolve to `{ ok: false, error: { message, line?, column? } }`. `runPine` never throws.
- The backtest worker handles a `pine` request asynchronously and replies with `pineResult`. The main thread never executes Pine.
- `inputs` overrides input defaults by input title.

## Fixtures

`client/src/lib/pine/fixtures/*.pine` hold example scripts (EMA cross, MACD, RSI, Bollinger Bands, two strategies, and a syntax error). `runtime.test.ts` checks plot values against `client/src/lib/indicators.ts`.
