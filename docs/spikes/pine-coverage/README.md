# Pine v6 coverage map

Research only (issue 148): what Pine Script v6 covers, what PineTS 0.13.0 computes, what Vost's `runPine` passes through, and what Vost shows. No product code changed. The owner decides the build work from the follow-ups at the end.

Line references are pinned to commit `92b459d` (the head of `main` when this was written). PineTS facts come from the probe; the PineTS docs are cited only as the upstream claim (`node_modules/pinets/README.md`, "API Coverage" lists the namespaces; its Roadmap marks "Pine Script v6 full compatibility" as not done).

## Method

`probe.ts` runs 160 small v6 scripts (inline, one or more per row below) on 120 fixed synthetic daily candles, no network. Each runs twice: through raw `new PineTS(data, 'VOST', 'D').run(src)`, and through Vost's `runPine`. Per case it prints compile ok or error, what PineTS returned (plot keys with last value, live `__*__` drawing objects, alerts, warnings, console lines, strategy trades and closed profit) and what `runPine` returned (plots as `name:kind/style/pane=last value`, plots that are all null, inputs, trades). Its output is `output.txt`, whose first line names the PineTS version. Two runs on the same code and engine give identical output, and the output is refreshed on every PineTS upgrade: `scripts/pine-coverage.test.ts` fails when the version in the first line differs from the installed `pinets`, so rerun the command below (and read the diff) in the same change as the upgrade.

Rerun (exits 0, a few seconds; `vite-node` is needed because `runtime.ts` uses extensionless imports):

    timeout 180 npx vite-node docs/spikes/pine-coverage/probe.ts > docs/spikes/pine-coverage/output.txt

Case names below are the `## row / case` headings in `output.txt`.

## What the pipeline does with a script

- (Before issue 309.) `runtime.ts:156` ran every script as `new PineTS(toPineData(candles), 'VOST', 'D')`. The ticker and timeframe are fixed, whatever the chart shows. Case `timeframe / runPine on 1h candles`: hourly candles still give `timeframe.in_seconds()` = 86400 and `isdaily` = 1.
- `runtime.ts:56-86` `mapPlots` skips every key starting `__` (`runtime.ts:59`): PineTS's `__lines__`, `__labels__`, `__boxes__`, `__tables__`, `__polylines__`, `__linefills__` never left `mapPlots`. (Since issue 313 `mapDrawings` reads lines, boxes, polylines and linefills from them; labels and tables are still skipped.) It reads nothing else from the context: `ctx.alerts`, `ctx.warnings` and logs are never read (`runtime.ts:156-190`).
- Every other plot goes through `plotKind` (`runtime.ts:49-54`), which knows `hline`, `background`, `shape` and `char`. Anything else is kind `plot` with the PineTS style name kept in `style`. Values go through `toNum` (`runtime.ts:21-23`), so a boolean or an OHLC array becomes null, and `fill` (PineTS emits a plot with no values) is all null.
- `chartSeries.ts:84` `buildPineChart` draws four kinds (`hline` dashed line, `bgcolor` band, `plotshape` markers, everything else a line or histogram series, `chartSeries.ts:123`). Only `histogram` and `columns` are histograms, only `circles` and `cross` are points; `area`, `stepline`, `linebr` and the rest draw as a plain line; line width is fixed at 2 (`chartSeries.ts:123-131`). A plot with no values draws nothing.
- Inputs reach the UI as `{name, type, defval, min, max, step, options}` (`runtime.ts:162-170`); `PinePane.tsx:139-168` renders a select for options, a checkbox for `bool`, a number box for `int` and `float`, and a text box for every other type.
- Strategies: `runtime.ts:172-188` reads `closedtrades`, `opentrades` and five declaration fields (capital, commission type and value, default qty type and value). The backtest turns them into Vost trades (`client/src/lib/backtest/pine.ts`).

## Coverage table

Columns: **PineTS** computes it (yes / partial / no); **runPine** passes it through (yes / partial / dropped); **Vost shows** it (yes / partial / no). "n/a" where the column has no meaning. Evidence is the case in `output.txt`.

### Language and library namespaces

| Area | PineTS | runPine | Vost shows | Note and evidence |
|---|---|---|---|---|
| Language: types, UDTs, methods, enums, tuples, switch/for/while, `var`, `varip` | yes | yes | yes (through plots) | Cases `language / udt, method, enum, function-switch-for, var-persist, varip, tuple-return, while-break` all compile and give the expected value. `varip` behaves as `var` (history only, no ticks) |
| Language: imports / libraries | yes (with a resolver) | yes | yes (through plots) | `language / import-library` runs an inline library through a resolver and plots its value. `runPine` sets a resolver that asks the Vost server (`/api/pine/libraries`), which fetches open-source TradingView libraries and keeps pasted ones; see `docs/PINE.md` (Libraries). The probe passes `opts.resolver`, so it needs no network |
| `ta.*` (48 functions probed) | yes | yes | yes | Cases `ta / fn ...`, `sma-ema-rma-wma`, `rsi-macd-bb`, `atr-stoch-adx`, `supertrend-sar`, `kc-keltner`, `correlation-linreg`, `vwap-obv-cci-mfi`: every one compiles and returns a value. `client/src/lib/pine/runtime.test.ts` already checks sma, ema, rsi, macd, bb against `client/src/lib/indicators.ts`. Values of the rest are not cross-checked against TradingView |
| `math.*` | yes | yes | yes | Cases `math / fn ...` (20) all ok. Exception: `math.round_to_mintick` returns NaN because `syminfo.mintick` is na (below) **Changed after the pinned commit (issue 309):** `runPine` now gives the chart's `syminfo.mintick` (estimated from the candles), so `math.round_to_mintick` is finite. |
| `str.*` | yes | yes | yes | `str / str-basic, str-split-replace` ok |
| `array.*` | yes | yes | yes | `array / array-basic, array-sort-slice` ok |
| `matrix.*` | yes | yes | yes | `matrix / matrix-basic, matrix-det` give the right numbers (7, 2) |
| `map.*` | yes | yes | yes | `map / map-basic` ok |
| `color.*` | yes | yes | yes | `color / color-basic, color-rgb-components` ok. Colors flow to the plot's `color` and per-bar `colors` (`runtime.ts:67-71`) |
| `input.*` | yes (all types compile) | partial | partial | `input / ...`: int, float, bool, string, source, color, timeframe, symbol, time, session are all listed with their type. The pane only has real controls for bool, int, float and options; the rest are text boxes (`PinePane.tsx:168`), so there is no color picker, source dropdown or time picker. `group`, `tooltip`, `inline` are accepted and not passed on |
| `syminfo.*` | partial | yes (as computed) | n/a | `syminfo / syminfo-numbers, syminfo-strings`: `mintick`, `pointvalue`, `mincontract` are na; `tickerid`, `ticker`, `timezone`, `currency`, `type`, `session`, `description` are empty strings (even `syminfo.ticker == "VOST"` is false). Cause: PineTS is given an in-memory array, so no symbol info exists; `runtime.ts:156` passes only a placeholder name **Changed after the pinned commit (issue 309):** `runPine` takes a market: `ticker`, `prefix`, `tickerid`, `type`, `timezone` (always `UTC`, a limit for stocks), `mintick` (estimated from the prices, a limit), `pricescale` and `minmove` are set from the chart. |
| `timeframe.*` | partial | yes (as computed) | n/a | `timeframe / timeframe-fields` computes for `D`; `timeframe / runPine on 1h candles` shows it stays `D` on any chart (`runtime.ts:156`). `timeframe.period`, `multiplier`, `in_seconds`, `isdaily`, `isintraday`, `change` therefore describe the wrong timeframe on every non-daily chart **Changed after the pinned commit (issue 309):** `runPine` takes the chart's interval, so these describe the chart (`2h` gives 7200 s). |
| `barstate.*` | partial | yes (as computed) | n/a | `barstate / barstate-fields`: on the last historical bar `isrealtime`, `isconfirmed` and `isnew` are all 1 and `ishistory` is 0, so a script that distinguishes history from realtime sees the final loaded bar as realtime. There is no live bar feed into Pine |
| `session.*` and time functions | partial | yes (as computed) | n/a | `session-time / time-vars, session-vars, last-bar-time, time-functions` ok; `time-session-0000-2359` ok. `time-session-0000-2400` fails: PineTS rejects `"0000-2400"` ("Invalid session specification"), which TradingView accepts. With `syminfo.timezone` empty, exchange-time session checks are unreliable (`time-session-timezone` returns 0 for a New York session) |
| `request.security` same timeframe and symbol | yes | yes | yes | `request / security-same-tf` equals the chart's own value **Changed after the pinned commit (issue 309):** Still equal; the data now comes through a provider built from the chart's candles. |
| `request.security` other timeframe or symbol | no (silently wrong) | yes (wrong values) | yes (wrong values) | `security-higher-tf`: the weekly open equals the daily open. `security-other-symbol`: `AAPL` close equals the chart's close. PineTS has no data source for another symbol or timeframe, and Vost supplies none, so the value is the chart's own bar. No error or warning is raised. Most dangerous gap: scripts look right and are wrong **Changed after the pinned commit (issue 309):** Now a run error, `request.security(<symbol>, <timeframe>) needs data Vost does not load yet`; real data is a follow-up. **Changed after the pinned commit (issue 312):** The chart's own symbol at another timeframe (`"D"`, `"720"`, `"15"`) returns real bars from the chart's provider, aligned by close time and clipped to the run's end; another symbol still fails with the message above (issue 315). |
| `request.security_lower_tf` | no | yes | yes | `security-lower-tf`: returns a one-element array (the chart bar) |
| `request.financial`, `economic`, `seed`, `dividends`, `splits`, `earnings` | no | dropped | no | Cases `request / request-financial, -economic, -seed, -dividends-splits-earnings`: na on every bar plus a PineTS warning (`warnings: N`), which `runPine` never reads, so the user sees an empty plot with no reason |

### Outputs

| Area | PineTS | runPine | Vost shows | Note and evidence |
|---|---|---|---|---|
| `plot` (line) | yes | yes | yes | `plot / plot-styles`: `line` |
| `plot` styles: histogram, columns, circles, cross | yes | yes | yes | histogram and columns draw as histogram, circles and cross as points (`chartSeries.ts:123-129`) |
| `plot` styles: stepline, area, linebr | yes | yes (`style` kept) | partial | Drawn as a plain line (`chartSeries.ts:123-131`); no step, no area fill |
| `plot` `linewidth`, `offset`, `trackprice`, `join`, per-bar color | yes | partial | partial | Per-bar color is kept (`colors`); `linewidth` is replaced by a fixed 2 (`chartSeries.ts:128`); `offset` and `trackprice` are not read (`plot / plot-color-linewidth-offset`) |
| `hline` | yes | yes | yes | `hline / hline-basic`: kind `hline`, dashed line (`chartSeries.ts:92`). Line style names are not read |
| `fill` | yes (emits a `fill` plot with `plot1`, `plot2`, no values) | dropped | no | `fill / fill-plots, fill-hlines`: `runPine` returns a `Fill` plot, all null (`runtime.ts:49-54`, `toNum`), the colour and the two linked plots are not read |
| `bgcolor` | yes | yes | yes | `bgcolor / bgcolor-basic`: kind `bgcolor`, band (`chartSeries.ts:101`) |
| `barcolor` | yes | yes | yes | Drawn: the main candles take the colour (`barColors`, last visible script wins) |
| `plotshape` | yes | partial | partial | `plotshape / plotshape-basic`: marker drawn. Shape is mapped to four marker shapes (`chartSeries.ts:69-75`), `text` is not passed on, `size` is fixed |
| `plotchar` | yes | partial | partial | `plotchar / plotchar-basic`: drawn as the circle shape, the character is dropped |
| `plotarrow` | yes | yes | yes | Drawn: up arrow below the bar for a positive value, down arrow above for a negative one, sized by the value |
| `plotcandle` | yes | yes | yes | Drawn: a candlestick series with per-bar body, wick and border colours |
| `plotbar` | yes | yes | yes | Drawn: a bar series with per-bar colours |
| `line` | yes | yes | yes | Drawn read-only (issue 313): `drawingObjects.ts` reads `__lines__` into `PineResult.drawings`, `pineDrawingsPrimitive.ts` paints it with colour, width, style, arrows and extend |
| `label` | yes | dropped | no | `label / label-basic`: `__labels__`, skipped (`runtime.ts:59`) |
| `box` | yes | yes | yes | Drawn read-only (issue 313): border, background, extend and text with alignment and wrap |
| `table` | yes | dropped | no | `table / table-basic`: `__tables__`, skipped |
| `polyline` | yes | yes | yes | Drawn read-only (issue 313): straight or curved, open or closed, with fill |
| `linefill` | yes | yes | yes | Drawn read-only (issue 313): the area between the two lines' drawn spans; dropped when either line is gone |
| `chart.*` | partial | yes (as computed) | n/a | `chart / chart-vars`: `chart.is_standard`, `chart.left_visible_bar_time` compute; `chart.point` works (polyline case). Values describe PineTS's context, not the Vost chart |
| `alert`, `alertcondition` | yes | yes | yes | `alert / alertcondition, alert-fn`: PineTS records them in `ctx.alerts`, but by default only for the last bar (`bar 119` of 120); `runPine` calls `setAlertMode('all')` so every bar's are kept, and the Pine pane lists them (a condition never true is absent). Not sent to Vost's own alerts (price and indicator alerts) |
| `log.info`, `warning`, `error` | yes | yes | yes | `log / log-info-warning-error`: PineTS prints to the console only (360 lines for 120 bars); `messages.ts` wraps the Log methods during a run and the Pine pane lists the lines by level |
| `runtime.error` | yes | yes | yes | `runtime / runtime-error`: surfaces as `{ ok: false, error: { message: "boom" } }`, shown in the Pine pane |
| `indicator()`: `overlay` | yes | yes | yes | `declaration / indicator-overlay-false`: `pane: separate` |
| `indicator()`: `max_bars_back` | yes | yes (ignored) | n/a | `runtime / max-bars-back` runs; the value is not read |
| `indicator()`: `format`, `precision`, `scale`, `timeframe`, `shorttitle`, `explicit_plot_zorder`, `max_lines_count` | accepted | dropped | no | `declaration / indicator-args, indicator-timeframe-arg` compile and run. `runtime.ts:152-153` reads only title and overlay. `timeframe="W"` has no effect (and `request.security` cannot do it anyway, see above) |

### Strategy

| Area | PineTS | runPine | Vost shows | Note and evidence |
|---|---|---|---|---|
| `strategy.entry` long and short, `strategy.close`, `close_all` | yes | yes | yes | `strategy / strategy-entry-close, strategy-short, strategy-order-close-all`: trades and profit equal between PineTS and `runPine` |
| `strategy.order` | yes | yes | yes | `strategy-order-close-all` |
| `strategy.exit` (stop, limit) | yes | yes | yes | `strategy-exit-stop-limit`: 2 closed, 1 open, matches. Trailing and `from_entry` forms are not probed |
| Limit and stop entries, `strategy.cancel` | yes | yes | yes | `strategy-limit-stop-entry`, `strategy-cancel` run |
| `strategy.risk.allow_entry_in` | yes | yes | yes | `strategy-risk / allow_entry_in`: short entries are refused (30 trades against 60); PineTS and `runPine` give the same trades, so a Vost backtest honours it |
| `strategy.risk.max_drawdown` | yes | yes | yes | `strategy-risk / max_drawdown`: no entries after bar 31 (16 trades against 60); PineTS and `runPine` give the same trades, so a Vost backtest honours it |
| `strategy.risk.max_intraday_loss` | yes | yes | yes | `strategy-risk / max_intraday_loss`: no entries after bar 97 (5 trades against 60); PineTS and `runPine` give the same trades, so a Vost backtest honours it |
| `strategy.risk.max_cons_loss_days` | yes | yes | yes | `strategy-risk / max_cons_loss_days`: no entries after bar 8 (5 trades against 60); PineTS and `runPine` give the same trades, so a Vost backtest honours it |
| `strategy.risk.max_intraday_filled_orders` | yes | yes | yes | `strategy-risk / max_intraday_filled_orders`: at most 4 fills a day (10 trades against 60); PineTS and `runPine` give the same trades, so a Vost backtest honours it |
| `strategy.risk.max_position_size` | yes | yes | yes | `strategy-risk / max_position_size`: entries of 8 are capped at 3 (closed profit 55.89 against 149.04); PineTS and `runPine` give the same trades, so a Vost backtest honours it |
| Risk close-out in the Vost trade list | yes | yes | partial | A trade closed by a risk rule appears as a normal closed trade with exit reason "signal" (`backtest/pine.ts:110` labels every closed trade so), so it is not told apart from a `strategy.close` |
| Commission and slippage | yes | partial | partial | `strategy-commission-slippage`: closed profit 44.91 against 45.46 without; the same in `runPine`, so PineTS applies it. `commissionType/Value` are surfaced in `strategyConfig`, `slippage` is not |
| `pyramiding` | yes | yes | yes | `strategy-pyramiding`: 15 trades, matches PineTS |
| `default_qty_type`, `default_qty_value` | yes | yes | yes | `strategy-qty-percent-equity` (default capital 1,000,000 in v6, so the profit is large) |
| `margin_long/short`, `process_orders_on_close`, `calc_on_every_tick`, `close_entries_rule` | accepted | yes (ignored by Vost) | n/a | `strategy-margin-fill-orders` runs and gives a different profit (38.17), computed by PineTS |
| `strategy.*` built-in variables (`position_size`, `equity`, `netprofit`, `opentrades`, `closedtrades`, `wintrades`, `position_avg_price`, `initial_capital`, `max_drawdown`, `closedtrades.profit(i)`) | yes | yes | yes | `strategy-vars / strategy-builtin-vars, strategy-trade-accessors`: all available, equal in both columns. Strategy plots draw in a separate pane |
| `strategy()` declaration: `initial_capital`, `commission_*`, `default_qty_*` | yes | yes | yes | read in `mapStrategyConfig` (`runtime.ts:117-125`) |

## Known engine gaps (PineTS 0.13.0)

Each gap that still reproduces on raw PineTS has a report draft in `upstream/`. None is filed: filing is the owner's step.

1. `time(timeframe.period, "0000-2400")` throws "Invalid session specification". TradingView accepts `0000-2400`. Case `session-time / time-session-0000-2400`. Draft: [upstream/01-session-0000-2400.md](upstream/01-session-0000-2400.md).
2. `request.security` to another symbol or timeframe returns the chart's own bar and raises neither an error nor a warning. Cases `request / security-higher-tf, security-other-symbol`. Expected: an error, or a pluggable data source. **Changed after the pinned commit (issues 309 and 312):** other symbols fail with a message; the chart's own symbol at another timeframe has real data. Draft: [upstream/02-request-security-silent-chart-bar.md](upstream/02-request-security-silent-chart-bar.md).
3. `request.financial`, `economic`, `seed`, `dividends`, `splits`, `earnings` return na (warning only in `ctx.warnings`). Cases `request / request-*`. Draft: [upstream/03-request-other-functions-na.md](upstream/03-request-other-functions-na.md).
4. `syminfo.*` is empty or na with array data, and `math.round_to_mintick` is NaN as a result. Cases `syminfo / ...`, `math / fn math.round_to_mintick(close)`. Expected: a way to give symbol info with the data. Draft: [upstream/04-syminfo-empty-round-to-mintick.md](upstream/04-syminfo-empty-round-to-mintick.md).
5. `barstate.isrealtime`, `isconfirmed` and `isnew` are true on the last bar of a purely historical run. Case `barstate / barstate-fields`. Draft: [upstream/05-barstate-realtime-on-last-historical-bar.md](upstream/05-barstate-realtime-on-last-historical-bar.md).
6. `alert` and `alertcondition` record only on the last bar (`bar 119`) by default (fixed in Vost by `setAlertMode('all')`). Cases `alert / ...`. Draft: [upstream/06-alerts-only-on-last-bar.md](upstream/06-alerts-only-on-last-bar.md).
7. `varip` behaves like `var` (no intrabar state). Case `language / varip`. Expected, since there are no ticks, so no report draft.

No `ta.*`, `math.*`, array, matrix, map, str or strategy function in the probe failed to compile.

## Proposed follow-ups

The owner picks which to build; this decides nothing. Ordered by value, then risk. Sizes are rough.

1. **Pass the real symbol, timeframe and tick size to PineTS.** Replace `'VOST', 'D'` (`runtime.ts:156`) with the chart's symbol and timeframe, and supply what `syminfo.*` needs. Closes `timeframe`, `syminfo`, `session/time` partly. Small to medium; low risk; needs the symbol context passed through `runPine`'s caller and the backtest worker.
2. **Make `request.security` honest.** Either feed real higher-timeframe and other-symbol candles through PineTS's data source, or fail with a clear message instead of returning the chart's data. Closes the `request.*` rows. Large to build, small for the error-only version; medium risk (data fetch in the worker). **Changed after the pinned commit (issues 309 and 312):** the error is in and other timeframes of the chart's symbol are fed; other symbols are issue 315.
3. **Draw `fill`, `plotcandle`, `plotbar`, `barcolor`, `plotarrow`.** Extend `PinePlot` and `mapPlots` (carry OHLC arrays, fill links and bar colours), then `buildPineChart`. Closes five output rows, the most common gap in public scripts. Medium; medium risk (new series types in the chart hook).
4. **Draw `line`, `label`, `box`, `table`, `polyline`, `linefill` (done for `line`, `box`, `polyline` and `linefill`: read-only, issue 313; `label` and `table` remain).** Read the `__*__` collections instead of skipping them, then render on the chart (tables as an overlay). Closes six rows, four of them now. Large; medium risk (new chart primitives; bar-index to time mapping).
5. **Surface alerts, logs and warnings (done: shown in the Pine pane, not routed to Vost's alerts).** Read `ctx.alerts`, `ctx.warnings` and the log output, show them in the Pine pane. Optionally route `alertcondition` into Vost's alerts. Closes `alert`, `log`, the "empty plot, no reason" part of `request.*`. Small to medium; low risk.
6. **Richer input controls and plot options.** Color picker, source select, time/symbol/session controls, `group`/`tooltip`/`inline`, plot `linewidth`, `offset`, step/area styles, `plotshape` text and size. Closes the `input.*` and partial plot rows. Medium; low risk.
7. **Import resolver for libraries.** Done: `runPine` sets a resolver backed by the Vost server (open-source libraries fetched from TradingView and kept, closed-source ones pasted). Closed the imports row.
8. **Report the engine gaps upstream** (the list above) and re-probe on each PineTS upgrade. Done: drafts are in `upstream/` and the version test enforces the re-probe. Left for the owner: filing the drafts.
9. **Verify the strategy risk rules** with a probe that trips a limit. Done: all six rules are honoured (see the `strategy.risk.*` rows); no engine bug found, no Vost change needed.
