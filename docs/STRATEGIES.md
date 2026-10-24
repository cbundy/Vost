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

| ID | Name | Parameters (defaults) | Notes |
|---|---|---|---|
| `sma_cross` | SMA crossover | `fast=10`, `slow=30`, `direction` | Long while fast SMA > slow SMA |
| `ema_cross` | EMA crossover | `fast=12`, `slow=26`, `direction` | Same idea, EMA reacts sooner |
| `macd_cross` | MACD | `fast=12`, `slow=26`, `signal=9`, `direction` | Long while histogram > 0 |
| `rsi_reversion` | RSI mean reversion | `length=14`, `oversold=30`, `overbought=70`, `direction` | Enters long on the cross back up through oversold; exits above overbought |
| `bollinger` | Bollinger Bands | `length=20`, `mult=2`, `mode`, `direction` | `mode`: 0 = breakout (upper break in, middle cross out), 1 = mean reversion (lower touch in, middle cross out) |
| `donchian` | Donchian breakout | `entry=20`, `exit=10`, `direction` | Enters on a new N-bar high, exits on the opposite M-bar low |
| `buy_hold` | Buy & hold | — | Benchmark |
| `custom` | Custom (JavaScript) | your JSON params | See below |

`direction` is `1` = long only, `2` = short only, `3` = both. Short signals are ignored unless *Shorts* is enabled in the configuration.

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
- Position size = `positionSizePct` of current equity; one position at a time; re-entry after a stop requires the signal to leave that side first.
- Stops/takes are checked against bar highs/lows. If both could trigger within one bar, the **stop wins** (conservative). Gaps fill at the open.
- Equity is marked to market on every close; max drawdown is peak-to-trough of that curve.
- Sharpe/Sortino are annualised from per-bar returns using the median bar interval of the dataset — comparable across timeframes, approximate across markets (crypto trades 365 days, stocks ~252).
