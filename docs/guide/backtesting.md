# Backtesting

Backtests run in your browser (a Web Worker), so they are unlimited. Signals are computed per bar from data up to and including that bar, and executed at the next bar's open. There is no look-ahead.

![The Backtest pane](../evidence/bt-range/bt-range-range-desktop.png)

## The Backtest pane

Open the **Backtest** tab in the bottom dock. Pick a **Strategy** and set its parameters:

- SMA crossover and EMA crossover (fast, slow, direction)
- MACD (fast, slow, signal, direction)
- RSI mean reversion (length, oversold, overbought, direction)
- Bollinger (length, mult, mode: breakout or reversion, direction)
- Donchian breakout (entry, exit, direction)
- Buy & hold
- Custom (JS) and Pine strategies: see [Custom strategies](../STRATEGIES.md) and [Pine Script](pine.md)

Risk controls: initial capital, position size (% of equity), fees and slippage in bps per side, stop loss %, take profit % and long and short. Then press **Run backtest**.

While it runs, a progress bar under the button (and in the Results tab) shows the stage and a percent: computing signals, simulating trades, running the Pine script, then computing metrics. It goes away when the run ends.

![The progress bar mid-run](../evidence/bt-progress/bt-progress-backtest-tab-desktop.png)

## The backtest range

The pane has a **From** and **To** range. The backtester and the optimizer run only on that window of the loaded data; empty means all of it. The pane says how many of the loaded bars are in the range, and warns when the range starts before or ends after the data or holds fewer than 3 bars. The range is remembered between sessions.

![A backtest range](../evidence/bt-range/bt-range-range-desktop.png)

## Results

The **Results** tab shows 20+ metrics (return against Buy & hold, CAGR, Sharpe, Sortino, Calmar, max drawdown and its duration, profit factor, exposure, expectancy and more; hover a metric for its definition), the equity and underwater chart and the full trade log. **Export trades CSV** and **Export equity CSV** save them. **Show backtest trades** (also in the chart toolbar) draws entry and exit markers on the chart.

## The Optimizer

The **Optimizer** tab grid-searches any number of parameters at once. Each parameter is a row (**Parameter 1**, **Parameter 2**, ...) with its own **From**, **To** and **Step**. Press **Add parameter** to sweep another one (it starts at half to one and a half times its current value) and **Remove** to drop a row; a parameter can only be used in one row. The pane shows how many combinations it will run (the product of every row). Choose the metric in **Rank by** and press **Optimize**. Every combination is listed in a full-width table with its rank, one column per swept parameter, the ranking metric and the main measures (total return, CAGR, Sharpe, Sortino, Calmar, profit factor, win rate, max drawdown and its duration, trades, exposure, expectancy and buy & hold). Click a column header to sort by it (click again to reverse; empty values always come last); sorting by **Rank** brings back the ranking order. The table shows 100 rows at a time: use **Previous** and **Next**, and the count under it ("Rows 101-200 of 1,234") says where you are. A heatmap below the table shows the combinations. Click a heatmap cell or press **Apply** on a row to set those parameters and re-run the backtest.

**Export results CSV** downloads every combination in ranking order, with all measures as raw numbers. The file starts with `#` lines recording the settings the run used (strategy, fixed parameters, symbol, timeframe, data and range, capital, position size, fees, slippage, stop loss, take profit, shorts, ranking metric and the swept ranges), so a result can be reproduced later; changing settings after the run does not change them.

The heatmap has **Rows** and **Columns** pickers for choosing its two axes among the swept parameters (**Columns** can be set to none). With three or more parameters it shows only the combinations where the other parameters equal the best result, and says which values they are fixed at.

While a sweep runs, **Cancel** next to the progress bar stops it and brings back the result that was shown before. Other charts are not affected.

The table and heatmap are labelled with the parameters you swept, and each result is exactly what a single backtest with those parameters gives. Every value from **From** to **To** is tried (nothing is dropped). A grid is limited to 100,000 combinations: above that the pane says so and **Optimize** stays disabled until you narrow a range or raise a step. A whole-number parameter (such as a period) needs a whole-number step, otherwise the pane says so and **Optimize** is disabled.

![Sweeping the slow period alone](../evidence/optimizer/optimizer-slow-sweep-desktop.png)

![The results sorted by Trades](../evidence/optimizer/optimizer-results-sorted-desktop.png)

![A grid over the limit](../evidence/optimizer/optimizer-over-limit-desktop.png)

![Three parameters swept together, with the heatmap axis pickers](../evidence/optimizer/optimizer-three-parameters-desktop.png)

![A long run with its Cancel button](../evidence/optimizer/optimizer-cancel-visible-desktop.png)
