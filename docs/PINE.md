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

## Editing

Pine indicators are edited in the bottom dock's Pine tab. The sidebar's Edit button on a Pine indicator opens it.

## Old scripts (v1 to v4)

PineTS reads a script with no `//@version` line as raw JavaScript, so old Pine used to fail with a confusing parser error. `runPine` now checks the version first (`version.ts`, the same marker PineTS looks for). A script with no version line, or a version below 5, resolves to a plain message instead: "This is a Pine v4 script. Vost runs Pine v5 and v6: use Convert to v6." (a script with no version line is read as v1, and the message also says to add `//@version=6` if it is already v6 code).

The Pine tab and the Backtest tab's Pine editor then show a **Convert to v6** button. It rewrites the source in the editor as one edit, so Ctrl+Z restores the original, and says "Converted from Pine v<N> to v6." until the next edit.

`convertToV6` (`convert.ts`) is pure, best-effort and runs only on that click. It works on a tokenizer, so it never changes strings, comments, a member after `.`, or a name the script assigns itself. It converts:

- the version line, `study` to `indicator`, `security`, `tostring`, `color(c, t)` and `iff(c, a, b)`;
- built-ins to their `ta.` and `math.` names, and `tr`, `vwap`, `obv`, `accdist`, `tickerid`, `period`;
- bare colors (`red`) to `color.red`;
- `input(...)` to the typed `input.int`, `input.float`, `input.bool`, `input.string`, `input.source`, `input.timeframe` and so on, by its default or its `type=`;
- plot `style=` and hline `linestyle=` names;
- `transp=N` into `color.new(<color>, N)`;
- a whole-line strategy call with `when=cond` into `if cond` with the call under it.

Anything else it cannot convert safely stays as written with a `// TODO(convert): ...` line above it (an `input` it cannot type, `when=` inside an expression, `transp` with no color, a variable that reads its own history before it is declared, a removed built-in such as `heikenashi`). The summary line counts these: search for `TODO(convert)`.

## Fixtures

`client/src/lib/pine/fixtures/*.pine` hold example scripts (EMA cross, MACD, RSI, Bollinger Bands, two strategies, and a syntax error, plus `legacy-wavetrend` (an old v1 script) and `wavetrend-v6` (its hand-written v6 reference)). `runtime.test.ts` checks plot values against `client/src/lib/indicators.ts`.

Backtesting a `strategy()` script is described in [STRATEGIES.md](STRATEGIES.md#pine-script-strategies).
