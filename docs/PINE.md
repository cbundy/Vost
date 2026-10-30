# Pine Script support

Vost runs Pine Script (v5 and v6) with [PineTS](https://www.npmjs.com/package/pinets), a JavaScript Pine runtime. The version is pinned to `0.13.0`.

## License note

PineTS is licensed AGPL-3.0-only. Vost itself is unchanged and remains MIT-licensed.

## How it works

- `client/src/lib/pine/runtime.ts` exports `runPine(source, candles, inputs?)`. It feeds Vost candles (time in seconds) to PineTS as custom data and resolves to a typed result (`types.ts`).
- Indicators return their declaration (title, overlay), inputs with defaults and plots. Each plot has one value per candle, `null` where the script gave na.
- Strategies also return trades (closed and open) and the signed position at the close of each candle.
- Compile and runtime errors resolve to `{ ok: false, error: { message, line?, column?, library? } }`. `runPine` never throws.
- The backtest worker handles a `pine` request asynchronously and replies with `pineResult`. The main thread never executes Pine.
- `inputs` overrides input defaults by input title.
- `runPine(source, candles, inputs, opts?)` takes an optional `opts.resolver` that finds the source of an imported library. The default asks the Vost server (see Libraries below); with no page to ask (Node), it resolves nothing and says there is no Vost server.

## Coverage

Vost runs the Pine v6 language and its `ta`, `math`, `str`, `array`, `matrix`, `map` and `color` libraries, strategies (orders, exits, commission, pyramiding) and the basic plots: `plot`, `hline`, `bgcolor`, `plotshape`. It does not yet show `fill`, `barcolor`, `plotcandle`, `plotbar`, `plotarrow` or the drawing objects (`line`, `label`, `box`, `table`, `polyline`, `linefill`), alerts or logs, and `request.security` to another timeframe or symbol returns the chart's own data. The script always sees ticker `VOST` and timeframe `D`.

The full table, with a rerunnable probe, is in [spikes/pine-coverage/README.md](spikes/pine-coverage/README.md).

## Libraries

A script can `import user/name/version as x` a TradingView library. Where the code comes from:

- The Vost server looks the library up on TradingView (its search at `www.tradingview.com` and its script service at `pine-facade.tradingview.com`), saves a copy in `pine-libraries.json` in `VOST_DATA_DIR`, and serves it to the browser at `/api/pine/libraries/<user>/<name>/<version>`. A published library version never changes, so a saved copy is kept for good and the script keeps running when TradingView cannot be reached. The browser never contacts TradingView.
- Only open-source libraries can be fetched. These are TradingView's own web endpoints, not an official API, so they may change or stop working.
- A library the server cannot fetch (closed source, not found, TradingView unreachable) makes the run fail with a message that names it, for example `Library "alice/MyLib/1" could not be loaded: TradingView has no open-source copy of it. Paste its source under Pine libraries.` The Pine pane then shows a Paste library button.
- To paste one, open Libraries in the Pine pane head (or press Paste library under the error), give the path as `user/name/version` and paste the library source, which needs a `//@version=5` or `6` line and a `library(` declaration. Saving it keeps it on the server for every tab and every script, replaces a fetched copy of the same path, and re-runs every Pine indicator. Remove drops a stored library (an open-source one is fetched again the next time a script needs it).

## Editing

Pine indicators are edited in the Pine editor pane to the right of the chart, with its own resize handle and close button. The Pine Editor button in the top bar opens it, and so does the Edit button on a Pine indicator in the side panel's Indicators section. On a narrow window (900px and below) the pane is a dialog that covers the chart area and closes with Escape. A status line shows the cursor position and the Pine version.

## Compare

The page at `/compare` (also linked as Compare in the Pine editor's head) puts 2, 3 or 4 Pine scripts side by side: Code A to Code D. Paste or type into any pane, load a Pine indicator saved on the chart with Load, open a `.pine` or `.txt` file with Open file, or Clear a pane. Compare against picks the reference pane (Code A by default). Every other pane shows only what differs from the reference: runs of unchanged lines (at least 4, with 3 lines of context kept around each change) fold into an "N unchanged lines" bar that opens with a click, and stays open while you type; a small change inside a line (same line count on both sides, under 10 lines) shows the removed text struck through in red next to the added text in green; other green lines were added or changed, and red lines shown above were removed. Its header counts the differences ("3 differences: +2 lines, -2 lines vs Code A"), says "Identical to Code A" or, for a pane with no text, "Empty" (no marks); an identical pane folds into one bar. Folding is redone when a pane's text is replaced (paste, drop, Load, Open file, Clear) or the reference is replaced or switched or the pane count changes. Typing in the reference reaches the other panes after 200 ms without a keystroke; texts are compared exactly as written, so a trailing newline or a space counts. Lowering the pane count hides the last panes but keeps their text. Everything is saved in the browser and restored on reload. The page loads no market data and runs no Pine code.

## Old scripts (v1 to v4)

PineTS reads a script with no `//@version` line as raw JavaScript, so old Pine used to fail with a confusing parser error. `runPine` now checks the version first (`version.ts`, the same marker PineTS looks for). A script with no version line, or a version below 5, resolves to a plain message instead: "This is a Pine v4 script. Vost runs Pine v5 and v6: use Convert to v6." (a script with no version line is read as v1, and the message also says to add `//@version=6` if it is already v6 code).

The Pine editor pane and the Backtest tab's Pine editor then show a **Convert to v6** button. It rewrites the source in the editor as one edit, so Ctrl+Z restores the original, and says "Converted from Pine v<N> to v6." until the next edit.

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
