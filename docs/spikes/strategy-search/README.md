# Strategy search (research spike, issue #409)

Question: across the top crypto, stocks and indices, on every timeframe, do built-in strategies exist that hit
**75% at R:R 1 or more**, or **50% at R:R 4 or more**, risking 2% of a $1000 account per trade, and do they still hold
on data they were not chosen on? It follows the [strategy maker spike](../strategy-maker/README.md) (issue #284), which
showed the search itself is cheap; this run asks whether it finds anything real. Nothing in `client/`, `server/`,
`shared/` or `package.json` changed.

## Short answer

- **Almost nothing survives, and what does is what chance produces.** Of 817 distinct market-timeframe series and
  24.2 million combinations tried, 1,129 met a target on the first 70% of bars, and 237 of those also met it on the
  last 30%. Those 237 sit in only **7 series** (0.9%). The same sweep on 652 shuffled-return copies (no pattern left)
  gave 5 series with a surviving result (0.8%), and on the very same 652 markets the real data gave 5 as well.
- **75% at R:R 1 (target A)**: 6 results held, all weekly S&P 500 and Nasdaq 100, each on 12 to 13 test trades. 0 of
  652 shuffled series produced one, so this is the only hint of a real effect, but 13 trades cannot tell 75% from
  chance, and it is two indices on one timeframe. No crypto market, no stock, no intraday timeframe held target A.
- **50% at R:R 4 (target B)**: 231 results held, 221 of them one stock (NVDA, weekly, a 1,451-bar run in which the price
  rose by orders of magnitude; long only trend following cannot lose much there). Without NVDA: 16 results (6 target A, 10 target B) in 6 series.
  Shuffled copies produced 21 held results, so target B is easy to hit by chance on weekly bars.
- **Crypto: nothing held** in 297 distinct series (4 met target A, 104 met B on the selection part).
- **Intraday (1m to 30m): nothing even met a target** on the selection part; 1h met 9 times, none held.
- **Leverage was not the problem.** The position the 2% risk needs was at most 0.94x equity for any result that met a
  target (median 0.09x), because only wide stops (daily, weekly) ever met one.
- **Recommendation**: do not build the search as a "find me a 75% strategy" promise. Build it as an honest explorer with
  the hold-out and a shuffled-copy baseline in the result, so the user sees what chance alone gives. Details at the end.

## How to rerun

```
node docs/spikes/strategy-search/probe.ts --self-check            # offline, seconds
node docs/spikes/strategy-search/probe.ts --list                  # slices per group
node docs/spikes/strategy-search/probe.ts --group crypto-cap --slice 0 [--cache <dir>]
node docs/spikes/strategy-search/probe.ts --report [--cache <dir>] # writes results.csv and output.txt
```

Groups: `crypto-cap`, `crypto-volume`, `stocks-cap`, `stocks-volume`, `indices`, `baseline`. A slice is up to 20
series (`--per-slice`); a slice takes 1 to 5 minutes (12 slices at once on a 12-core machine; the heaviest are
crypto, where a series is up to 20,000 bars), stops cleanly after `--budget` seconds (default 420) and carries on when
run again. Candles and raw results live in `--cache` (default `vost-strategy-search` in the OS temp folder) and are
never committed; fetching is the only slow part, and a second run reads the cache. The whole run was 86 slices.
`--build-universe` rewrites `universe.json` from the live sources. The script uses the app's real modules
(`buildSignals`, `defaultBacktestConfig`) through the same resolve hook as the earlier spike; no dependency was added.

Files: [probe.ts](probe.ts), [universe.json](universe.json), [results.csv](results.csv) (one row per market,
timeframe, strategy and settings that met a target on the selection part, with its hold-out figures; the stock and
crypto lists overlap, so a few markets appear under both groups), [output.txt](output.txt) (the summary quoted here).

`--self-check` (offline, about 6 seconds, exits 0, identical between runs except `[perf]` lines) proves:
the copied grids equal `search.ts`; the sizing example (two losses from $1000 at 2% give $980.00 then $960.40);
that the fast simulator equals the app's `runBacktest` trade by trade (entry bar, exit bar and result) on 40
strategy/exit settings; that a hidden SMA 8/22 long strategy planted in a seeded synthetic series is found and holds
(8 exits met on the selection part, 6 held); that a plain random walk yields no held result; and that the
shuffle is seeded.

## What was run

**Universe** (dated 2026-11-05, source of each in `universe.json`):

| List | Source | Size |
|---|---|---|
| Crypto by market cap | CoinGecko `coins/markets`, mapped to Binance USDT pairs | top 30 after exclusions; 23 tradable, 7 skipped (no Binance pair, for example XMR, LEO, CRO) |
| Crypto by 24h volume | Binance `ticker/24hr`, USDT pairs by quote volume | 30 |
| Stocks by market cap | companiesmarketcap.com, largest US companies | 30 |
| Stocks by volume | Yahoo screener `most_actives`, ranked by 3-month average volume | 30 |
| Indices | fixed list: ^GSPC ^NDX ^DJI ^RUT ^FTSE ^GDAXI ^FCHI ^N225 ^HSI ^STOXX50E, via Yahoo | 10 |

Stablecoins, wrapped, staked and pegged tokens, and Binance's tokenized stocks are excluded and listed in
`universe.json`. The issue asks for stocks "by market cap and volume"; this read it as both rankings applied, giving two
lists of 30 (they share 5 names; the two crypto lists share 20). The volume list is the weak one: Yahoo's screener only lists the day's most active
names, so it carries meme and low-price names (and `SPCX`, a very recent listing with little history).

**Timeframes**: every native one, each with up to the latest 20,000 bars: Binance 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M
(median bars over all distinct series: 1m 2,482, 4h 13,281, 1d 4,339, 1w 901, 1M 208); Yahoo 1m, 5m, 15m, 30m, 1h, 1d, 1w, 1M
(no 4h). Yahoo serves only 7 days of 1m and about a month of 5m to 30m (the app has the same limits), so those series
are short. A series where no combination reached 30 selection-part trades is reported as **too short**: 226 of 817
distinct series (30m 65 of 98, 1M 86 of 98, 1w 45 of 98, 15m 19, 1d 9, 1m 1, 4h 1). Binance 1m gave the full 20,000 bars (about 14 days); Yahoo 1m gave about 2,480.

**Strategies**: the six built-in families over the strategy maker's `DEFAULT_SPACE` grids (the same ranges and the same
validity rule, a fast average faster than the slow one), long only and short only:

| Family | Grid | Sets |
|---|---|---|
| `sma_cross`, `ema_cross` | fast 2 to 30 step 2, slow 10 to 80 step 4 | 234 each |
| `macd_cross` | fast 4 to 20 step 2, slow 16 to 40 step 4, signal 5 to 13 step 4 | 177 |
| `rsi_reversion` | length 5 to 30 step 5, oversold 20 to 40 step 5, overbought 60 to 80 step 5 | 150 |
| `bollinger` | length 10 to 50 step 10, mult 1.5 to 2.5 step 0.5, mode 0 to 1 | 30 |
| `donchian` | entry 10 to 60 step 5, exit 5 to 30 step 5 | 66 |

That is 891 settings times 2 directions = **1,782 signal sets**. Each is combined with **18 exits**: a stop of 1, 2 or
4 times the series' typical bar range (the median of (high - low) / close on the selection part) and a take profit
of 1, 1.5, 2, 3, 4 or 5 times the stop. So **32,076 combinations per series**; 24.2 million were actually tried on the
817 distinct series (the rest were too short to try).

**Sizing and fills**: $1000 start, 2% of current equity risked at the stop, compounding (a trade's result as a
fraction of its entry price, divided by the stop distance, times 2% of equity). Fees 10 bps and slippage 5 bps per
side, the app's defaults. Exits, fills, the stop-first rule inside a bar, gap-through fills and the "signal must leave
the side before re-entering" rule are the app engine's (checked trade by trade). "Size needed" is the 2% risk divided
by the stop distance, as a multiple of equity (the app's backtester caps a position at 1x).

**Metrics**: hit rate = winning trades over all trades (a zero result is a loss); R:R = average win over average loss
(as `engine/backtest.ts`; no loss at all gives no R:R and does not count as meeting a target); final equity; max
drawdown of the closed-trade equity; trades. **Target A**: hit >= 75% and R:R >= 1. **Target B**: hit >= 50% and
R:R >= 4. **Met**: the target on the first 70% of bars with at least 30 trades. **Held**: the same target on the last
30% with at least 10 trades (fresh warm-up on that part, like the strategy maker).

**Chance baseline**: 78 markets sampled with a fixed seed from the lists (28 crypto, 40 stocks, 10 indices), 652
series over every timeframe. Each series is its own bars with the order of the bar-to-bar moves shuffled
(seeded), which keeps the spread of moves and removes any pattern in time. The identical sweep runs on them.

## Findings (quoted from [output.txt](output.txt))

By timeframe, distinct series (met/held are counts of combinations):

| Timeframe | Series | Too short | Met A | Met B | Held A | Held B |
|---|---|---|---|---|---|---|
| 1m, 5m | 98 each | 1, 0 | 0 | 0 | 0 | 0 |
| 15m, 30m | 98 each | 19, 65 | 0 | 0 | 0 | 0 |
| 1h | 98 | 0 | 9 | 0 | 0 | 0 |
| 4h | 33 | 1 | 0 | 0 | 0 | 0 |
| 1d | 98 | 9 | 32 | 207 | 0 | 1 |
| 1w | 98 | 45 | 85 | 796 | 6 | 230 |
| 1M | 98 | 86 | 0 | 0 | 0 | 0 |

By kind: crypto 297 series, met 4 A / 104 B, held 0; stocks 440 series, met 91 / 748, held 0 A / 228 B in 5 series;
indices 80 series, met 31 / 151, held 6 A / 3 B in 2 series.

By family (met, held): `macd_cross` long 506, 205; `sma_cross` long 328, 24; `ema_cross` long 143, 7; `donchian`
long 63, 1; `rsi_reversion` long 51, 0; `bollinger` long 35, 0. Short only: 3 met, 0 held. Mean reversion
(RSI, Bollinger) never survived; the survivors are trend followers on weekly bars.

The 7 series with any held result: ^GSPC 1w, ^NDX 1w, AAPL 1w, MSFT 1w, MU 1w, NVDA 1w and NFLX 1d. Held results
had a median of 13 trades on the last 30% (max 34).

Chance baseline (652 series):

| | Series | Met A | Met B | Held A | Held B | Series with a held result |
|---|---|---|---|---|---|---|
| Shuffled copies | 652 | 71 | 506 | 0 | 21 | 5 (0.8%) |
| Real, same 652 series | 652 | 94 | 879 | 6 | 226 | 5 (0.8%) |
| Real, all 817 distinct | 817 | 126 | 1,003 | 6 | 231 | 7 (0.9%) |

Reading it: chance alone gives about 0.9 met results per series (shuffled) against 1.5 for the real same series. That
is a small excess on the selection part, but the held rate per series matches (0.8% both), and the held counts are
dominated by one stock, so the surplus does not hold up as a finding. Target A is the exception worth a second look
(6 against 0), with a sample too thin to trust.

**Leverage**: 237 held results needed a median of 0.06x equity and at most 0.67x; all 1,129 met results a median of
0.09x and at most 0.94x. None exceeded 1x, so the app's 100% cap would not have bound. This is because the wide
stops the weekly and daily results used make the 2% risk a small position; intraday stops are tight, would need
several times equity, and never reached a target anyway.

## Caveats

- Held means 10 to 34 trades on the last 30%. A hit rate of 75% on 13 trades is within what a 50% coin gives about
  1 time in 20 per try, and 32,076 tries were made per series.
- The two lists overlap, so group rows add up to more than the distinct totals; everything from the timeframe table down
  counts a market and timeframe once.
- Stocks are today's winners (survivorship): NVDA, AAPL and MSFT were chosen because they went up, which flatters long
  trend following. Crypto lists are today's too.
- Yahoo gives little intraday history, so the intraday verdict is about the last week or month only.
- The volume lists come from one day (Binance 24h, Yahoo most actives).

## Recommendation for the app feature

1. **Worth building only as an explorer, not a promise.** The search finds many settings that look good on the data it
   is shown (1,129 here) and nearly none that survive; the ones that do are indistinguishable from the chance rate.
2. **Put the hold-out and the chance baseline in the product.** Show held versus met, the trades behind each figure,
   and how many settings were tried; the strategy maker already splits 70/30, and a shuffled-copy run (a few seconds
   a series) tells the user how many "hits" to expect from nothing.
3. **Families and timeframes to offer first**: `macd_cross`, `sma_cross` and `ema_cross` long on daily and weekly bars
   (the only ones that ever held); keep `rsi_reversion` and `bollinger` as options but expect nothing from them, and
   do not offer 1m to 30m or monthly bars for this search (too short or nothing met).
4. **Risk sizing** is not urgent for this feature: no result needed more than 0.94x equity. Add it when intraday
   strategies are in scope.
5. **Market lists**: use Binance `ticker/24hr` for crypto by volume (stable, no key) and CoinGecko `coins/markets` for
   crypto by market cap (no key; maps to Binance by symbol, 7 of 30 had no pair). For stocks there is no source in the
   repo; a fixed list the user can edit is more honest than Yahoo's one-day "most actives".
