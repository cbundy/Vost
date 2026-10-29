# Pine v6 coverage map

Research only (issue 148): what Pine Script v6 covers, what PineTS 0.13.0 computes, what Vost's `runPine` passes through, and what Vost shows. No product code changed. The owner decides the build work from the follow-ups at the end.

Line references are pinned to commit `92b459d` (the head of `main` when this was written). PineTS facts come from the probe; the PineTS docs are cited only as the upstream claim (`node_modules/pinets/README.md`, "API Coverage" lists the namespaces; its Roadmap marks "Pine Script v6 full compatibility" as not done).

## Method

`probe.ts` runs 161 small v6 scripts (inline, one or more per row below) on 120 fixed synthetic daily candles, no network. Each runs twice: through raw `new PineTS(data, 'VOST', 'D').run(src)`, and through Vost's `runPine`. Per case it prints compile ok or error, what PineTS returned (plot keys with last value, live `__*__` drawing objects, alerts, warnings, console lines, strategy trades and closed profit) and what `runPine` returned (plots as `name:kind/style/pane=last value`, plots that are all null, inputs, trades). Its output is `output.txt`; rerunning gives byte-identical output.

Rerun (exits 0, a few seconds; `vite-node` is needed because `runtime.ts` uses extensionless imports):

    timeout 180 npx vite-node docs/spikes/pine-coverage/probe.ts > docs/spikes/pine-coverage/output.txt

Case names below are the `## row / case` headings in `output.txt`.

## What the pipeline does with a script

- `runtime.ts:156` runs every script as `new PineTS(toPineData(candles), 'VOST', 'D')`. The ticker and timeframe are fixed, whatever the chart shows. Case `timeframe / runPine on 1h candles`: hourly candles still give `timeframe.in_seconds()` = 86400 and `isdaily` = 1.
- `runtime.ts:56-86` `mapPlots` skips every key starting `__` (`runtime.ts:59`): PineTS's `__lines__`, `__labels__`, `__boxes__`, `__tables__`, `__polylines__`, `__linefills__` never leave the runtime. It reads nothing else from the context: `ctx.alerts`, `ctx.warnings` and logs are never read (`runtime.ts:156-190`).
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
| `math.*` | yes | yes | yes | Cases `math / fn ...` (20) all ok. Exception: `math.round_to_mintick` returns NaN because `syminfo.mintick` is na (below) |
| `str.*` | yes | yes | yes | `str / str-basic, str-split-replace` ok |
| `array.*` | yes | yes | yes | `array / array-basic, array-sort-slice` ok |
| `matrix.*` | yes | yes | yes | `matrix / matrix-basic, matrix-det` give the right numbers (7, 2) |
| `map.*` | yes | yes | yes | `map / map-basic` ok |
| `color.*` | yes | yes | yes | `color / color-basic, color-rgb-components` ok. Colors flow to the plot's `color` and per-bar `colors` (`runtime.ts:67-71`) |
| `input.*` | yes (all types compile) | partial | partial | `input / ...`: int, float, bool, string, source, color, timeframe, symbol, time, session are all listed with their type. The pane only has real controls for bool, int, float and options; the rest are text boxes (`PinePane.tsx:168`), so there is no color picker, source dropdown or time picker. `group`, `tooltip`, `inline` are accepted and not passed on |
| `syminfo.*` | partial | yes (as computed) | n/a | `syminfo / syminfo-numbers, syminfo-strings`: `mintick`, `pointvalue`, `mincontract` are na; `tickerid`, `ticker`, `timezone`, `currency`, `type`, `session`, `description` are empty strings (even `syminfo.ticker == "VOST"` is false). Cause: PineTS is given an in-memory array, so no symbol info exists; `runtime.ts:156` passes only a placeholder name |
| `timeframe.*` | partial | yes (as computed) | n/a | `timeframe / timeframe-fields` computes for `D`; `timeframe / runPine on 1h candles` shows it stays `D` on any chart (`runtime.ts:156`). `timeframe.period`, `multiplier`, `in_seconds`, `isdaily`, `isintraday`, `change` therefore describe the wrong timeframe on every non-daily chart |
| `barstate.*` | partial | yes (as computed) | n/a | `barstate / barstate-fields`: on the last historical bar `isrealtime`, `isconfirmed` and `isnew` are all 1 and `ishistory` is 0, so a script that distinguishes history from realtime sees the final loaded bar as realtime. There is no live bar feed into Pine |
| `session.*` and time functions | partial | yes (as computed) | n/a | `session-time / time-vars, session-vars, last-bar-time, time-functions` ok; `time-session-0000-2359` ok. `time-session-0000-2400` fails: PineTS rejects `"0000-2400"` ("Invalid session specification"), which TradingView accepts. With `syminfo.timezone` empty, exchange-time session checks are unreliable (`time-session-timezone` returns 0 for a New York session) |
| `request.security` same timeframe and symbol | yes | yes | yes | `request / security-same-tf` equals the chart's own value |
| `request.security` other timeframe or symbol | no (silently wrong) | yes (wrong values) | yes (wrong values) | `security-higher-tf`: the weekly open equals the daily open. `security-other-symbol`: `AAPL` close equals the chart's close. PineTS has no data source for another symbol or timeframe, and Vost supplies none, so the value is the chart's own bar. No error or warning is raised. Most dangerous gap: scripts look right and are wrong |
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
| `barcolor` | yes | dropped | no | `barcolor / barcolor-basic`: PineTS returns booleans plus colours; `runPine` gives an all-null line plot named `barcolor#0` (`runtime.ts:49-54`) |
| `plotshape` | yes | partial | partial | `plotshape / plotshape-basic`: marker drawn. Shape is mapped to four marker shapes (`chartSeries.ts:69-75`), `text` is not passed on, `size` is fixed |
| `plotchar` | yes | partial | partial | `plotchar / plotchar-basic`: drawn as the circle shape, the character is dropped |
| `plotarrow` | yes | dropped | no | `plotarrow / plotarrow-basic`: PineTS returns a number per bar; `plotKind` maps it as a shape and `runtime.ts:64` keeps only `value === true`, so every bar is null |
| `plotcandle` | yes | dropped | no | `plotcandle / plotcandle-basic`: PineTS returns `[o,h,l,c]` per bar; `toNum` makes them null, all-null line plot |
| `plotbar` | yes | dropped | no | `plotbar / plotbar-basic`: same as `plotcandle` |
| `line` | yes | dropped | no | `line / line-basic`: PineTS collects the line in `__lines__`; `runtime.ts:59` skips it |
| `label` | yes | dropped | no | `label / label-basic`: `__labels__`, skipped (`runtime.ts:59`) |
| `box` | yes | dropped | no | `box / box-basic`: `__boxes__`, skipped |
| `table` | yes | dropped | no | `table / table-basic`: `__tables__`, skipped |
| `polyline` | yes | dropped | no | `polyline / polyline-basic`: `__polylines__`, skipped |
| `linefill` | yes | dropped | no | `linefill / linefill-basic`: `__linefills__` (and the two lines), skipped |
| `chart.*` | partial | yes (as computed) | n/a | `chart / chart-vars`: `chart.is_standard`, `chart.left_visible_bar_time` compute; `chart.point` works (polyline case). Values describe PineTS's context, not the Vost chart |
| `alert`, `alertcondition` | yes | dropped | no | `alert / alertcondition, alert-fn`: PineTS records them in `ctx.alerts`, but only for the last bar (`bar 119` of 120); `runtime.ts` never reads `ctx.alerts`. Vost has its own alerts feature (price and indicator alerts) that Pine does not feed |
| `log.info`, `warning`, `error` | yes | dropped | no | `log / log-info-warning-error`: PineTS prints to the browser or worker console (360 lines for 120 bars); nothing reaches the user as a Pine log pane |
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
| `strategy.risk.*` | accepted | n/a | n/a | `strategy-risk` compiles and runs. The probe does not trip a limit, so whether PineTS enforces them is **not shown** |
| Commission and slippage | yes | partial | partial | `strategy-commission-slippage`: closed profit 44.91 against 45.46 without; the same in `runPine`, so PineTS applies it. `commissionType/Value` are surfaced in `strategyConfig`, `slippage` is not |
| `pyramiding` | yes | yes | yes | `strategy-pyramiding`: 15 trades, matches PineTS |
| `default_qty_type`, `default_qty_value` | yes | yes | yes | `strategy-qty-percent-equity` (default capital 1,000,000 in v6, so the profit is large) |
| `margin_long/short`, `process_orders_on_close`, `calc_on_every_tick`, `close_entries_rule` | accepted | yes (ignored by Vost) | n/a | `strategy-margin-fill-orders` runs and gives a different profit (38.17), computed by PineTS |
| `strategy.*` built-in variables (`position_size`, `equity`, `netprofit`, `opentrades`, `closedtrades`, `wintrades`, `position_avg_price`, `initial_capital`, `max_drawdown`, `closedtrades.profit(i)`) | yes | yes | yes | `strategy-vars / strategy-builtin-vars, strategy-trade-accessors`: all available, equal in both columns. Strategy plots draw in a separate pane |
| `strategy()` declaration: `initial_capital`, `commission_*`, `default_qty_*` | yes | yes | yes | read in `mapStrategyConfig` (`runtime.ts:117-125`) |

## Known engine gaps (PineTS 0.13.0)

Candidates for upstream reports; none filed.

1. `time(timeframe.period, "0000-2400")` throws "Invalid session specification". TradingView accepts `0000-2400`. Case `session-time / time-session-0000-2400`.
2. `request.security` to another symbol or timeframe returns the chart's own bar and raises neither an error nor a warning. Cases `request / security-higher-tf, security-other-symbol`. Expected: an error, or a pluggable data source.
3. `request.financial`, `economic`, `seed`, `dividends`, `splits`, `earnings` return na (warning only in `ctx.warnings`). Cases `request / request-*`.
4. `syminfo.*` is empty or na with array data, and `math.round_to_mintick` is NaN as a result. Cases `syminfo / ...`, `math / fn math.round_to_mintick(close)`. Expected: a way to give symbol info with the data.
5. `barstate.isrealtime`, `isconfirmed` and `isnew` are true on the last bar of a purely historical run. Case `barstate / barstate-fields`.
6. `alert` and `alertcondition` record only on the last bar (`bar 119`), so history is never scanned for alert events. Cases `alert / ...`. This may be intended for a realtime engine; check upstream.
7. `varip` behaves like `var` (no intrabar state). Case `language / varip`. Expected, since there are no ticks, but worth noting.

No `ta.*`, `math.*`, array, matrix, map, str or strategy function in the probe failed to compile.

## Proposed follow-ups

The owner picks which to build; this decides nothing. Ordered by value, then risk. Sizes are rough.

1. **Pass the real symbol, timeframe and tick size to PineTS.** Replace `'VOST', 'D'` (`runtime.ts:156`) with the chart's symbol and timeframe, and supply what `syminfo.*` needs. Closes `timeframe`, `syminfo`, `session/time` partly. Small to medium; low risk; needs the symbol context passed through `runPine`'s caller and the backtest worker.
2. **Make `request.security` honest.** Either feed real higher-timeframe and other-symbol candles through PineTS's data source, or fail with a clear message instead of returning the chart's data. Closes the `request.*` rows. Large to build, small for the error-only version; medium risk (data fetch in the worker).
3. **Draw `fill`, `plotcandle`, `plotbar`, `barcolor`, `plotarrow`.** Extend `PinePlot` and `mapPlots` (carry OHLC arrays, fill links and bar colours), then `buildPineChart`. Closes five output rows, the most common gap in public scripts. Medium; medium risk (new series types in the chart hook).
4. **Draw `line`, `label`, `box`, `table`, `polyline`, `linefill`.** Read the `__*__` collections instead of skipping them, then render on the chart (tables as an overlay). Closes six rows. Large; medium risk (new chart primitives; bar-index to time mapping).
5. **Surface alerts, logs and warnings.** Read `ctx.alerts`, `ctx.warnings` and the log output, show them in the Pine pane. Optionally route `alertcondition` into Vost's alerts. Closes `alert`, `log`, the "empty plot, no reason" part of `request.*`. Small to medium; low risk.
6. **Richer input controls and plot options.** Color picker, source select, time/symbol/session controls, `group`/`tooltip`/`inline`, plot `linewidth`, `offset`, step/area styles, `plotshape` text and size. Closes the `input.*` and partial plot rows. Medium; low risk.
7. **Import resolver for libraries.** Done: `runPine` sets a resolver backed by the Vost server (open-source libraries fetched from TradingView and kept, closed-source ones pasted). Closed the imports row.
8. **Report the engine gaps upstream** (the list above) and re-probe on each PineTS upgrade: rerun `probe.ts` and diff `output.txt`. Small; no risk.
9. **Verify the strategy risk rules** with a probe that trips a limit. Small.
