# Strategy maker

The strategy maker is an optional page at `/strategy-maker` (type it after your Vost address). It is a small tool for working out strategies from candles: you pick candles, mark the trades you would have taken, and it looks for a built-in strategy that behaves like your marks. What you mark and the model it trains are kept on the Vost server (so any browser on the same server shows them), and the main chart app is not started: the page opens no live stream and does no alert polling. The main app never loads the page's code.

![The empty strategy maker page](../evidence/strategy-maker/strategy-maker-empty-desktop.png)

## Where the data comes from

- **A market**: choose a provider, a symbol (pick a popular one or type your own) and a timeframe, then **Load market**. A market load brings up to 20,000 candles (fewer where the provider has less; Kraken gives at most 720). The chart opens on the latest 300 or so bars so they stay readable; pan and zoom back to see the rest.
- **A saved dataset**: datasets saved in the main app's library are listed read-only; the page never changes the library. With none saved it says "No saved datasets."
- **A CSV file**: **CSV file** opens a file from your disk. A file that cannot be read shows a message on the page.

![A demo market](../evidence/strategy-maker/strategy-maker-market-desktop.png)

The chart pans, zooms and resizes with the window, and works on a narrow screen too.

![A CSV file on a narrow screen](../evidence/strategy-maker/strategy-maker-csv-narrow.png)

## Marking trades

Once candles are showing, a toolbar above the chart lets you mark the trades you would have taken, with a brush. These marks are what the tool learns a strategy from; you need at least 30 of them.

- **Brush long** and **Brush short**: pick one (it shows as pressed), then press on the chart, drag across some bars and let go. The bars from the first to the last one you touched become one trade, shaded green for long or red for short, with an entry and an exit marker. Dragging right to left gives the same trade. A plain click, or a drag over a single bar, marks nothing.
- **Eraser**: drag over trades to remove every one you touch.
- **Undo**, **Redo** and **Clear** (which asks first) work on the marks of this chart.
- While a tool is on, dragging paints instead of moving the chart. Press the tool again, or **Escape**, to pan and zoom as before. One finger paints on a touch screen.
- A new stroke over existing trades replaces the part it covers, so trades never overlap; what is left of a cut trade stays when it still spans two bars.

Keys: **B** brush (it keeps its last side), **E** eraser, **Ctrl+Z** / **Cmd+Z** undo, **Ctrl+Shift+Z** redo, **Escape** leaves the tool. They are ignored while you type in a field.

![A long and a short trade painted on the demo market](../evidence/strategy-maker/strategy-maker-marked-desktop.png)

The list beside the chart (below it on a narrow screen) shows each trade with its side, entry and exit time and bar count; click a row to scroll the chart to it, or its **x** to delete it. The counter shows "N of 30 trades" across all your saved charts and how many more are needed.

![A trade erased](../evidence/strategy-maker/strategy-maker-erased-narrow.png)

Marks are saved on the Vost server a moment after each change (and when you leave or hide the page) and come back when you open the same chart again (the same market and timeframe, saved dataset or CSV file name). Undo history is not kept. If the server cannot be reached or cannot save them, the page says "Marks are not saved" with the reason, and the brush still works until you leave.

![The marks found again after a reload](../evidence/strategy-maker/strategy-maker-restored-desktop.png)

## Finding a strategy

Below the chart, **Find a strategy** turns your marks into a recommendation. Fill in what you want, then press **Find a strategy**.

- **Strategy type**: long and short (the default), long only or short only.
- **Allowed indicators**: the families the search may use (SMA crossover, EMA crossover, MACD, RSI mean reversion, Bollinger Bands, Donchian breakout, Pullback in trend, Reversal, Momentum breakout). All are on at first; at least one must stay on.
- **Use the style of my trades** (in the same box, on by default): before searching, Find reads the bars around each marked trade, labels it with a trading style, and searches only the families of the leading style. When your trades lean no clear way, nothing is narrowed. Switch it off to search every allowed family. See [The style of your trades](#the-style-of-your-trades).
- **Risk (always on)**: fee and slippage in basis points, and the same exits as the Backtest tab, all optional. The stop loss is a percent or a multiple of the ATR. The take profit is a percent, a multiple of the ATR, or a multiple of the stop ("Times the stop", which needs a stop loss or a trailing stop). The trailing stop is off, a percent or a multiple of the ATR. **ATR length** shows only when an ATR option is on. They start at the main backtester's defaults with every exit option off, and fees and slippage are always applied. The search tries every candidate with these exits.

  ![The Risk fieldset with an ATR stop, a times-the-stop take profit and an ATR trailing stop](../evidence/strategy-maker/strategy-maker-find-exits-desktop.png)
- **Targets**: an optional minimum R:R (average win over average loss), minimum hit rate and maximum drawdown. An empty target is not applied.
- **Train on**: which saved sets of marks to learn from. It starts as the chart you have open, or all of them when none is open.

A number that cannot be used is flagged under its field and switches Find off. With fewer than 30 marked trades in the chosen sets, Find stays off and the form says how many more trades are needed. Your choices are kept on the server and are there when you come back, in any browser.

![The form with too few trades](../evidence/strategy-maker/strategy-maker-find-needs-more-desktop.png)

![The form ready to run](../evidence/strategy-maker/strategy-maker-find-ready-desktop.png)

The work runs in a background worker of the page, so the page stays usable and the main app is not touched. A progress bar names the stage (loading data, training, searching, validating). **Cancel** stops it within a second and the page goes back to what it showed before. Pressing Find again also stops a run in progress. If the browser cannot start a worker, the page says "Running on this page; it may pause while it works" and does the same work itself. Market sets are fetched again for the run, and a set that cannot be loaded is listed in the results and skipped.

![A run in progress on a narrow screen](../evidence/strategy-maker/strategy-maker-find-progress-narrow.png)

## Reading the results

![Results with the model's rules and the ranked settings](../evidence/strategy-maker/strategy-maker-results-desktop.png)

- **What explains your trades**: a small decision tree learns when you were in a trade and writes it as plain rules, with how much each family of indicators mattered and how well it called the state on bars it had not seen.
- **The style of your trades**: the mix of styles in your marks and what the search did about it. See below.
- **Ranked settings**: the settings that best reproduce your entries and exits, with the best match and the best one that meets your targets marked. Each row shows its return, hit rate, R:R, largest drawdown, trade count and signals per 100 bars (with how many fired and the rate per day, a signal being a turn to a new side) on the part it was chosen on and on a held-out part it was not. Click a row to draw its trades on the chart beside your own, as outlined circles (entries) and squares (exits) joined by a dashed line; the legend tells "Your trades" from "Found trades". Click the row again to clear them.
- **Validated or Not validated**: the chosen setting is checked on held-out data, in a walk-forward test, against its neighbouring settings and with a Monte Carlo reshuffle, and each check is listed as passed or failed with its detail. It is validated only when the held-out result keeps within your targets.
- **Closest found**: when no setting meets your targets, the nearest one and each gap in words.
- A short note on the limits: few trades prove little, the highlights are drawn with hindsight, and fees and slippage are always on. Skipped sets and skipped trades are listed with their reasons.

![No setting met strict targets: the closest one and its gaps](../evidence/strategy-maker/strategy-maker-closest-narrow.png)

![The trades a found strategy takes, drawn beside the marks](../evidence/strategy-maker/strategy-maker-found-trades-desktop.png)

### The style of your trades

Find labels every marked trade it uses with one of six styles (the same words the strategy families carry: trend following, trend continuation, mean reversion, reversal, breakout, momentum) or "no clear style". It reads only the bars up to and including the entry bar. The block lists the mix, largest first ("479 of 1495 look like trend following"), says what the search did, and has an **Each trade** list with the style and the reason of every trade, labelled by its chart as in the skipped trades. On the chart's trade list each mark the latest result read carries a small tag with its style; hover it to see the reason.

The rules run in this order and the first match wins (a long is described; a short mirrors it, with `s` = +1 for a long and -1 for a short):

1. **Too early**: the 200-bar average does not exist yet, so the trade is "no clear style".
2. **Reversal**: the slow trend (50-bar average against 200-bar average) points against the trade, and the lowest low of the last 50 bars (highest high for a short) came within the last 5 bars.
3. **Mean reversion**: the close is at least 2 standard deviations below its 20-bar average (above, for a short), or RSI 14 is at or below 30 (at or above 70 for a short).
4. **Momentum**: the slow trend points with the trade, and the 20-bar move in its direction is at least 4 times the ATR 14 (as a share of the close).
5. **Breakout**: the close goes through the range of the prior 20 bars in the trade's direction.
6. **Trend following**: the 10-bar average crossed the 30-bar average to the trade's side within the last 5 bars.
7. **Trend continuation**: the slow trend points with the trade and the 5 bars before entry moved against it.
8. Otherwise "no clear style".

The top style must hold at least 40% of the used trades (counting "no clear style") for the search to be narrowed. The leading styles are then the top style plus any style with at least half the top's count, and the search keeps the allowed families that carry one of them. When no style reaches 40%, nothing is narrowed and the block says "Your trades do not lean to one style, so every allowed family was searched". When none of the allowed families carries a leading style, the search also uses every allowed family and the block says so. The model's own narrowing then applies on top, as before.

![The style of your trades, with the list of each trade open](../evidence/strategy-maker/strategy-maker-style-desktop.png)

![The chart's trade list with a style tag on each mark](../evidence/strategy-maker/strategy-maker-trade-styles-desktop.png)

## Using a result in the backtester

Under the ranked settings, an actions bar acts on the row you clicked, or on the headline strategy when none is picked, and names it ("For SMA crossover (fast period 8, slow period 34):").

![The actions bar under the ranked settings](../evidence/strategy-maker/strategy-maker-actions-desktop.png)

- **Open in Backtest** opens Vost in a new tab with the Backtest tab filled in with that strategy, its settings, its direction and its risk (fee, slippage and every exit set: stop loss, take profit, trailing stop and ATR length). A message says what was set and which data it was found on. It does not run the backtest: run it on the same data to see the same trades, because it is the same strategy code. The address carries the settings after a `#`, so nothing is stored by the strategy maker; Vost reads it once and removes it from the address bar, so a reload applies nothing again. A link that cannot be read changes nothing and says so.
- **Copy settings** copies plain text: the strategy, every setting by its name, direction, fee and slippage in bps, stop loss and take profit (or "off"; an ATR or times-the-stop exit is named as such, for example "Stop loss: 2 x ATR" or "Take profit: 2 x the stop"), the trailing stop and ATR length when they are on, initial capital and position size.
- **Copy as Pine strategy** copies a Pine v6 `strategy()` script with those settings as `input.*` defaults, the same capital, size and commission, and the stop and target as `strategy.exit`. An ATR exit computes the ATR in the script as Vost does (not `ta.atr`, which differs), and a trailing stop is a stop the script moves at each bar close, not Pine's built-in trailing order. It takes the same trades as the built-in strategy on the same data (it follows Vost's own indicator maths, and tests check this against the built-in strategies). Two things differ: slippage is not in the script, and a stop or target counts from the bar after the entry, while the Backtest tab also checks the entry bar. After a copy the bar says "Copied". If the browser refuses the clipboard, the text shows in a read-only box, already selected, so you can copy it by hand.

![The Pine script in the box when the clipboard is refused](../evidence/strategy-maker/strategy-maker-copy-fallback-desktop.png)

![The main app opened from Open in Backtest, with the Backtest tab filled in](../evidence/strategy-maker/strategy-maker-handoff-backtest-desktop.png)

## Searching many markets

Below the Find section, **Search markets** tries many indicator settings and exits on many markets and timeframes at once, and keeps the ones that reach your targets. It needs no marks and does not use the model. The last 30% of every market is kept out of the search to check the winners on.

- **Market lists**: the top 30 crypto by market cap and by 24-hour volume (built live, so they carry a date and say "stale" when the last refresh failed), the top 30 stocks by market cap and by volume, and a list of indices. Each shows its date and how many markets it holds; a list that could not be built shows why and cannot be picked. None is picked at first.
- **Timeframes** (1d and 1w at first; 1m to 1w can be picked), **Indicators** (MACD, SMA and EMA crossover at first), and **Strategy type** (long only at first). An earlier study of this search ([the spike](../spikes/strategy-search/README.md)) found nothing that met a target on 1m, 5m, 15m and 30m bars, and nothing that held for RSI reversion and Bollinger bands; those choices carry a note saying so and a link here. They stay pickable.
- **Composed (entry + filters)** is the last Indicators choice. It tries an entry rule plus filters. Pick the **entry rules** (SMA or EMA crossover, MACD, RSI reversion, Bollinger bands, Donchian breakout), each with its own small grid of settings, and the **filters** (trend, volume, volatility, trend strength): each picked filter is tried both off and on. The trend filter is price against a 100 or 200 bar SMA or EMA, and **trend timeframes** read it on a longer timeframe built from the loaded bars (2x to 24x the chart; "same as the chart" is always tried). On weekly bars only the chart's own timeframe is tried. Volume asks for 1.5 times the average, volatility for the default ATR band and trend strength for an ADX of at least 25.
- **TradingView indicators** (under Composed): a stored TradingView indicator (added in the Pine pane, see [TradingView indicators](pine.md)) can be tried as an extra entry rule or as a filter. Pick it in the list and press "Add as entry rule" or "Add as filter". Each one is a role with a rule over its plots, set as in the Backtest tab: an entry crosses one plot against another, the close or a level (or reads a drawn shape); a filter checks a plot above or below another, or inside a range. An entry is one more entry rule beside the built-in ones, with its own settings. A filter is tried both off and on, like the built-in filters. Up to four entries and four filters can be picked. For each number input of the script you can keep one value or press "Search a range" and give a start, an end and a step (for example ATR Length from 10 to 20 in steps of 5, three values); a range stays inside the input's own minimum and maximum, and a step must be above 0. Other inputs keep the value you set, or the script's default. Results name the indicator, its rule and the input values that were set, for example `TradingView "My EMA" close crosses EMA, length 20; trend SMA 200`, and **Open in Backtest** opens the Backtest tab with the same indicator, rule and inputs, fetching the script itself (the address never carries the source).
- **Script runs**: each indicator and input setting runs once per market and timeframe on the searched part and once on the unseen part (twice more with the chance baseline), however many settings read it; an indicator used as an entry and as a filter with the same inputs runs once. The page shows this count next to the combination count ("; 60 TradingView script runs (limit 2,000)"). Above 2,000 script runs the button is off and the page says so; nothing starts. A script that cannot run on a market (an error in it, a strategy instead of an indicator, a plot that is missing, or an indicator that is no longer stored) skips that market and timeframe, names the indicator in the skipped list, and the search goes on.
- **Beat buy and hold on unseen data**: off at first. "Return above buy and hold" makes a result count as held only if its return on the unseen part is also above the return of buying at the first close and holding to the last. "Return over drawdown" compares return divided by largest drawdown instead. The target applies to the unseen part only; "met a target" is not changed by it.
- **Chance baseline**: off at first. When on, every market that was searched is searched again on a shuffled copy of its candles (the order of the bar-to-bar moves is mixed, so the spread of moves stays and any pattern in time is gone), with the same settings, exits, targets and split. It adds only counts, never rows, and it doubles the number of combinations.
- **Targets**: two rows, "75% hit rate with R:R 1" **or** "50% hit rate with R:R 4". A result needs to meet either one. Clear both boxes of a row to leave it out; at least one row must stay.
- **Sizing and costs**: account size (1000), risk per trade as the percent of the account lost when the stop is hit (2%), and fee and slippage in bps (10 and 5).
- **Exit kinds**: how the exits are placed. "Stop sized by the typical bar range" is on at first; "ATR stop", "ATR trailing stop" and "TradingView indicator stop" can be added. Each of the first three multiplies the number of combinations, and at least one kind must stay on. The **TradingView indicator stop** places the stop at one line plot of a stored indicator (pick the indicator, its plot, whether the stop is fixed at the entry bar or trails the plot, and the values of its inputs; they stay fixed). It is tried on Composed settings only, with each take profit multiple as a multiple of the stop distance at entry (in R), so it adds one exit per take profit multiple and the stop multiples do not apply to it; the plain indicator families skip it. The indicator runs once per market, timeframe and part and counts in the script runs (an indicator with the same inputs as an entry or a filter runs once). A script that cannot run skips the market. A level on the wrong side of the price places no stop, so that setting opens no trade there.
- **Stop** and **Take profit**: the multiples tried. For the range kind a stop is a multiple of the market's typical bar range. For the ATR kinds it is a multiple of the ATR (14 bars, read on the signal bar), and for the trailing kind the stop trails the price at that distance, fixed at entry. A take profit is a multiple of the stop (for the ATR kinds, in R: 3R is three times the stop distance). An ATR exit cannot trade in the first 14 bars of each part while the ATR warms up.

A bad number is flagged under its field and switches the search off with the reason, as does no list, no timeframe, no indicator or no target row. Above the button, the page says how big the search is ("10 markets x 1 timeframe = 116,100 combinations"; a market in two lists counts once). The count is exact: it covers the Composed settings (worked out for each timeframe), the TradingView indicator settings and the baseline's second pass. Above the limit of 2,000,000 combinations the button is off and the page says so; nothing starts.

![The Search markets panel with its defaults](../evidence/strategy-search/strategy-search-panel-desktop.png)

![The Composed choices: entry rules, filters and trend timeframes](../evidence/strategy-search/strategy-search-composed-desktop.png)

![The TradingView indicators section: an entry rule with a range on its ATR length, and the script-run count](../evidence/strategy-search/strategy-search-pine-section-desktop.png)

![A results row naming the TradingView indicator and its input values](../evidence/strategy-search/strategy-search-pine-results-desktop.png)

![The study notes on 1m to 30m, RSI reversion and Bollinger bands, and the Beat buy and hold and Chance baseline choices](../evidence/strategy-search/strategy-search-study-notes-desktop.png)

![The Exit kinds group with the ATR stop and ATR trailing stop on, and the larger count](../evidence/strategy-search/strategy-search-exit-kinds-desktop.png)

![The TradingView indicator stop picked as a trailing stop, and the count](../evidence/strategy-search/strategy-search-pine-stop-section-desktop.png)

![A result line naming the indicator stop: trailing stop at Supertrend Supertrend, take profit 1R](../evidence/strategy-search/strategy-search-pine-stop-results-desktop.png)

![Every list, timeframe and indicator is over the limit, so Search is off](../evidence/strategy-search/strategy-search-over-budget-desktop.png)

While it runs, a bar shows the percent and the market and timeframe being searched. **Cancel** takes the panel back to idle within a second, and starting Find or another search replaces the run.

![A search in progress on a narrow screen](../evidence/strategy-search/strategy-search-running-narrow.png)

The results start with how many combinations were tried, how many met a target and how many also **held on unseen data**, and a plain warning: with this many combinations tried, a result that meets a target can be luck, and the ones that held are the ones to trust more. Each row names its exit: `2.10% / 4.20%` for the range kind, `2 ATR / 3R` for an ATR stop, `2 ATR trailing / 3R` for an ATR trailing stop and `Supertrend Supertrend stop / 3R` or `Supertrend Supertrend trailing / 3R` (indicator, plot, then the mode) for a TradingView indicator stop; the Stop / take profit column sorts by kind, then by stop. A **Buy & hold** column shows the return of holding the market over the same part as the row's other figures, so a result can be read against it (an older result without it shows "n/a"). A Composed result is worded as its entry rule and only the filters that are on, for example `EMA crossover fast 10, slow 40; trend EMA 200 on 4x bars; ADX 25 or more`. With the chance baseline on, the header adds a line, "N held on real data, M on shuffled copies of the same markets (S series)": M is what chance alone gives on markets with the same moves in a random order, so a real count near it says little, and one well above it is worth a closer look. The table is ranked held results first and sorts by any column header. For a held row the figures (trades, signals per 100 bars, hit rate, R:R, final equity, maximum drawdown) come from the unseen part; for the others they come from the part that was searched. The **Signals / 100 bars** column also shows how many signals fired and the rate per day, and hovering it gives the other part's figures. **Open in Backtest** opens Vost in a new tab on that market and timeframe, with the Backtest tab set to the strategy, its settings, the exit it used (the percent stop and take profit, the ATR stop or trailing stop with the R target and ATR length, or the TradingView indicator stop card with the R target), fee, slippage, account size and risk per trade, and the direction. A message names the market and timeframe. Run the backtest to see the same trades the search took.

![Ranked results, with the ones that held on unseen data first](../evidence/strategy-search/strategy-search-results-desktop.png)

![A small Composed run with the chance baseline: the held counts on real data and on shuffled copies, and the Buy & hold column](../evidence/strategy-search/strategy-search-baseline-results-desktop.png)

**Closest found** lists, for each market and timeframe where nothing met a target, the nearest setting and its gaps in words. **Skipped** lists the markets that failed to load, or were too short, with the reason.

![Nothing met strict targets: the closest settings and the skipped market](../evidence/strategy-search/strategy-search-closest-desktop.png)

![The main app opened on the result's market and timeframe, with risk per trade set](../evidence/strategy-search/strategy-search-handoff-backtest-desktop.png)

## Where Find and the market search run

By default Find, Retrain and **Search markets** run in your browser, in a background worker of the page, and stop when the page closes. In **Settings**, **Heavy jobs** lets you pick **Server** instead (see [The Settings popup](getting-started.md#the-settings-popup) and [Where heavy jobs run](backtesting.md#where-heavy-jobs-run)). A choice applies to the next run; a run already going is not moved.

With **Auto** picked, Find, Retrain and the market search each run where the Settings benchmark found them faster (Retrain uses the Find time); the progress line says "Running on the server (Auto)" or "Running in the browser (Auto: ...)", and with no benchmark Auto runs in the browser (see [The benchmark and Auto](backtesting.md#the-benchmark-and-auto)).

On **Server**, the run goes to the Vost server and shows the same progress bar, **Cancel** and results as in the browser. While it runs, the progress line says "Running on the server; it keeps going if you close the page."

![A Find running on the server](../evidence/strategy-maker-server/strategy-maker-server-find-running-desktop.png)

A server run keeps going when you close the page or reload it. Open the page again and it shows the progress of a run still going, then the result; a run that finished while the page was closed shows its result at once, with a note ("Find finished on the server while the page was closed"). A model trained while the page was closed is saved with the marks it was trained on, so Saved model still tells you when your marks have changed since. **Cancel** stops the run on the server; pressing Find, Retrain or Search again also stops the run before it. If the server restarts during a run, the run is gone and the page says "stopped: the server restarted".

![The same Find after reloading the page, with its progress back](../evidence/strategy-maker-server/strategy-maker-server-find-reloaded-desktop.png)

![A market search after reloading the page, with its progress back](../evidence/strategy-maker-server/strategy-maker-server-search-reloaded-desktop.png)

![The market search result after the reload](../evidence/strategy-maker-server/strategy-maker-server-search-result-desktop.png)

If the server cannot take a run (its engine is missing, its data folder cannot be written, the request is too big or it cannot be reached), the run happens in the browser instead and the page says why ("Server jobs unavailable (...); running in the browser"). With **Browser** picked, nothing is sent to the server. Trades shown on the chart for a result row always come from the page.

## Teaching it more

The more charts you mark, the more the model has to learn from. Each chart you mark is its own **set**, and **Train on** picks which sets a run learns from.

- **Saved model**: after a Find or a Retrain the model is kept on the server. When you open the page again its rules, importance and held-out report show under **Saved model**, with no run.
- **Out of date and Retrain**: when you mark or change trades on a chosen set, add a set to **Train on** or take one out, the page says "Model out of date" and why, and offers **Retrain**. Retrain learns from the chosen sets only, with the same progress and **Cancel** as Find, and clears the notice. When the model is up to date, **Find** reuses it and goes straight to the search, so it starts faster; when it is not, Find trains again first, so its results never come from an out-of-date model.
- **Sets**: one row per saved set with its name, trade count and when it last changed. **Open** loads that market, saved dataset or CSV file on the chart, **Rename** gives it a name of your own (it is still the same set), and **Delete** asks first and removes the set and its marks.
- **Export and Import**: **Export** saves every set (a CSV set with its candles) and the model as one file, `vost-strategy-maker.json`, to move to another machine. **Import** reads such a file and checks all of it before it writes anything: a file that is not a Strategy maker export, has another version or has a malformed set or model is refused with the reason. Sets you do not have are added. Sets that are the same are left alone, so importing a file twice changes nothing. A set that differs from yours is listed with **Keep mine** and **Use imported** (Cancel writes nothing); then everything is written at once. A model in the file replaces the saved one and shows as out of date unless its sets match yours. A saved dataset from another machine that is not in this library is listed and skipped at Find with "no longer in the library".

![The saved model after a reload](../evidence/strategy-maker/strategy-maker-saved-model-desktop.png)

![The Sets panel](../evidence/strategy-maker/strategy-maker-sets-panel-desktop.png)

- **Kept on the server, moved once**: the sets, the find form and the model live in the Vost server's data folder, so a brand-new browser on the same server shows the same sets and the saved model. Versions before this kept them in the browser's own database; the first time you open the page the server adopts what it lacks and the browser's copy is deleted, once the server has confirmed it holds everything. The page says "Moved N sets from this browser to the server". A set the server already held differently stays as it is on the server, and the browser's version is kept in `strategy-maker-imported-<ms>.json` in the data folder (the page names the file). If the server cannot be reached the move waits for the next visit.

![Moved from the browser to the server](../evidence/strategy-maker/strategy-maker-moved-desktop.png)

![A brand-new browser shows the same sets](../evidence/strategy-maker/strategy-maker-fresh-browser-desktop.png)

![One more mark makes the model out of date](../evidence/strategy-maker/strategy-maker-model-out-of-date-desktop.png)

![A set that differs from the imported file](../evidence/strategy-maker/strategy-maker-import-conflict-desktop.png)
