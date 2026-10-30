# Strategy maker (research spike, issue #284)

Question: can Vost offer a small, local, trainable, non-LLM "strategy maker"? The user highlights entries and exits
on charts (or marks Long/Short positions) and sets targets (R:R, hit rate, max drawdown); the tool recommends
indicators and settings that reproduce those entries and meet the targets, as an optional add-on on its own page.

Short answer: **yes, it is feasible, small and cheap to run in the browser.** The probe in this folder recovers a
hidden strategy from imperfect highlights in under 10 seconds on 100,000 bars, using code the app already has.
Nothing in `client/`, `server/`, `shared/` or `package.json` changed.

Files: [probe.ts](probe.ts) (run `node docs/spikes/strategy-maker/probe.ts`, no network, exits 0, seeded) and
[output.txt](output.txt) (the run quoted below). Lines tagged `[perf]` are timing and memory and differ between runs;
every other line is identical run to run (checked by diffing two runs with the `[perf]` lines removed).

## What the probe does

- Two series: `examples/sample-daily.csv` (200 daily bars) and a seeded synthetic series of 100,000 hourly bars
  (random walk with a slowly varying drift, so trend strategies have something to find).
- A hidden strategy (`sma_cross`, fast 8, slow 34, long only) gives perfect entries and exits. They are degraded like a
  human would: about 15% dropped, about 30% shifted by 1 to 3 bars. These are the "highlights" (1,051 entries and
  1,048 exits in the first 70% of the synthetic series).
- Approach A searches 891 candidates (grids over `sma_cross`, `ema_cross`, `macd_cross`, `rsi_reversion`,
  `bollinger`, `donchian`), scores each by entry/exit match with the highlights (F1 within 3 bars), and backtests the
  best with the real `runBacktest` and `computeMetrics`. Selection uses the first 70% of bars; the last 30% is held out.
- Approach B trains a small decision tree (about 150 lines in the probe, no dependency) over 14 indicator features
  (price vs SMA, SMA/EMA ratios, MACD histogram, RSI 14 and 5, Bollinger %B, ATR, Donchian position, returns).
- The probe imports the real app modules. They import each other without file extensions, which plain `node` cannot
  resolve, so the probe registers a small resolve hook (`node:module` `registerHooks`) that retries with `.ts`. Nothing
  is copied from the app.
- Targets used: R:R at least 1.0, win rate at least 30%, max drawdown at most 60%.

## 1. Does something like this already exist?

Checked: the repo (no "machine learning" or "strategy maker" text, no existing generator) and prior art known to the
author. No web search was run for this spike, so treat the list as a map, not a survey.

- **Search-based strategy builders** exist: StrategyQuant X, Build Alpha and TradingView-adjacent tools generate
  strategies with genetic programming or random search over indicator rules; open-source examples are Backtrader or
  vectorbt parameter sweeps and DEAP/`gplearn` style genetic search. All are search, not a model that learned your taste.
  Vost already ships the grid-search half (`client/src/lib/backtest/optimizer.ts`).
- **Supervised classifiers on labelled bars** (decision trees, gradient-boosted trees, small neural nets over
  indicator features) are standard in research code and in libraries such as scikit-learn, LightGBM or XGBoost. They
  are libraries, not ready-made products that read Vost's charts.
- **Can anything be used as-is?** No. No pretrained model can know what the user considers a good entry. The
  "training" is therefore on the user's own highlights (labels) plus a search, and a model is only as good as those
  labels. Pretrained price-prediction models do not answer this question and would add a large dependency for no gain.
- **Difference from Immich's ML service:** Immich ships pretrained vision models (CLIP search, face recognition) in a
  separate container; users never train them. Here the model is tiny, trained from scratch per user on a few
  hundred to a few thousand labelled bars, and it can run inside the page.

## 2. Approach

- **A. Search only (no trained model).** Highlights are labels; candidate templates and params are searched with the
  existing backtester and scored by agreement with the highlights, then filtered by the user's targets.
  Probe result (synthetic, 100,000 bars): the top candidate is `sma_cross` fast 8 / slow 34, exactly the hidden
  strategy (F1 0.925, precision 0.86, recall 1.00); the next seven are neighbours of it (fast 6 to 10, slow 30 to 38).
  On the 200-bar sample the true strategy ranks first by F1 (0.857) but with 3 trades the targets cannot be judged,
  and the first candidate to meet them is a different strategy (`ema_cross` 4/22): a warning that tiny data
  proves nothing, which the UI must say.
- **B. Small interpretable model.** A depth-3 decision tree labelled "in a trade / flat" from the highlights.
  On the synthetic series it puts 100% of the importance on `sma8/sma34-1`, with the learned rule "in trade when
  sma8/sma34-1 > about 0.0003", which is the hidden strategy's condition. Held-out accuracy 86.3%; turning its state
  back into entries and exits matches the held-out highlights at F1 0.924. A tree trained on the event labels
  (none / entry / exit, only the highlighted bar) fails: 96.9% accuracy but 0% recall on entries and exits, because
  those bars are 3% of all bars. So events must be labelled as a held state (between a highlighted entry and its exit),
  or the labels widened and the classes weighted.
  B alone only says which features matter. It does not tune a period, check fees, stops or drawdown, or know the
  candidate templates the engine can run.
- **C. Hybrid (recommended).** B ranks indicator families and coarse settings from the highlights (cheap, readable:
  "the highlights are explained by fast/slow SMA distance"). A then searches only the templates and param ranges B
  points to, which shrinks the grid, backtests with the real engine and validates. B gives the explanation and the
  narrowing; A gives the numbers the user can trust, because only the backtester judges profit, R:R and drawdown.
  Start with A alone (it is already enough to recover the strategy), then add B as the explainer and grid narrower.

No LLM or neural language model is used in any option.

## 3. Where it runs

- **Browser, pure TypeScript in a Web Worker (recommended).** The backtester, optimizer and indicators already run there.
  Measured (Node, same code): one full backtest of 100,000 bars takes about 60 ms; scoring 891 candidates takes 7.8 s
  (about 9 ms each); the tree trains in about 0.1 s. Nothing to install, works offline, data never leaves the machine.
  Trade-offs: bounded by one thread and the tab's memory; no gradient-boosted trees or large models without writing or
  bundling them.
- **Optional local sidecar** (Python with scikit-learn or LightGBM, or ONNX Runtime) called on localhost. Faster for big
  grids and richer models, but needs a Python install or a container, a version contract, and a port; it is the same
  deployment problem Immich has. It adds nothing the probe needed.
- Recommendation: browser only for the first build. Design the request/response contract (section 8) so a sidecar can be
  added later if users hit the limits, without changing the page.

## 4. Trainable

- **Feeding data:** each saved highlight set is `{symbol, timeframe, entries[], exits[]}` (times, not bar indexes, so it
  survives data refreshes) plus optional Long/Short position drawings, which already carry entry, stop and target in
  `drawings.v2`. More charts, more symbols and CSV imports simply add rows.
- **Storage:** IndexedDB in the browser, next to the existing local stores; nothing goes to the Vost server.
  A trained tree is a few KB of JSON (feature name, threshold, children); the labels are the larger part.
- **Retraining:** automatic on demand. The tree trains in about 0.1 s for 70,000 bars (more with more symbols; scales
  linearly in bars times features); the search re-runs in seconds. No background training.
- **Export/import:** one JSON file `{version, highlights[], model}`, versioned, so a model moves between machines.

## 5. Overfitting

Highlights come from a person, so a search will happily fit their noise. Every recommendation is checked before it is
shown, with tools the app already has: the selection runs on the first 70% only and the last 30% is reported
alongside (the probe does this: the held-out run of the found strategy has return 161.5%, win 32.6%, R:R 2.53, max
drawdown 60.3%); `walkForward.ts`, `validation.ts` (in-sample / out-of-sample), `robustness.ts` (neighbouring params)
and `monteCarlo.ts` are run on the winner. A recommendation is only labelled "validated" if the out-of-sample result
keeps its R:R, hit rate and drawdown within the targets.

When nothing meets the targets the page shows the **closest found** with its gaps, exactly as the probe prints them:
`sma_cross 8/34 ... closest, gaps: dd 73.2% > 60%`. The synthetic run is that case: the best match to the highlights
has R:R 2.47 and win rate 32.6% but a drawdown of 73.2%, above the 60% target. Also note the probe shows the
best-matching candidate is not always the best on targets; the UI should offer both.

Limits to state in the UI: fewer than about 30 highlighted trades is not enough (the 200-bar run had 2), highlights
made with hindsight select for strategies that only look good in hindsight, and fees/slippage must stay on.

## 6. Resource estimate

Measured on this container (Node 24, one thread), from [output.txt](output.txt):

| Step (synthetic, 100,000 bars) | Time |
| --- | --- |
| One backtest plus metrics | about 60 ms |
| Score 891 candidates against highlights | about 7.8 s |
| Backtest top 8 | about 0.1 s |
| 14 indicator features | about 75 ms |
| Train depth-3 tree | about 0.12 s |
| One recommendation end to end (A) | about 8 s |

Memory: peak RSS 443 MB for the whole probe in Node, of which about 80 MB is Node itself and the series (100,000
bars, 14 feature columns, trade lists and equity curves) is the rest. After keeping only candidate marks (not full
signal arrays) the heap stays under about 200 MB. In the browser expect a similar order of magnitude per tab; a longer
history or more symbols should be streamed per symbol rather than held together.

Disk: a few KB per model, a few hundred KB for labels; no model files to download.

Sidecar (not built): a Python process with scikit-learn is typically a few hundred MB on disk and 100 to 300 MB RAM
idle; a LightGBM model on this scale trains in well under a second. Neither was measured here.

Immich's ML container, for comparison (figures from memory of its documentation, not measured here): an image of
several GB and typically 1 GB or more of RAM while it loads CLIP and face models, with first-run model downloads.
The browser option is two to three orders of magnitude smaller and needs no download.

Browser timings are not measured here (no browser in the probe); Web Workers run the same JS engine family, so expect
the same order of magnitude, with the 891-candidate search the step to cap (see `MAX_GRID_COMBOS` in the optimizer)
and to run with progress and a cancel button.

## 7. Time estimate

Rough sizes for one developer, as separate follow-up issues:

1. Highlight and target capture on a `/strategy-maker` page (lazy chunk like `/compare`; mark entries/exits or read
   Long/Short drawings; targets form): **M**.
2. Search engine (candidate grid, F1 match scoring, target filter, closest-found, worker with progress/cancel): **M**.
3. Validation wiring (hold-out plus walk-forward / Monte Carlo on the winner, "open in Backtest tab" button): **M**.
4. Decision-tree model and explainer (features, rules view, importance, grid narrowing): **M**.
5. Training data store, import/export, versioning (IndexedDB): **S to M**.
6. Optional local sidecar API (contract, client adapter, a reference server): **L**, only if wanted.
7. User guide page and e2e capture: **S**.

Items 1 to 3 and 7 give a useful first release (approach A). About 4 to 6 weeks for 1 to 5 and 7; the sidecar is extra.

## 8. Design of the optional add-on

- **Page:** `/strategy-maker`, lazy-loaded as its own chunk like `ComparePage` (`isComparePath` pattern in
  `client/src/lib/route.ts`). Not in the main bundle, so users who never open it pay nothing.
- **Inputs:** highlighted entries and exits (or Long/Short position drawings), strategy type (long, short, both),
  conditions (allowed indicator families), risk (stop, take profit, size), and targets: min R:R, min hit rate, max
  drawdown.
- **Output:** a ranked list of recommended indicators with settings (for example "SMA 8 / SMA 34 cross, long only"), each
  with its backtest, its validation verdict and its match with the highlights; a "closest found" state with gaps; a
  button that opens the chosen one in the Backtest tab (strategy id plus params, which the Backtest tab already takes).
- **Sidecar contract (only if chosen later),** local only, `http://127.0.0.1:<port>/v1`, no Vost server involvement:
  - `GET /v1/health` returns `{ "version": "1", "models": ["tree"] }`.
  - `POST /v1/train` takes `{ "version": "1", "candles": [[time, o, h, l, c, v]...], "highlights": { "entries": [time...], "exits": [time...] } }`
    and returns `{ "modelId": "...", "features": [{ "name": "sma8/sma34-1", "importance": 0.99 }], "rules": [...] }`.
  - `POST /v1/recommend` takes `{ "version": "1", "modelId": "...", "candles": [...], "targets": { "minRR": 1, "minHitRatePct": 30, "maxDrawdownPct": 60 } }`
    and returns `{ "candidates": [{ "strategyId": "sma_cross", "params": { ... }, "match": { "f1": 0.92 }, "gaps": [] }] }`.
  - The `version` field is required in every request; an unknown major returns `400` with `{ "error": "unsupported_version", "supported": ["1"] }`.
  The browser option exposes the same shapes as a worker message protocol, so the page does not know which one runs.

## 9. Recommendation and open decisions

Recommendation: build it, browser only, approach C staged as A first. It is cheap, offline and uses code Vost already
has; the probe shows the search recovers the strategy behind imperfect highlights, and the tree explains it.

Decisions for the owner:

1. Build it at all? (Value depends on users having a clear idea of "a good entry" to highlight.)
2. Browser only, or also a local sidecar? (Recommended: browser only now.)
3. Search only first (A), or search plus model (C) from the start? (Recommended: A, then B.)
4. Minimum number of highlighted trades before the page will give a recommendation (suggested 30).
5. Are Long/Short position drawings the main highlight input, or a dedicated entry/exit marking tool as well?

## Honest limits of this probe

- The hidden strategy is one of the built-in templates, so approach A is guaranteed to contain it in its grid. Real
  human highlights come from no template; the page must say "closest found" often.
- One hidden strategy, one seed, and a synthetic series: it shows the pipeline works and what it costs, not how often it
  will find something profitable on real markets.
- The decision tree uses 64 histogram bins and a fixed depth; gradient-boosted trees were not tried.
- Browser speed and the sidecar's numbers were not measured.
