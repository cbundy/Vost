# Writing strategies in Vost

Every strategy — built-in or custom — is a function that turns candles into a **per-bar target exposure**:

```
  1   → be long at that bar's close (the engine fills at the next bar's open)
  0   → be flat
 -1   → be short (only executes when "Shorts: Enabled" in the backtest config)
 null → not enough data yet (warm-up)
```

The engine then applies fees, slippage, position sizing, stops/takes and the single-position rule. A strategy never sees the future: the signal at bar `i` is executed at the **open of bar `i + 1`**.

## Built-in strategies

| ID | Name | Style | Parameters (defaults) | Notes |
|---|---|---|---|---|
| `sma_cross` | SMA crossover | trend | `fast=10`, `slow=30`, `direction` | Long while fast SMA > slow SMA |
| `ema_cross` | EMA crossover | trend | `fast=12`, `slow=26`, `direction` | Same idea, EMA reacts sooner |
| `macd_cross` | MACD | trend | `fast=12`, `slow=26`, `signal=9`, `direction` | Long while histogram > 0 |
| `rsi_reversion` | RSI mean reversion | mean reversion | `length=14`, `oversold=30`, `overbought=70`, `direction` | Enters long on the cross back up through oversold; exits above overbought |
| `bollinger` | Bollinger Bands | breakout, mean reversion | `length=20`, `mult=2`, `mode`, `direction` | `mode`: 0 = breakout (upper break in, middle cross out), 1 = mean reversion (lower touch in, middle cross out) |
| `donchian` | Donchian breakout | breakout | `entry=20`, `exit=10`, `direction` | Enters on a new N-bar high, exits on the opposite M-bar low |
| `pullback` | Pullback in trend | continuation, trend | `trend=200`, `length=14`, `dip=40`, `target=70`, `direction` | Long when the close is above the trend EMA and RSI crosses back up through `dip`; exits above `target` or when the close falls under the EMA (mirrored for shorts) |
| `reversal` | Reversal | reversal | `length=20`, `mult=2`, `direction` | Long when the close comes back inside the lower Bollinger band after closing below it; exits above the middle band (mirrored for shorts) |
| `momentum_breakout` | Momentum breakout | momentum, breakout | `entry=20`, `exit=10`, `volLen=20`, `volMult=1.5`, `direction` | Donchian breakout that also needs the bar's volume to be at least `volMult` times the average of the `volLen` bars before it |
| `composed` | Composed (entry + filters) | trend | `entryRule=2`, `direction`, the entry rule's settings, and four filters (all off) | One entry rule plus optional filters that veto entries; see [Composed strategy](#composed-strategy) |
| `buy_hold` | Buy & hold | - | - | Benchmark |
| `custom` | Custom (JavaScript) | - | your JSON params | See below |

The style of each strategy is kept in one table (`STRATEGY_STYLES` in `client/src/lib/backtest/strategies.ts`), primary style first.

`direction` is `1` = long only, `2` = short only, `3` = both. Short signals are ignored unless *Shorts* is enabled in the configuration.

## Composed strategy

`composed` takes the entries from one of the other strategies and lets up to four filters veto them. Pick the **entry rule** (`entryRule`: 1 SMA crossover, 2 EMA crossover, 3 MACD, 4 RSI mean reversion, 5 Bollinger Bands, 6 Donchian breakout) and its settings (`fast`, `slow`, `signal`, `length`, `oversold`, `overbought`, `mult`, `mode`, `entry`, `exit`; only the chosen rule's settings show). The entry rule is run as that strategy with the same settings, so with every filter off `composed` equals it.

**Entries.** A fresh entry is a bar where the rule's exposure turns long (the bar before was not long) or short (not short). It is taken only if every enabled filter agrees on that same bar. A blocked signal stays flat until the next fresh signal: `composed` never joins part-way through a run. An open position exits when the rule's exposure leaves its side (the rule's own exit; stop loss and take profit apply as usual). A direct flip closes the position and the opposite signal is a new entry that must pass the filters.

**Filters** (each read only on the entry bar, no look-ahead; the trend and volatility filters can read a higher timeframe, see below):

| Filter | Settings | Passes when |
|---|---|---|
| Trend (`trendFilter`: 0 off, 1 SMA, 2 EMA) | `trendLen`, `trendTf` | Long: close > average. Short: close < average |
| Volume (`volumeFilter`: 0/1) | `volumeLen`, `volumeMult` | Bar volume >= `volumeMult` x its `volumeLen`-bar average (including the bar); an average of 0 blocks |
| Volatility (`atrFilter`: 0/1) | `atrLen`, `atrMinPct`, `atrMaxPct`, `atrTf` | ATR / close x 100 within the band, edges included |
| Trend strength (`adxFilter`: 0/1) | `adxLen`, `adxMin` | ADX >= `adxMin` |

**Higher timeframe.** `trendTf` and `atrTf` (1 same as the chart, or 2, 3, 4, 6, 8, 12, 24 times the chart's bar length; default 1) build longer bars from the loaded bars and read the trend average, the close and the ATR on them. A longer bar counts only once it has closed by the current bar's close, decided by the clock and never by looking at the next bar: the bar's bucket is closed when the next bar's start would fall in a later bucket. Until then the filter reads the previous closed longer bar, so its value changes only on the bar that closes a bucket. A bucket that ends early (a session close, a data gap) shows up on the first bar of the next bucket, late and never early. Buckets are cut on UTC time, so for stocks a 24x bucket is a UTC day, not the exchange session. A partial first bucket is dropped, and the filter is warming up until there is a closed longer bar and enough of them. Example: on 1-hour bars with the trend on 4x, the 4-hour value changes on the 03:00 bar, which closes the 00:00-04:00 bucket, and again on 07:00. If the multiple is not a valid timeframe, or the bars are a week or longer, the filter runs on the loaded bars, as with 1.

**Warm-up.** The signal is null until the entry rule and every enabled filter have values.

**Blocked counts.** The Results tab shows one line, for example `Filters: 40 entry signals, 22 taken - trend blocked 12, volume blocked 9`. It lists the enabled filters only. A signal vetoed by two filters counts once for each, so `signals - taken` is the number blocked by at least one. The strategy maker can search `composed` too; it has no Pine export.

## Custom (JavaScript) strategies

In the **Backtest** tab choose the *Custom (JavaScript)* strategy. Your code is compiled and executed **inside the Web Worker** with this signature:

```js
(candles, params, indicators) => Signal[]
```

- `candles` — array of `{ time, open, high, low, close, volume }`, `time` in UNIX seconds
- `params` — flat object of numbers you edit as JSON in the panel
- `indicators` — helper bag:

| Helper | Returns |
|---|---|
| `indicators.sma(values?, period)` | Series (`Array<number \| null>`) |
| `indicators.ema(values?, period)` | Series |
| `indicators.rsi(period)` | Series (0–100) |
| `indicators.macd(fast, slow, signal)` | `{ macd, signal, histogram }` (Series each) |
| `indicators.bollinger(period, mult)` | `{ upper, middle, lower }` |
| `indicators.atr(period)` | Series |
| `indicators.adx(period)` | Series (0-100, Wilder; null until bar `2 x period - 1`) |
| `indicators.volumeSma(period)` | Series (average bar volume) |
| `indicators.vwap()` | Series (daily reset on intraday bars, rolling otherwise) |
| `indicators.highest(values, period)` / `lowest(values, period)` | Series (rolling extremes, inclusive of current bar) |
| `indicators.stdev(values, period)` | Series |
| `indicators.crossover(a, b, i)` / `crossunder(a, b, i)` | boolean |

`values` defaults to closes when omitted. All series are aligned with `candles` (`null` = warm-up).

### Example: SMA crossover with a trend filter

```js
const fast  = indicators.sma(undefined, params.fast  || 10);
const slow  = indicators.sma(undefined, params.slow  || 30);
const trend = indicators.ema(undefined, params.trend || 200);

const signals = new Array(candles.length).fill(null);
for (let i = 0; i < candles.length; i++) {
  if (fast[i] == null || slow[i] == null || trend[i] == null) continue;
  signals[i] = (fast[i] > slow[i] && candles[i].close > trend[i]) ? 1 : 0;
}
return signals;
```

### Example: RSI with a volatility filter and state machine

```js
const r  = indicators.rsi(params.length || 14);
const at = indicators.atr(14);

const signals = new Array(candles.length).fill(null);
let pos = 0;
for (let i = 0; i < candles.length; i++) {
  if (r[i] == null || at[i] == null) continue;
  const calm = at[i] / candles[i].close < 0.03;
  if (pos === 0 && r[i] < 30 && calm) pos = 1;
  else if (pos === 1 && r[i] > 60) pos = 0;
  signals[i] = pos;
}
return signals;
```

### Example: ATR-normalised breakout with volatility-scaled exits

```js
const hh = indicators.highest(candles.map(c => c.high), params.period || 20);
const at = indicators.atr(params.atrLen || 14);
const signals = new Array(candles.length).fill(null);
let pos = 0, entryAtr = 0;
for (let i = 1; i < candles.length; i++) {
  if (hh[i - 1] == null || at[i] == null) continue;
  const vol = at[i] / candles[i].close;
  if (pos === 0 && candles[i].close > hh[i - 1] && vol > 0.005) {
    pos = 1; entryAtr = at[i];
  } else if (pos === 1 && candles[i].close < candles[i].close - 2 * entryAtr) {
    pos = 0;
  }
  signals[i] = pos;
}
return signals;
```

### Tips & gotchas

- **Warm-up**: return `null` until your indicators exist, otherwise you'll trade on `null` values.
- **Keep the state machine explicit**: emit the *current desired position* each bar (not just "enter" events). `0` inside a loop means "I want to be flat on that bar".
- Stops/takes are engine features (Backtest panel) — no need to encode them in signals, though ATR-style exits in code are fine too.
- The optimizer sweeps numeric params only, so expose everything you want tuned in `params`.
- Errors in your code surface as a toast and/or a failed-combination count in the optimizer; `return` an array of the same length as `candles` or a friendly error is thrown.
- Custom code runs in the worker with a hard requirement: **no DOM, no network**. `fetch`/`document` are not available — compute from `candles` only.

## Pine Script strategies

Pick **Pine Script** in the Backtest panel to backtest a Pine v6 `strategy()` script (runtime and supported subset: [PINE.md](PINE.md)). The script runs in the worker and its trades come from Pine's own order emulation, not from the signal engine; they are converted to the usual trades, a per-bar mark-to-market equity curve and the usual metrics.

- `input.int` / `input.float` / `input.bool` declarations show as parameters (defaults, min/max/step from the script). Numeric ones can be swept in the Optimizer.
- **Settings precedence**: `initial_capital` and `commission_*` given in `strategy()` win over the panel's Initial capital and Fee fields; when the script omits them the panel values are used. Pine's default capital (1,000,000) and zero commission count as "not given". The values used are shown below the panel after a run.
- Position size, slippage, shorts and stop loss / take profit are not applied: set them in the script (`default_qty_*`, `strategy.exit`, ...).
- A trade still open at the last bar is closed at the last close (`end_of_data`). An `indicator()` script is rejected; a syntax error shows the runtime message with its line.

## How results are computed

- Fills at the **next bar's open**, with slippage applied *against* you (`buy = open × (1 + slip)`, `sell = open × (1 − slip)`).
- Fees (`feeBps` per side) charged on entry and exit notional.
- Position size = `positionSizePct` of current equity, or with `riskPct` set (and a stop on) `equity x riskPct / stop distance` (the trade's own initial stop distance as a fraction of its entry price: the tighter of the fixed stop and the trailing stop's starting level, whether set in percent or ATR), uncapped, so that hitting the stop loses `riskPct` of equity; one position at a time; re-entry after a stop requires the signal to leave that side first.
- Stops/takes are checked against bar highs/lows. If both could trigger within one bar, the **stop wins** (conservative). Gaps fill at the open.
- Exit modes: the stop is a percent (`stopLossPct`) or `stopAtrMult` x ATR (`stopMode: 'atr'`); the take profit is a percent, `takeProfitAtrMult` x ATR, or `takeProfitR` x the initial stop distance (`takeProfitMode: 'atr' | 'r'`; off when there is no stop); the trailing stop (`trailMode: 'pct' | 'atr'`) keeps a distance fixed at entry behind the best price since entry and never moves back. Levels are fixed per trade from the entry fill price. The ATR (`atrLength`, default 14, Wilder) is read on the signal bar, on the loaded bars or, with `atrTimeframe` (1, 2, 3, 4, 6, 8, 12 or 24 times the loaded bar length; default 1; anything else reads as 1), on longer bars built from them, where only the newest longer bar closed by the signal bar's close counts (the closed rule in [Higher timeframe](#composed-strategy); the loaded bars are used when the multiple is not a valid timeframe or the bars are a week or longer); while it is unknown a trade that needs it does not open, and it opens on the first later bar whose signal still asks for that side. The stop in force is the tighter of the fixed stop and the trail, and a bar checks the levels set by earlier bars before its own high or low moves the trail. An exit at the trail is `trailing_stop`, at the fixed stop `stop_loss`.
- Equity is marked to market on every close; max drawdown is peak-to-trough of that curve.
- Sharpe/Sortino are annualised from per-bar returns using the median bar interval of the dataset — comparable across timeframes, approximate across markets (crypto trades 365 days, stocks ~252).

## Strategy maker (research)

A study of a small, local, trainable (non-LLM) tool that would recommend indicators and settings from entries and exits the user highlights is in [spikes/strategy-maker/README.md](spikes/strategy-maker/README.md). The first part is built: the optional `/strategy-maker` page, which loads candles on a chart of its own and is kept apart from the rest of the app (see [the guide page](guide/strategy-maker.md)). The Find form carries the Backtest tab's exits (stop loss and take profit in percent or ATR, a target as a multiple of the stop, and a trailing stop): the search, Open in Backtest, Copy settings and Copy as Pine all use them, and the Pine script computes Vost's ATR itself and moves the trailing stop as a plain stop at each bar close. The recommending itself is not built yet.

A second study, [spikes/strategy-search/README.md](spikes/strategy-search/README.md), swept the six built-in families over the top crypto, stocks and indices on every timeframe for strategies that hit 75% at R:R 1 or 50% at R:R 4, and checked what survives on unseen data and against shuffled-return copies.

The market search is built (`client/src/strategyMaker/sweep/`, with a "Search markets" panel on the strategy maker page: see [Searching many markets](guide/strategy-maker.md#searching-many-markets)). Given markets, timeframes, up to four target sets (a strategy passes when it meets any one) and a risk per trade, it tries every signal setting with a grid of stops (the typical bar range times 1, 2 or 4) and take profits (1 to 5 times the stop) on the first 70% of each series, sized by `riskPct` like any backtest. A strategy that meets a set with at least 30 trades is checked on the last 30%, and is "held" when that part meets the same set with at least 10 trades. It ranks held strategies first, gives the closest miss per series, and lists markets that failed to load or were too short. The worker loads the candles itself, at most 3 at a time, and a run above `MAX_SWEEP_COMBOS` combinations is refused before anything loads.
