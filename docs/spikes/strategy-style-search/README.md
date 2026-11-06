# Strategy style search (research spike, issue #431)

Question: on a fixed list of markets, does any strategy of the strategy maker beat buy and hold on data it was not chosen
on, more often than shuffled copies of the same markets do? 1m to 30m bars first; only if nothing held, 1h and 4h once,
then stop. It follows the [earlier strategy search](../strategy-search/README.md) (issue #409), which asked for hit-rate
targets instead. Nothing in `client/`, `server/`, `shared/`, `e2e/`, `scripts/` or `package.json` changed.

## Short answer

- **Nothing holds.** In none of the 16 timeframe and market-group cells (1m, 5m, 15m, 30m, then 1h and 4h) did real
  series have a held strategy more often than shuffled copies beyond the significance rule below. The nearest was
  15m crypto: 19 of 33 real series against 12 of 33 shuffled, p 0.069 (not below 0.05), and the shuffled copies
  produced more held strategies (2,038) than the real series (1,740).
- Stage 1 (1m to 30m) found nothing, so stage 2 (1h and 4h) ran, and found nothing either. The run stops here.
- "Held" is cheap to reach by chance: at 4h, 22 of 32 real crypto series and 23 of 32 shuffled ones have at least one
  held strategy. Each series tries 65,784 combinations, so a few lucky ones always pass.
- Where signals did fire often on held strategies (1m stocks, 55 a day) there are 26 real against 5 shuffled held
  strategies, but only in 2 series each way (p 0.69); that is not a pattern.

## Rules (as run)

- **Markets**: the fixed universe of [`../strategy-search/universe.json`](../strategy-search/universe.json), dated
  2026-11-05, read from that file (not refetched): crypto = cap and volume lists (each market once, 33), stocks = cap and
  volume lists (55), indices (10). These are the winners of that date, so the list has survivorship bias.
- **Series**: one market on one timeframe. Stage 1: 1m, 5m, 15m, 30m (392 series). Stage 2: 1h and 4h (131 series; Yahoo
  has no 4h, so 4h is crypto only). Stage 2 runs only when stage 1 has no found cell (the probe decides, `--report`
  states it). Stage 1 had none, so stage 2 ran. There is no further stage.
- **Strategies per series**: every signal family except Composed on its `DEFAULT_SPACE` grid (`candidatesOf`), plus
  Composed from `composedSettings` (entry rules 1 to 6, trend and ADX filters, trend multiples 4 and 12, 1 always), long
  only and short only, 2,741 settings x 2 directions x 12 exits (range, ATR, trailing ATR; stop multiples 1 and 2; take
  profit multiples 1.5 and 3) = **65,784 tries per series**, the same for a shuffled copy. $1000, 2% risk, 10 bps fee,
  5 bps slippage (`sweepConfig`).
- **Split**: first 70% searched, last 30% unseen, signals built fresh on each part, as the market search does.
- **Selected**: on the searched part at least 30 trades and return above that part's buy and hold. **Held**: selected,
  and on the unseen part at least 30 trades and return above that part's buy and hold.
- **Shuffled copy**: `shuffledCopy(candles, seedOf("<provider>|<symbol>|<timeframe>"))`, searched with the identical grid
  and rule.
- **Found** (this spike's reading of "beyond the shuffled-copy rate"): in a timeframe and group with n series, r real
  series with at least one held strategy and s shuffled ones; found means r > s and a one-sided Fisher exact test of
  (r of n against s of n) gives p < 0.05.

### Changes to the grid and data, for run time and what the sources serve

- **Bars per series are capped at the latest 4,000** (`--max-bars`), not 20,000. At 20,000 bars one series takes about
  8 CPU minutes (real and shuffled), 392 of them about 50 CPU hours; at 4,000 it takes 1 to 3 minutes. The grid itself is
  unchanged (65,784 tries). So Binance series cover about 2.8 days of 1m, 14 days of 5m, 42 days of 15m, 83 days of 30m,
  167 days of 1h and 667 days of 4h bars.
- **Yahoo serves little intraday history** (probe asks 7 days of 1m, 1 month of 5m, 15m and 30m, 2 years of 1h): about
  2,600 1m bars, 600 to 800 15m bars and about 300 30m bars. Series too short to reach 30 trades on a part are counted
  as "Too short" per cell: 17 of 55 stocks and 3 of 10 indices at 15m, and all stocks and indices at 30m.
  Those cells say nothing.

## How to rerun

```
npm ci
npx vite-node docs/spikes/strategy-style-search/probe.ts --self-check     # offline, seeded data
npx vite-node docs/spikes/strategy-style-search/probe.ts --list [--stage lower|widen]
npx vite-node docs/spikes/strategy-style-search/probe.ts --stage lower --slice 0 --budget 420   # network on first run
npx vite-node docs/spikes/strategy-style-search/probe.ts --report         # results.csv and output.txt
```

Flags are listed at the top of `probe.ts` (`--workers W --worker w` shares a stage between W processes, `--group`,
`--timeframe`, `--per-slice`, `--budget`, `--cache`, `--max-bars`). Candles and raw results live in a cache outside the
repo (default `vost-strategy-style-search` in the OS temp folder) and resume where they stopped. The run took 392 + 131
series on 12 processes, about 2 hours. Yahoo data changes daily, so a rerun gives different numbers for stocks and
indices; the Binance candles are the latest 4,000 bars at the time of the run.

`--self-check` proves, offline and the same on every run: a planted long edge is selected and held on both parts with 30
or more trades; a random walk gives no found cell; the probe's figures equal `runSweep`'s for the same setting and exit
(24 candidates, including Composed); the shuffled copy is the app's `shuffledCopy` with the stated seed; the Fisher test
matches known values (5 of 10 against 0 of 10: 0.016; 1 of 10 against 0: 0.5); stage 2 runs only when stage 1 is
complete and has no found cell.

## Findings (quoted from [`output.txt`](output.txt))

```
| Timeframe | Group | Markets | Too short | Searched | Real series held | Shuffled series held | p | Found | Held strategies real / shuffled | Median signals per day (held) |
| 1m  | crypto  | 33 | 0  | 33 | 0  | 0  | 1.000 | no | 0 / 0        | n/a   |
| 1m  | stocks  | 55 | 0  | 55 | 2  | 2  | 0.691 | no | 26 / 5       | 55.67 |
| 1m  | indices | 10 | 0  | 10 | 0  | 0  | 1.000 | no | 0 / 0        | n/a   |
| 5m  | crypto  | 33 | 0  | 33 | 1  | 3  | 0.943 | no | 4 / 28       | 7.68  |
| 5m  | stocks  | 55 | 0  | 55 | 9  | 12 | 0.834 | no | 1090 / 1146  | 17.29 |
| 5m  | indices | 10 | 0  | 10 | 0  | 0  | 1.000 | no | 0 / 0        | n/a   |
| 15m | crypto  | 33 | 0  | 33 | 19 | 12 | 0.069 | no | 1740 / 2038  | 2.56  |
| 15m | stocks  | 55 | 17 | 38 | 0  | 0  | 1.000 | no | 0 / 0        | n/a   |
| 15m | indices | 10 | 3  | 7  | 0  | 0  | 1.000 | no | 0 / 0        | n/a   |
| 30m | crypto  | 33 | 0  | 33 | 2  | 4  | 0.902 | no | 14 / 26      | 2.32  |
| 30m | stocks  | 55 | 55 | 0  | -  | -  | -     | -  | too short    | n/a   |
| 30m | indices | 10 | 10 | 0  | -  | -  | -     | -  | too short    | n/a   |
Stage 1 found nothing, so stage 2 (1h and 4h) is run.
| 1h  | crypto  | 33 | 0  | 33 | 13 | 10 | 0.303 | no | 1340 / 2061  | 0.70  |
| 1h  | stocks  | 55 | 0  | 55 | 12 | 14 | 0.749 | no | 7840 / 1345  | 0.80  |
| 1h  | indices | 10 | 0  | 10 | 0  | 1  | 1.000 | no | 0 / 2        | n/a   |
| 4h  | crypto  | 33 | 1  | 32 | 22 | 23 | 0.708 | no | 48057 / 95917| 0.18  |
Stage 2 found nothing. The run stops here.
```

Each held strategy with its markets, settings in words, exit and both parts' figures is a row of
[`results.csv`](results.csv) (the best 40 per series by unseen return over buy and hold; 1,961 rows, 58,150 more held
strategies are only counted in the tables). `output.txt` also has the share of tries that held per cell (at most 4.6%,
at 4h on shuffled crypto) and every column of the tables.

Two cells hold something that looks like an effect and is not: 1h stocks has 7,840 held strategies real against 1,345
shuffled, yet 12 real series against 14 shuffled, so a few series with a rising trend hold many near-identical variants;
and 15m crypto has 19 against 12 series, p 0.069, which at 16 cells looked at is what chance gives.

## Caveats

- **Multiple testing**: 16 cells are tested at p < 0.05, so about one false "found" would be expected; none appeared.
- **Survivorship**: the markets are the winners of 2026-11-05.
- **Short samples**: 4,000 bars, a few days to months; Yahoo's intraday history is much shorter, so stocks and indices at
  15m and 30m are mostly too short. 30 trades on a part is a low bar, and a held strategy beating buy and hold in a
  falling window is common (a short strategy beats it by not losing).
- A "nothing holds" result is for this grid (long and short, 12 exits, the strategy maker's families, fees and
  slippage at the app's defaults); it does not rule out other styles.
- The earlier [strategy search](../strategy-search/README.md) reached the same conclusion for hit-rate targets on 1m to 30m.
