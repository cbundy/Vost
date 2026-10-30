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

## The backtest range

The pane has a **From** and **To** range. The backtester and the optimizer run only on that window of the loaded data; empty means all of it. The pane says how many of the loaded bars are in the range, and warns when the range starts before or ends after the data or holds fewer than 3 bars. The range is remembered between sessions.

![A backtest range](../evidence/bt-range/bt-range-range-desktop.png)

## Results

The **Results** tab shows 20+ metrics (return against Buy & hold, CAGR, Sharpe, Sortino, Calmar, max drawdown and its duration, profit factor, exposure, expectancy and more; hover a metric for its definition), the equity and underwater chart and the full trade log. **Export trades CSV** and **Export equity CSV** save them. **Show backtest trades** (also in the chart toolbar) draws entry and exit markers on the chart.

## The Optimizer

The **Optimizer** tab grid-searches one or two parameters (**Parameter A**, optionally B, each with **From**, **To** and **Step**) and shows how many combinations it will run. Choose the metric in **Rank by** and press **Optimize**. The best results are ranked in a table, and a heatmap shows every combination. Click a heatmap cell or press the apply button on a row to set those parameters and re-run the backtest.
