# Pine Script

Vost runs Pine Script v5 and v6 with the PineTS runtime. Pine indicators draw on the chart, and `strategy()` scripts also backtest. What is and is not supported is in [Pine support](../PINE.md).

## The Pine pane

Press **Pine Editor** in the top bar (or **Edit** on a Pine indicator in the Indicators section) to open the Pine pane beside the chart. It has a code editor with highlighting, autocomplete and error markers, an indicator selector, the run status and errors, and the script's inputs. Drag its handle to resize; the close button hides it. On windows 900px wide and below it is a dialog that closes with Escape. A status line shows the cursor position and Pine version.

![The Pine pane](../evidence/pine-pane/pine-pane-editor-desktop.png)

### Messages

After a successful run, a Messages section below the inputs lists what the script said on the loaded bars: the `alert()` calls that fired, the `alertcondition()`s that came true (with how many bars and the last one), and the `log.info`, `log.warning` and `log.error` lines, with times in the chart's time zone. Each list shows the newest 500 and says how many more are not shown. Pine alerts are only listed here; they are not sent to Vost's alerts, and a condition that was never true on the loaded bars is not listed. `runtime.error()` stops the run and shows its message as an error.

![Messages in the Pine pane](../evidence/pine-pane/pine-pane-messages-desktop.png)

Pine strategies run from the Backtest tab and the Optimizer too ([Backtesting](backtesting.md)).

## What a script sees of the chart

A script runs with the chart's symbol, timeframe and market details, the same on the chart, in the backtester and in the optimizer. `syminfo.ticker` is the symbol, `syminfo.tickerid` reads like `BINANCE:BTCUSDT`, `syminfo.type` is `crypto` (or `stock` for Yahoo), and `timeframe.period`, `timeframe.in_seconds()` and `timeframe.isintraday` match the chart, also on a custom timeframe such as `2h`. `math.round_to_mintick` works. A chart that shows an imported dataset uses the dataset's name, source and bar length instead.

A script that asks for another timeframe or symbol with `request.security` stops with a message such as `request.security(ETHUSDT, D) needs data Vost does not load yet`, rather than showing the chart's own numbers as if they were the other market's. Asking for the chart's own symbol and timeframe works.

Two limits: the time zone is always UTC (right for crypto, not for Yahoo stocks), and the tick size is estimated from the prices on the chart, not taken from the exchange.

## Shapes in a script's own pane

A script that draws in its own pane (`overlay=false`) shows its `plotshape` and `plotchar` marks in that pane, not on the candles: `abovebar` and `top` at the top of the pane, `belowbar` and `bottom` at the bottom. Overlay scripts keep their marks on the candles.

![Shapes in the script's own pane, none on the candles](../evidence/pine-render/pine-render-pane-desktop.png)

## Fills

`fill()` shades the area between two plots, or between two `hline`s, in the pane of those lines: the RSI 30/70 band, or a moving-average cloud that changes colour with `color = a > b ? color.green : color.red`. The area takes the fill's own colour, transparency included, sits beneath the lines and leaves a gap where either side has no value. The gradient form of `fill` is not shown yet.

![A shaded cloud between two moving averages that turns green or red](../evidence/pine-render/pine-render-fill-cloud-desktop.png)

## Custom candles, bar colors and arrows

`plotcandle` and `plotbar` draw their own candles and bars, with the colors the script gives them (body, wick and border). A script with `overlay=false` shows them in its own pane, an overlay script on the chart. `plotarrow` draws an up arrow below the bar for a positive value and a down arrow above it for a negative one, larger for a larger value.

![Custom candles and arrows in the script's own pane](../evidence/pine-render/pine-render-candles-desktop.png)

`barcolor` recolors the chart's own candles (body, wick and border). When several scripts color the same bar the last one in the list wins. Hide or remove the script and the normal candles come back.

![Chart candles recolored by barcolor, with bars and arrows on the price pane](../evidence/pine-render/pine-render-bar-colors-desktop.png)

![The same chart with the script hidden: the normal candles are back](../evidence/pine-render/pine-render-bar-colors-off-desktop.png)

## Converting old scripts

A script with no `//@version` line, or a version below 5, will not run. The pane says so and shows **Convert to v6**. It rewrites the source in one edit (Ctrl+Z restores the original) and reports "Converted from Pine v<N> to v6". Whatever it cannot convert safely stays with a `// TODO(convert)` comment above it; search for that.

![Converting a legacy script](../evidence/pine-convert/pine-convert-legacy-desktop.png)

## Libraries

A script can `import user/name/version as x` a TradingView library. The server looks the library up (open-source ones only), keeps a copy and serves it to every tab. If it cannot be fetched, the run fails with a message naming it and a **Paste library** button. **Libraries** in the pane head lets you paste a library's source once (give the path as `user/name/version`) and remove stored ones.

![The Pine libraries dialog](../evidence/pine-libraries/pine-libraries-dialog-desktop.png)

## Compare

The page at `/compare` (also the **Compare** link in the Pine editor head) puts 2 to 4 scripts side by side, Code A to Code D. Paste or type into a pane, **Load** a Pine indicator from the chart, **Open file** (`.pine` or `.txt`) or **Clear** it. **Compare against** picks the reference pane; the others show only what differs: unchanged code folds into an "N unchanged lines" bar (click it to open that run), a small change inside a line is shown in the line (the removed text struck through in red next to the added text in green), and an added or changed line is green and a removed line red. A pane with no text reads **Empty** and shows no marks. It loads no market data and runs no Pine code.

![Four scripts compared](../evidence/compare/compare-four-desktop.png)
