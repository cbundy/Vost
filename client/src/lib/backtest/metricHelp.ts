/**
 * Help text for every figure in the Results tab. Each entry says what the
 * figure is as Vost computes it, how to read it, how it bears on net profit
 * and which other figures it moves with. Keep each field under 300 characters.
 */
import type { ExitReason } from './types';

export type HelpKey =
  | 'finalEquity' | 'netPnl' | 'totalReturn' | 'buyHold' | 'cagr' | 'sharpe' | 'sortino' | 'calmar'
  | 'maxDrawdown' | 'maxDdDuration' | 'exposure' | 'trades' | 'winRate' | 'profitFactor' | 'expectancy'
  | 'avgTrade' | 'bestWorst' | 'avgBars' | 'totalFees' | 'bars'
  | 'wins' | 'losses' | 'grossProfit' | 'grossLoss' | 'bestTrade' | 'worstTrade'
  | 'longestWinStreak' | 'longestLossStreak' | 'currentStreak'
  | 'exitSignal' | 'exitStopLoss' | 'exitTakeProfit' | 'exitEndOfData' | 'exitShare'
  | 'legendStrategy' | 'legendBuyHold'
  | 'mcFinalReturn' | 'mcMaxDrawdown' | 'mcThisRun' | 'mcChanceOfLoss';

export interface MetricHelp {
  label: string;
  what: string;
  reading: string;
  profit: string;
  related: { key: HelpKey; note: string }[];
}

export const EXIT_REASON_HELP: Record<ExitReason, HelpKey> = {
  signal: 'exitSignal',
  stop_loss: 'exitStopLoss',
  take_profit: 'exitTakeProfit',
  end_of_data: 'exitEndOfData',
};

export const METRIC_HELP: Record<HelpKey, MetricHelp> = {
  finalEquity: {
    label: 'Final equity',
    what: 'Account value at the end of the run: starting capital plus every closed trade, after fees and slippage.',
    reading: 'Higher is better. Compare it with the starting capital, and with Buy & hold, to judge whether trading was worth it.',
    profit: 'It is the bottom line: final equity minus starting capital is the net profit.',
    related: [
      { key: 'netPnl', note: 'is final equity minus starting capital' },
      { key: 'totalReturn', note: 'is the same gain as a percentage' },
    ],
  },
  netPnl: {
    label: 'Net P/L',
    what: 'Final equity minus starting capital, in money, after fees and slippage.',
    reading: 'Positive means the run made money. The size only means something against the capital and the risk taken.',
    profit: 'It is the profit itself.',
    related: [
      { key: 'totalFees', note: 'fees are already subtracted, so more trading can shrink it' },
      { key: 'maxDrawdown', note: 'shows the pain suffered to earn it' },
    ],
  },
  totalReturn: {
    label: 'Total return',
    what: 'Net profit as a percentage of the starting capital over the whole run.',
    reading: 'Higher is better, but judge it against Buy & hold and against the drawdown needed to get it.',
    profit: 'It is the profit expressed relative to capital, so runs of different sizes can be compared.',
    related: [
      { key: 'buyHold', note: 'the passive result to beat' },
      { key: 'maxDrawdown', note: 'a big return with a big drawdown is hard to hold' },
      { key: 'cagr', note: 'the same return per year' },
    ],
  },
  buyHold: {
    label: 'Buy & hold',
    what: 'Return of buying at the first close and holding to the last close. It ignores fees and slippage.',
    reading: 'The benchmark. A strategy that returns less than this, with a similar drawdown, added no value.',
    profit: 'If it beats Total return, simply holding would have made more profit than the strategy.',
    related: [
      { key: 'totalReturn', note: 'compare the two directly' },
      { key: 'exposure', note: 'a strategy in the market less often should be judged against risk, not only return' },
    ],
  },
  cagr: {
    label: 'CAGR',
    what: 'Compound annual growth rate: the yearly return that would give the same total return. Shown empty when the run spans under about a week.',
    reading: 'Higher is better. Over short runs the annualised figure can be wildly large, so treat it with care.',
    profit: 'It restates profit as a yearly rate, so runs of different lengths can be compared.',
    related: [
      { key: 'calmar', note: 'CAGR divided by max drawdown' },
      { key: 'totalReturn', note: 'the same gain not scaled to a year' },
    ],
  },
  sharpe: {
    label: 'Sharpe',
    what: 'Mean bar-to-bar equity return divided by its standard deviation, annualised by the bars per year. No risk-free rate is subtracted.',
    reading: 'Higher is better. Above 1 is decent, above 2 is strong and rare; below 0 means the average bar lost money.',
    profit: 'It shows how smoothly profit was earned. Two runs with equal profit differ in Sharpe by how bumpy the ride was.',
    related: [
      { key: 'sortino', note: 'the same idea counting only down moves' },
      { key: 'maxDrawdown', note: 'a high Sharpe usually comes with a shallow drawdown' },
      { key: 'calmar', note: 'return against the worst drawdown instead of the volatility' },
    ],
  },
  sortino: {
    label: 'Sortino',
    what: 'Like Sharpe, but the risk is the deviation of negative bar returns only, so up moves are not penalised. Annualised, no risk-free rate.',
    reading: 'Higher is better. It is usually above Sharpe; a Sortino far above Sharpe means the volatility was mostly upward.',
    profit: 'It shows how much profit came per unit of losing volatility.',
    related: [
      { key: 'sharpe', note: 'the same measure counting all volatility' },
      { key: 'maxDrawdown', note: 'a deep drawdown drags Sortino down' },
    ],
  },
  calmar: {
    label: 'Calmar',
    what: 'CAGR divided by the size of the max drawdown. Empty when CAGR is empty.',
    reading: 'Higher is better. Above 1 means the yearly gain exceeded the worst fall; above 3 is excellent.',
    profit: 'It tells how much yearly profit you got for the worst loss you had to sit through.',
    related: [
      { key: 'cagr', note: 'the numerator' },
      { key: 'maxDrawdown', note: 'the denominator; a deeper drawdown lowers Calmar' },
      { key: 'sharpe', note: 'a volatility-based view of the same trade-off' },
    ],
  },
  maxDrawdown: {
    label: 'Max drawdown',
    what: 'The largest fall of equity from a running peak to a later low, as a percentage of that peak.',
    reading: 'Lower is better. Ask whether you could have sat through this fall; many traders quit near 20 to 30 percent.',
    profit: 'It is not profit but the price paid for it: a deep drawdown needs a larger gain just to recover.',
    related: [
      { key: 'maxDdDuration', note: 'how long that fall lasted' },
      { key: 'calmar', note: 'return per unit of drawdown' },
      { key: 'exposure', note: 'more time in the market usually means deeper drawdowns' },
      { key: 'mcMaxDrawdown', note: 'Monte Carlo drawdown is measured trade to trade, so it differs' },
    ],
  },
  maxDdDuration: {
    label: 'Max DD duration',
    what: 'The longest stretch, in bars, that equity stayed below an earlier peak before making a new high.',
    reading: 'Lower is better. Compare it with the Bars figure: a duration near the whole run means equity rarely made new highs.',
    profit: 'Long drawdowns are long periods without profit, even if the run ends well.',
    related: [
      { key: 'maxDrawdown', note: 'the depth of the worst fall' },
      { key: 'bars', note: 'the total run length to compare with' },
    ],
  },
  exposure: {
    label: 'Exposure',
    what: 'Share of bars with an open position, out of all bars in the run.',
    reading: 'There is no good or bad level. Low exposure with a good return means efficient use of capital; 100 percent is always invested.',
    profit: 'Profit only comes while a position is open, but so does risk.',
    related: [
      { key: 'totalReturn', note: 'return per unit of exposure shows how efficient the strategy is' },
      { key: 'maxDrawdown', note: 'higher exposure tends to bring deeper drawdowns' },
      { key: 'avgBars', note: 'longer trades raise exposure' },
    ],
  },
  trades: {
    label: 'Trades',
    what: 'Number of completed trades, long and short.',
    reading: 'More trades make the other figures more trustworthy. Under about 30, treat win rate and averages as noise.',
    profit: 'Each trade pays fees and slippage, so many small trades can cost more than they earn.',
    related: [
      { key: 'totalFees', note: 'rises with the trade count' },
      { key: 'winRate', note: 'only reliable with enough trades' },
      { key: 'mcFinalReturn', note: 'Monte Carlo needs enough trades to be meaningful' },
    ],
  },
  winRate: {
    label: 'Win rate',
    what: 'Share of trades that closed with a profit. A trade with exactly zero P/L counts as a loss.',
    reading: 'Higher is not always better. Trend strategies often win 35 to 45 percent and still profit; many wins can hide a few huge losses.',
    profit: 'It matters only together with the size of wins and losses.',
    related: [
      { key: 'profitFactor', note: 'combines win rate with win and loss size' },
      { key: 'expectancy', note: 'the average result per trade after both are weighed' },
      { key: 'avgTrade', note: 'a low win rate needs a larger average winner' },
    ],
  },
  profitFactor: {
    label: 'Profit factor',
    what: 'Gross profit divided by gross loss. Infinite when there are no losing trades.',
    reading: 'Above 1 is profitable. Roughly 1.3 to 2 is solid; above 3 on few trades is often luck.',
    profit: 'Above 1 the strategy made money after fees and slippage; it says how many times winners paid for losers.',
    related: [
      { key: 'winRate', note: 'a low win rate can still give a high profit factor with big winners' },
      { key: 'grossProfit', note: 'the numerator' },
      { key: 'grossLoss', note: 'the denominator' },
    ],
  },
  expectancy: {
    label: 'Expectancy / trade',
    what: 'Mean profit or loss per trade in money, after fees and slippage.',
    reading: 'Positive means the average trade makes money. It is only trustworthy with enough trades.',
    profit: 'Expectancy times the number of trades is the net profit.',
    related: [
      { key: 'trades', note: 'multiplied by the count gives net P/L' },
      { key: 'winRate', note: 'with average win and loss size, it sets expectancy' },
      { key: 'avgTrade', note: 'the same average as a percentage' },
    ],
  },
  avgTrade: {
    label: 'Avg trade',
    what: 'Mean return per trade as a percentage of the trade entry value, after fees.',
    reading: 'Higher is better. It should be clearly larger than the cost of a round trip (fees plus slippage) to survive costs.',
    profit: 'A positive average repeated over many trades is what builds profit.',
    related: [
      { key: 'expectancy', note: 'the same idea in money' },
      { key: 'totalFees', note: 'costs eat directly into a small average trade' },
    ],
  },
  bestWorst: {
    label: 'Best / worst trade',
    what: 'The largest winning and the largest losing single trade, as a percentage return.',
    reading: 'A best trade far larger than the rest means the result may hang on one lucky trade; a worst trade near the stop loss is expected.',
    profit: 'If removing the best trade turns the run negative, the profit is fragile.',
    related: [
      { key: 'avgTrade', note: 'compare each extreme with the average' },
      { key: 'exitStopLoss', note: 'a stop loss caps the worst trade' },
    ],
  },
  avgBars: {
    label: 'Avg bars in trade',
    what: 'Mean number of bars a trade stays open, from entry to exit.',
    reading: 'No good or bad value. It tells whether the strategy scalps or holds; compare it with how fast your timeframe moves.',
    profit: 'Short trades need less move per trade to cover costs but trade more often.',
    related: [
      { key: 'exposure', note: 'longer trades raise exposure' },
      { key: 'totalFees', note: 'shorter trades mean more trades and more fees' },
    ],
  },
  totalFees: {
    label: 'Total fees',
    what: 'All fees paid on both sides of every trade, in money. Slippage is not included here.',
    reading: 'Lower is better. Compare it with Net P/L: if fees are a large part of the gross profit, the edge is thin.',
    profit: 'Fees are subtracted from profit on every trade, whether it wins or loses.',
    related: [
      { key: 'trades', note: 'fees grow with the trade count' },
      { key: 'netPnl', note: 'already net of these fees' },
    ],
  },
  bars: {
    label: 'Bars',
    what: 'Number of candles the backtest ran over.',
    reading: 'More bars means a longer test and more reliable figures. A few hundred bars is thin.',
    profit: 'It does not affect profit directly, but a short run says little about whether profit will repeat.',
    related: [
      { key: 'trades', note: 'more bars usually give more trades' },
      { key: 'maxDdDuration', note: 'measured in the same bars' },
    ],
  },
  wins: {
    label: 'Wins',
    what: 'Number of trades that closed with a profit. A trade with exactly zero P/L is a loss.',
    reading: 'Meaningful only against Losses and the size of each.',
    profit: 'Wins make up the gross profit.',
    related: [
      { key: 'losses', note: 'wins plus losses equal all trades' },
      { key: 'winRate', note: 'wins as a share of all trades' },
    ],
  },
  losses: {
    label: 'Losses',
    what: 'Number of trades that closed at zero or below. A trade with exactly zero P/L counts as a loss.',
    reading: 'Losses are normal. What matters is that winners outweigh them in size, not only in count.',
    profit: 'Losses make up the gross loss.',
    related: [
      { key: 'wins', note: 'wins plus losses equal all trades' },
      { key: 'longestLossStreak', note: 'how many came in a row' },
    ],
  },
  grossProfit: {
    label: 'Gross profit',
    what: 'Sum of the profit of all winning trades, after fees and slippage.',
    reading: 'Higher is better, but only against the Gross loss.',
    profit: 'Gross profit minus gross loss is the net profit.',
    related: [
      { key: 'grossLoss', note: 'the other half of net profit' },
      { key: 'profitFactor', note: 'gross profit divided by gross loss' },
    ],
  },
  grossLoss: {
    label: 'Gross loss',
    what: 'Sum of the loss of all losing trades, after fees and slippage. Shown as a positive amount: the size of the losses.',
    reading: 'Smaller in size is better, compared with the Gross profit.',
    profit: 'It is what winning trades must pay back before any net profit shows.',
    related: [
      { key: 'grossProfit', note: 'the other half of net profit' },
      { key: 'profitFactor', note: 'gross profit divided by the size of this' },
    ],
  },
  bestTrade: {
    label: 'Best trade',
    what: 'The largest single-trade return as a percentage, in this group of trades.',
    reading: 'If it is far above the average trade, the result leans on one lucky trade.',
    profit: 'If removing it turns net profit negative, the profit is fragile.',
    related: [
      { key: 'worstTrade', note: 'the other extreme' },
      { key: 'avgTrade', note: 'compare it with the typical trade' },
    ],
  },
  worstTrade: {
    label: 'Worst trade',
    what: 'The largest single-trade loss as a percentage, in this group of trades.',
    reading: 'It should sit near your stop loss, if you use one. A much larger loss means a gap or a missing stop.',
    profit: 'One large loss can erase many small wins.',
    related: [
      { key: 'bestTrade', note: 'the other extreme' },
      { key: 'exitStopLoss', note: 'a stop loss caps the worst trade' },
    ],
  },
  longestWinStreak: {
    label: 'Longest win streak',
    what: 'The most winning trades in a row, with their summed profit below. Zero P/L is a loss and ends it.',
    reading: 'Longer is nicer, but streaks are partly luck. Expect it to grow with the trade count and win rate.',
    profit: 'It shows the best run of consecutive profit, not total profit.',
    related: [
      { key: 'winRate', note: 'a higher win rate makes longer streaks likely' },
      { key: 'longestLossStreak', note: 'the opposite run' },
    ],
  },
  longestLossStreak: {
    label: 'Longest loss streak',
    what: 'The most losing trades in a row, with their summed loss below. Zero P/L counts as a loss.',
    reading: 'Shorter is better. It shows what you must be able to stomach without abandoning the strategy.',
    profit: 'A long loss streak drives drawdown, and the profit must be earned back afterwards.',
    related: [
      { key: 'maxDrawdown', note: 'long loss streaks cause deep drawdowns' },
      { key: 'winRate', note: 'a low win rate makes long loss streaks likely' },
    ],
  },
  currentStreak: {
    label: 'Current streak',
    what: 'The run of wins or losses the backtest ended on, counted back from the last trade.',
    reading: 'It is a snapshot of the end of the data and does not predict the next trade.',
    profit: 'It has no effect on profit; it shows the state the run finished in.',
    related: [
      { key: 'longestWinStreak', note: 'compare with the best win run' },
      { key: 'longestLossStreak', note: 'compare with the worst loss run' },
    ],
  },
  exitSignal: {
    label: 'Exit by signal',
    what: 'Trades closed because the strategy produced an exit or reverse signal, filled at the next bar open.',
    reading: 'For a signal-driven strategy most exits should be here. Compare its net P/L with the other reasons.',
    profit: 'Shows how much profit the strategy logic earned, apart from the stops.',
    related: [
      { key: 'exitStopLoss', note: 'trades cut by the stop instead' },
      { key: 'exitTakeProfit', note: 'trades closed at the target instead' },
    ],
  },
  exitStopLoss: {
    label: 'Exit by stop loss',
    what: 'Trades closed because price hit the stop loss. Within one bar the stop is checked before the target.',
    reading: 'A high share means the stop is tight or the entries are poor. Net P/L here is normally negative.',
    profit: 'Stops cap the size of each loss but can cut trades that would have recovered.',
    related: [
      { key: 'exitTakeProfit', note: 'the stop and the target trade off against each other' },
      { key: 'worstTrade', note: 'the stop limits the worst loss' },
    ],
  },
  exitTakeProfit: {
    label: 'Exit by take profit',
    what: 'Trades closed because price reached the take profit target.',
    reading: 'A high share with a high win rate is typical for tight targets, which cap the size of every win.',
    profit: 'Locks in gains but can cut a big winner short.',
    related: [
      { key: 'exitStopLoss', note: 'the stop and the target trade off against each other' },
      { key: 'bestTrade', note: 'a target caps the best trade' },
    ],
  },
  exitEndOfData: {
    label: 'Exit at end of data',
    what: 'A position still open on the last bar, closed there so the run can be scored.',
    reading: 'It should be at most one trade. That trade ended because the data ran out, not by the strategy.',
    profit: 'Its result depends on where the data happened to stop, so do not read it as a signal.',
    related: [
      { key: 'currentStreak', note: 'the run the data ended on' },
      { key: 'exitSignal', note: 'a normal exit' },
    ],
  },
  exitShare: {
    label: 'Share',
    what: 'Percentage of all trades that ended for this reason.',
    reading: 'The shares add to 100 percent. A large stop-loss share means the stop is tight or entries are poor.',
    profit: 'Weigh it with the Net P/L of the same row to see which exits earn and which cost.',
    related: [
      { key: 'trades', note: 'the total the shares are taken from' },
      { key: 'winRate', note: 'compare with the win rate of the same row' },
    ],
  },
  legendStrategy: {
    label: 'Strategy line',
    what: 'The strategy equity curve, starting from the starting capital, with its final value in the legend.',
    reading: 'It is green when the run ended up and red when down. Smooth and rising is better than jagged.',
    profit: 'The gap between its final value and the starting capital is the net profit.',
    related: [
      { key: 'legendBuyHold', note: 'the benchmark line to stay above' },
      { key: 'finalEquity', note: 'the value this line ends on' },
    ],
  },
  legendBuyHold: {
    label: 'Buy & hold line',
    what: 'What the same capital would be worth by buying at the first close and holding, ignoring fees and slippage.',
    reading: 'A strategy line that stays below this one with the same drawdown added no value over holding.',
    profit: 'The gap to the strategy line is the profit gained or given up by trading.',
    related: [
      { key: 'buyHold', note: 'the same comparison as a percentage' },
      { key: 'legendStrategy', note: 'the line to compare it with' },
    ],
  },
  mcFinalReturn: {
    label: 'Final return (Monte Carlo)',
    what: 'The total return of each simulated run, which replays your trades shuffled or resampled. Each row is a percentile (nearest rank) of the runs.',
    reading: 'Wide spread means luck of order or draw matters. If the low percentiles are negative, the result was not guaranteed.',
    profit: 'With shuffling the total profit is the same every run; with resampling it varies, showing how fragile the profit is.',
    related: [
      { key: 'totalReturn', note: 'your actual run, shown on the This run row' },
      { key: 'mcChanceOfLoss', note: 'the share of runs below zero' },
    ],
  },
  mcMaxDrawdown: {
    label: 'Max drawdown, trade to trade (Monte Carlo)',
    what: 'The largest fall in each simulated run, measured on closed-trade equity only, not bar by bar. Rows are percentiles of the runs.',
    reading: 'Lower is better. Use the high percentiles to plan for a worse drawdown than the one your actual run had.',
    profit: 'It shows the pain that goes with the profit when the trade order changes.',
    related: [
      { key: 'maxDrawdown', note: 'bar by bar and usually deeper than trade to trade' },
      { key: 'longestLossStreak', note: 'bad orderings pile up losers' },
    ],
  },
  mcThisRun: {
    label: 'This run (Monte Carlo)',
    what: 'Your actual result and its percentile among the simulated runs, for both return and drawdown.',
    reading: 'A return percentile near 100 means your order was luckier than most; near 0 means unluckier. A drawdown percentile near 100 means a worse drawdown than most.',
    profit: 'A lucky ordering may have flattered the profit you saw.',
    related: [
      { key: 'mcFinalReturn', note: 'the spread of simulated returns' },
      { key: 'mcMaxDrawdown', note: 'the spread of simulated drawdowns' },
    ],
  },
  mcChanceOfLoss: {
    label: 'Chance of ending at a loss',
    what: 'Share of simulated runs whose final return is below zero.',
    reading: 'Lower is better. With a shuffle every run ends with the same profit, so the chance is either 0 or 100 percent, matching the sign of this run; resampling gives a fuller test.',
    profit: 'It estimates how likely the strategy is to lose money when trades come in another order or draw.',
    related: [
      { key: 'mcFinalReturn', note: 'the distribution this share is taken from' },
      { key: 'winRate', note: 'a low win rate with small edge raises the chance of loss' },
    ],
  },
};
