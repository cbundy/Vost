# UI and server audit

A research audit of every pane of the app and of the server behind it, run on `5f47b30` (main at the time, v0.4.0) with the code in this folder. It fixes nothing: the findings become the follow-up issues in [Proposed issues](#proposed-issues). No file under `client/src/`, `server/` or `shared/` changed.

## Method

Loop agents may not run the dev server or click through the app, so the audit is two scripts that start and stop everything themselves:

| What | Command | Output |
|---|---|---|
| Browser audit, desktop 1440x900 and narrow 390x844 | `npm run -s e2e:capture -- ui-audit` (about 2.5 min; scenario [`e2e/capture/scenarios/ui-audit.ts`](../../../e2e/capture/scenarios/ui-audit.ts)) | `docs/evidence/ui-audit/ui-audit-*` (screenshots and eight .txt records per viewport) |
| Server probe | `timeout 300 node docs/spikes/ui-audit/probes/server-probe.ts` (about 2 min) | [`raw/server-probe.txt`](raw/server-probe.txt) |

The scenario drives every provider, symbol switches through SymbolSearch, rapid timeframe and provider switches, live on/off/on (three times), a CSV import from `examples/` (plus the MT5 sample and a broken file), a backtest and an optimizer run, the Pine tab, every modal, popover and the drawer (with Esc and the backdrop), a 140-stop keyboard Tab walk, the market-data service stopped mid-session and a 1.5 s network latency. While it runs it records console messages and page errors, every request (count, status, duration), identical `/api` requests inside one user action, overflowing elements, counts of open sockets, event streams, timers, window/document listeners and canvases (an init script wraps `WebSocket`, `EventSource`, `setInterval`, `setTimeout` and `addEventListener`), and `elementFromPoint` stacking checks. It reports findings and fails only when a step cannot run. The probe starts the fake upstream and `server/index.mjs` on free 127.0.0.1 ports, sends odd requests, points a second server at a socket that never answers, writes the raw log, stops both and exits.

Records per viewport (`-desktop` / `-narrow`): `console`, `requests`, `leaks`, `layout`, `a11y`, `stack`, `races`, `states`. Evidence links below are commit-pinned (`f22bf8e`), as docs/e2e-visual-verification.md asks; the full set is in [docs/evidence/ui-audit/](../../evidence/ui-audit/).

Notes on the method:

- `/api/live` is a server-sent event stream (`EventSource`), not a websocket, and has no subscribe message; "bad subscribe messages" became bad query parameters. The browser never opens a WebSocket (the leak record shows `ws open=0/0`).
- The fake upstream answers any symbol, so an "unknown symbol" gets data. Real providers reject it; the 502 error shape is covered by the "service goes away" and "silent upstream" probe stages.
- Existing scenarios: `outage` was re-run on this commit and passes ([live](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/outage-live-desktop.png?raw=true), [outage](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/outage-outage-desktop.png?raw=true), [recovered](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/outage-recovered-desktop.png?raw=true); its video and GIF are not committed, 2.7 MB). `network-audit` was re-run and **fails** at its step "add the symbol to the watchlist, leave, and open it" (a `locator.waitFor` timeout) with this branch's code, which changes nothing it touches, so it is not usable evidence; it is a pre-existing break, not diagnosed here (N-1 in Proposed issues).
- `npx tsc -p e2e` already reports two errors in `pane-resize.ts` and `responsive.ts` (`NodeListOf` is not iterable: the e2e tsconfig has no `DOM.Iterable`); the new scenario adds none.

## Inventory

State owner is a slice of `client/src/state/store.ts` unless it says local. Defects are finding IDs from the next section; "-" means none found.

| Pane | Purpose | State owner | Data source | Defects |
|---|---|---|---|---|
| TopBar (`TopBar.tsx`) | Provider, symbol, timeframe, bars, Load, live, inbox, import | `providerId`, `symbol`, `timeframe`, `bars`, `loadState`, `live`, `liveStatus`, `candles`; local `now` tick | store -> `/api/history`; `/api/live` (SSE); localStorage `vost.prefs.v1` | F-04, F-05, F-06, F-13 |
| TopBarMore (`TopBarMore.tsx`) | Popover holding the controls that do not fit at 1280 px and below | local `open` | same controls as TopBar | - |
| ConnectionStatus (`ConnectionStatus.tsx`) | Health dot and popover for the server and each feed | `useStatus` (`client/src/state/status.ts`, polls every 30 s); local `open` | `/api/status` | F-12 |
| ZoneClock (`ZoneClock.tsx`) | Clock and time-zone picker in the dock strip | `timeZone`; local `open`, `query` | browser `Intl` | - |
| ChartRangeControl / TimeRangePicker | Show a window of the chart; the same picker sets the backtest range | `chartRange`, `fullCandles`, `chartRangeFetched`; `btRange` | store; `/api/history` with `from`/`to` | - |
| Sidebar: Data | Loaded bars, label, save/export | `candles`, `dataLabel`, `activeDatasetId` | store | F-04 |
| Sidebar: Local library | Saved and imported datasets | `datasets`, `activeDatasetId` | localStorage (debounced) | - |
| Sidebar: Watchlist (`Watchlist.tsx`) | Lists, sections, tags, import/export | `watchlists` | localStorage; the price comes from the loaded candles only | F-17, F-18 |
| Sidebar: Indicators | Indicator list and parameters, add Pine | `indicators`, `pineRuns`, `selectedPineId` | store; indicator math in `lib/indicatorCompute.ts`, Pine in a worker | F-11 |
| Sidebar drawer (`Sidebar.tsx`, below 900 px) | The same sections in a modal drawer | `App.tsx` local `drawerOpen`, `useMediaQuery` | as the sections | - |
| Splitter (`Splitter.tsx`) x2 | Resize the sidebar and the dock | local drag state; `sidebarWidth`, `dockHeight` | localStorage prefs | - |
| ChartPanel (`ChartPanel.tsx`) | Candles, indicators, trades, legend, toolbar | `candles`, `indicators`, `btResult`, `showTrades`, `chartRange` | store; lightweight-charts canvases | F-02 |
| BottomDock (`BottomDock.tsx`) | Tab strip and panel | `dockTab`, `dockCollapsed`, `dockHeight` | store | F-09 |
| Dock: Backtest (`BacktestTab.tsx`) | Strategy form and run | `btConfig`, `btRunning`, `btResult`, `btError`, `btRange` | store; `lib/workers/backtest.worker.ts` | - |
| Dock: Pine (`PineTab.tsx`, `PineEditor.tsx`) | Edit Pine indicators | `indicators`, `pineRuns`, `selectedPineId` | store; CodeMirror; Pine worker | - |
| Dock: Optimizer (`OptimizerTab.tsx`) | Grid search, table, heatmap | `optConfig`, `optRunning`, `optResult` | store; backtest worker | F-03 |
| Dock: Results (`ResultsTab.tsx`, `EquityChart.tsx`, `TradesTable.tsx`) | Metrics, equity curve, trades | `btResult`, `showTrades`, `dataLabel` | store; lightweight-charts | - |
| CsvImportModal | Parse a CSV and import | `App.tsx` local `csvOpen`; local parse state | `lib/csv.ts`; file input, paste | F-08 |
| Inbox | Messages and errors | `App.tsx` local `inboxOpen`; `messages` | store | F-08 |
| Toasts | Short notices (5 s, errors 9 s) | `toasts` | store | F-11, F-16 |
| SymbolSearch (`SymbolSearch.tsx`) | Type or pick a symbol | local `query`, `open`, `activeIdx`; `symbolSuggestions`, `symbolCatalog` | `/api/search`, `/api/symbols` | F-01, F-07, F-10, F-14, F-15 |
| Server (`server/main.ts`, `api.ts`, `providers/`, `live/`, `status/`) | Static files, `/api/*`, live relay, health | process memory (symbol cache, relay, status registry) | exchange REST and websockets | S-01 to S-05 |

## Findings

Each finding has a category, a severity, steps (scenario step or probe case, then the manual equivalent) and evidence. "code-read" means found by reading the code, with `file:line` at `5f47b30`.

### Layout

**F-01 (medium) - the symbol list runs off the screen on a phone.** At 390 px the suggestion list is 436 px wide and starts at the input's left edge, so its right edge is at x=505 and the whole page gets a horizontal scroll while it is open. Steps: scenario step "popovers: status, zone clock, range, symbol list" at `narrow`; by hand: open the app at 390 px and tap the symbol box. Evidence: [layout record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-layout-narrow.txt?raw=true) (`DOCUMENT scrollWidth=505 > innerWidth=390`, section "symbol list"), [screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-symbol-list-narrow.png?raw=true).

**F-02 (low) - the phone chart header and dock strip are clipped.** At 390 px the OHLC legend wraps to two lines and its last value runs under the chart toolbar ("C 126" is cut), and the Results tab badge ("3 trades") is cut by the clock in the dock strip. Steps: scenario `narrow`, any loaded chart; by hand: open at 390 px. Evidence: [start](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-start-narrow.png?raw=true), [results](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-results-narrow.png?raw=true), [pine](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-pine-narrow.png?raw=true).

**F-03 (low) - the optimizer table and heatmap are wider than the panel.** The results table is 1767 px wide in a 1408 px panel on desktop (1137 in 358 on a phone) and the heatmap 916 in 557; the right columns are cut off in the screenshot. Steps: scenario step "optimizer run"; by hand: run an optimization with a 2-parameter sweep. Evidence: [layout record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-layout-desktop.txt?raw=true) (section "optimizer tab"), [screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-optimizer-done-desktop.png?raw=true).

Checked, no other overflow: the layout record scans every provider, tab, popover and modal at both sizes; apart from the three above the only entries are a 2 px clip in the symbol box at 390 px (the text is 69 px in a 67 px box) and intentionally ellipsised or screen-reader-only text (filtered out).

### State that disagrees with itself

**F-04 (medium) - after a CSV import the top bar still shows the old market.** The chart says "Local - sample-daily" while the top bar still says Binance / BTCUSDT / 15m and the watchlist still highlights BTCUSDT; pressing Load replaces the imported chart with Binance data. Steps: scenario step "CSV import from examples/"; by hand: import `examples/sample-daily.csv` after loading any provider. Evidence: [optimizer-done](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-optimizer-done-desktop.png?raw=true), [results-narrow](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-results-narrow.png?raw=true), [states record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-states-desktop.txt?raw=true).

**F-13 (medium) - a failed provider switch leaves the old candles under the new selection.** With the market-data service down, switching from Binance to Kraken sets the symbol box to XBTUSD and shows an error toast, but the chart legend and the Data section keep saying "Binance - BTCUSDT - 1h" with Binance candles. Steps: scenario step "loading, error and empty states"; by hand: cut the network, change provider. Evidence: [states record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-states-desktop.txt?raw=true) ("provider switched to Kraken with the upstream down"), [screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-provider-switch-failed-desktop.png?raw=true). Code-read: `setProvider` writes the new provider and symbol first (`client/src/state/store.ts:542-551`) and the failure branch of `loadData` only sets `loadState` and pushes a toast (`store.ts:593-597`).

**F-12 (medium) - the status badge counts feeds nobody has checked as problems.** On a fresh server with background checks off the badge says "Connections: 9 problems" though every checked feed is ok and the rest are grey "not checked yet". Steps: scenario start at `desktop`; by hand: open the app against a server started with `VOST_STATUS_INTERVAL=0`. Evidence: [status popover](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-status-popover-desktop.png?raw=true), [a11y record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-a11y-desktop.txt?raw=true) (tab stop "Connections: 9 problems"). Code-read: `problemCount` counts every state that is not `ok`, which includes `unknown` (`client/src/lib/status.ts:50-52`).

### Races, stale closures, duplicate fetches

**F-05 (medium) - changing the timeframe, provider or watchlist item while live is on switches live off without a word.** The button goes back to "Live" and the event stream closes (5 streams opened over the run, 0 open at the end), although `loadData` contains a branch that reconnects for the new symbol or timeframe. Steps: scenario step "live on, off, on again" (its last sub-step changes the timeframe while live); by hand: turn Live on for Binance, then pick another timeframe. Evidence: [races record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-races-desktop.txt?raw=true) ("live button after a timeframe change while live: \"Live\""), [leaks record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-leaks-desktop.txt?raw=true) (`eventsource open=0/4` after the change). Code-read: `setTimeframe`, `setProvider` and `openWatchItem` call `stopLive()` first (`store.ts:544,555,568`), which sets `live: false` (`store.ts:437-442`), so the `if (s.live && provider.startLive) s.setLive(true)` reconnect in `loadData` (`store.ts:591`) never fires for them; only a symbol change (`store.ts:561-565`, which does not stop live) reaches it.

**F-06 (low) - superseded history requests are not cancelled.** Fourteen rapid selections fired 16 `/api/history` requests; none was cancelled (0 `ERR_ABORTED`), and the same URL is fetched again inside one action (`timeframe=15m` 2x, `5m` 3x). The final chart is correct every time: the `requestToken` check drops stale answers. Steps: scenario step "rapid timeframe switches"; by hand: flip the timeframe select quickly. Evidence: [races record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-races-desktop.txt?raw=true) (every sequence "consistent"), [requests record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-requests-desktop.txt?raw=true) (section "identical /api requests"). Code-read: `loadData` calls `provider.fetchHistory({ symbol, timeframe: tf, bars })` with no signal (`store.ts:586`) although the client supports one (`client/src/lib/providers/api.ts:9-11,19`).

**F-07 (low, code-read) - a slow symbol search can overwrite another provider's suggestions.** `searchSymbols` keeps the provider it read before the `await` and, after it, checks only that the query text is unchanged (`store.ts:1014-1016`); its `catch` sets the popular list with no check at all (`store.ts:1017-1018`). After a provider switch with the same query text, the old provider's answer can land. Not reproduced: it needs a slow upstream and the same text in the box.

**F-15 (low) - the symbol box refetches on every focus.** Each focus calls `loadSymbolCatalog()` and `searchSymbols(query)` again: `/api/search?provider=binance&q=BTCUSDT` was requested 4 times and `/api/symbols?provider=binance` twice in one run (two focuses before the first catalog answer both fetch). Steps: scenario "symbol search" steps; by hand: click in and out of the symbol box. Evidence: [requests record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-requests-desktop.txt?raw=true) (section "count per distinct request"). Code-read: `SymbolSearch.tsx` `onFocus`, and `loadSymbolCatalog` checks the cache before the fetch but not while one is running (`store.ts:1021-1034`).

Checked, no defect: the live backfill is guarded by `session` and `dataKey` (`store.ts:956-961`); the `BacktestTab` effect that refreshes Pine inputs lists its dependencies; every rapid timeframe and provider sequence ended with select, legend and bar spacing agreeing.

### Leaks and chart disposal (none found)

[Leak record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-leaks-desktop.txt?raw=true), about 30 snapshots per viewport: open websockets 0 throughout (the browser uses SSE); event streams follow the live toggles (0 or 1 open, never 2); intervals and timeouts return to the idle level (the one extra interval after the first minute is the ZoneClock minute tick); canvases stay at 7 across 6 provider switches, 6 timeframe switches and 4 Results/Backtest tab cycles, and the Results tab's 18 canvases go back to 7 when it closes, so `chart.remove()` runs for the main and equity charts (`ChartPanel.tsx:144`, `EquityChart.tsx:93`); DOM node counts are flat across 6 Inbox cycles, 5 drawer plus More cycles and 3 CSV modal cycles. Window listeners rise from 3 to 16 once, at the first file chooser: the added types are Playwright's own (`__playwright_global_listeners_check__`, `mousemove`, and so on, listed in the record), and the count does not grow with later cycles, so it is a harness effect. One harmless leftover: `pushToast` never clears its dismiss timer (`store.ts:1057`).

### Modals, popovers and z-index

**F-08 (medium) - modals do not manage focus.** Opening Inbox or the CSV dialog leaves focus on the opener, one Tab leaves the dialog for the page behind it (the overlay hides it, but it is still reachable), and the dialog has `aria-modal` but no accessible name. Esc and the backdrop close it, and focus is on the opener afterwards only because it never moved. Steps: scenario step "Inbox: open, stack check, Esc, backdrop"; by hand: open Inbox, press Tab. Evidence: [a11y record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-a11y-desktop.txt?raw=true) (first four lines), [inbox screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-inbox-desktop.png?raw=true). Code-read: `Modal.tsx` has only a window `keydown` for Esc (`Modal.tsx:11-38`); compare the drawer, which moves and traps focus (`Sidebar.tsx:16-46`).

**F-16 (low) - toasts cover content on a phone.** A toast stays 5 s (errors 9 s) over the bottom of the screen; at 390 px it covers the dock content, including the Results numbers, and it stays above modals (z-index 200 against 100, by design). Evidence: [results-narrow](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-results-narrow.png?raw=true), [pine-narrow](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-pine-narrow.png?raw=true), [stack record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-stack-narrow.txt?raw=true).

Checked, no defect: with Inbox open, `elementFromPoint` on the top bar, chart and dock returns the overlay at both sizes ([stack record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-stack-desktop.txt?raw=true)); the status popover and the drawer open inside the viewport (box 8,41 374x666 at 390 px) and close with Esc; the drawer traps focus (also covered by the `responsive` scenario).

### Missing loading, empty and error states

**F-14 (low) - a symbol search with no match shows nothing.** The list simply disappears (`open && rows.length > 0` in `SymbolSearch.tsx`), with no "no results". Evidence: [states record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-states-desktop.txt?raw=true), [screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-search-nomatch-desktop.png?raw=true).

**F-18 (low) - the watchlist quote column is "-" for every row but the open symbol.** Quotes come from the loaded candles only (`Watchlist.tsx:28-35`) and nothing says why. Evidence: [optimizer-done](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-optimizer-done-desktop.png?raw=true) (left column).

**F-17 (low, code-read) - the watchlist names lists and sections with `window.prompt`.** `ask()` is `window.prompt(...)` (`Watchlist.tsx:36`): an unstyled blocking dialog, not drivable by the capture runner (the scenario dismisses it) and awkward on phones.

Checked, no defect: loading shows a "Loading data..." overlay and a spinner on Load ([screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-loading-desktop.png?raw=true)); a failed load with the service down gives an error toast and an Inbox message ([screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-upstream-down-desktop.png?raw=true)); a broken CSV stays in the mapping step with "Open / High / Low / Close columns must all be assigned" and Import disabled ([screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-csv-broken-desktop.png?raw=true)); the empty Pine tab shows "No Pine indicators" with an Add button ([screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-pine-empty-desktop.png?raw=true)).

### Keyboard and accessibility

**F-09 (medium) - the dock tabs have no arrow-key navigation and sit far down the Tab order.** `ArrowRight` on the Backtest tab keeps focus on it; the strip has `role=tablist` but no key handling or roving tabindex (`BottomDock.tsx:77-101`). The first dock stop is the 56th Tab press on desktop (after the whole sidebar) and the 16th at 390 px. Steps: scenario step "Tab walk through the top bar and the dock". Evidence: [a11y record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-a11y-desktop.txt?raw=true) (lines "first stop inside the bottom dock" and "dock tablist").

**F-10 (medium) - tabbing into the symbol box opens the full list and every row's "+" is a Tab stop.** Stops 4 to 6 of the desktop walk are "Add DEMO / DEMO-BEAR / DEMO-CHOP to watchlist", before the timeframe select; on Binance the list has dozens of rows. Evidence: [a11y record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-a11y-desktop.txt?raw=true), [screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-focus-timeframe-desktop.png?raw=true) (the list open over the chart while focus is in the symbol box).

**F-11 (low) - nothing is announced and one select has no label.** The page has no `aria-live`, `role=status` or `role=alert` region (toasts, loading and errors are silent to a screen reader); the Timeframe select is named only by its `title`, and the sidebar's "Add indicator" select has no label (`Sidebar.tsx:266`). Evidence: [a11y record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-a11y-desktop.txt?raw=true) (last block).

Checked, no defect: buttons show the browser focus outline; inputs and selects swap to an accent border on `:focus` (`styles.css:214-216`; the record's "focus-ring=NO" lines for them are sampled during the 0.12 s border transition, and the [screenshot](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-focus-timeframe-desktop.png?raw=true) shows the accent border on the symbol box); `lang`, one `main` and one `header` are present; both splitters have `role=separator`; Esc closes the More menu, the status popover, the zone clock, the drawer and the modals.

### Console and requests (none found)

[Console record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-console-desktop.txt?raw=true): one message in a full run, at each size - the browser's own "502 (Bad Gateway)" line for the deliberate service-down step. No page error, no React warning. [Requests record](https://github.com/cbundy/Vost/blob/f22bf8e7d615467e606e2aaa34d1de9a8cd7947b/docs/evidence/ui-audit/ui-audit-requests-desktop.txt?raw=true): about 75 requests per run, none slower than 500 ms (the slowest, 475 ms, is under the deliberate 1.5 s latency), the only non-2xx is that 502, and the `ERR_ABORTED` entries are the live stream being closed on purpose.

### Server

All from [raw/server-probe.txt](raw/server-probe.txt).

**S-01 (medium) - the static-file guard is a prefix check.** `if (!filePath.startsWith(DIST))` (`server/main.ts`, `handleStatic`) accepts any sibling folder whose name starts with `dist`: `GET /..%2fdist-probe%2fsecret.txt` served a file from `client/dist-probe/` (a folder the probe creates and removes), while `/..%2f..%2fpackage.json` gives 403. Fix: compare with `DIST + path.sep`. Steps: probe stage "static files and path traversal".

**S-02 (medium) - an upstream that stalls holds the browser for up to hosts x 25 s, and an abandoned call is not dropped.** With a silent upstream Coinbase answers `502 upstream timed out after 25s` after 25 s and Binance (two hosts) after 50 s; there is no overall deadline and the browser has no timeout. When the browser leaves after 1 s the server's upstream connection is still open 6.5 s later. Steps: probe stage "an upstream that accepts the connection and never answers". Code: `server/providers/upstream.ts:16,54-56`, host list `server/providers/binance.ts:17`, abort wiring in `server/api.ts` `handleApi`.

**S-03 (medium) - `/api/live` is open to anyone, takes any symbol and has no cap.** 40 streams on one feed share one upstream socket (good), but 60 different symbols opened 60 upstream websockets, and bad symbols such as `BTC"USDT 1` or 5000 characters are subscribed as they are. The API also sends `access-control-allow-origin: *`, so any web page the user visits can open these streams against a locally hosted Vost. Steps: probe stage "/api/live".

**S-04 (low) - error shapes.** Every handled error is JSON `{error}` with 400, 404, 405 or 502, and unknown providers, bad timeframes, `bars`, `from` and `to` are validated with clear text. Two rough edges: a 20000-character symbol gets Node's bare `431` with no body, and an unreachable upstream says "upstream fetch failed: fetch failed" with no cause. `/api/live` reports bad parameters as HTTP 200 with a `fatal` status event (by design for `EventSource`).

**S-05 (low) - `/api/status?refresh=1` is open and runs a 4 s round of outbound probes**; a second call within seconds is answered from cache (1 ms), so it is bounded, not free.

Checked, no defect: proxy and whitelist - symbols, `..%2F`, `&limit=1`, NUL and unicode are percent-encoded into fixed exchange URLs and upper-cased (the probe prints the exact upstream path), the provider must be in the catalog, there is no open-proxy route; methods - POST and DELETE give 405, HEAD works, OPTIONS gives 204; with the upstream down the search and symbol routes answer from the cache and `/api/live` reconnects, then recovers.

## Proposed issues

One issue per cluster; every finding is in exactly one.

| # | Title | Fixes | Severity | Why |
|---|---|---|---|---|
| I-1 | Symbol search: fit narrow screens, keyboard-friendly rows, empty state, no stale or repeat fetches | F-01, F-07, F-10, F-14, F-15 | medium | Broken on phones and awkward by keyboard; all in one component |
| I-2 | Keep live streaming across timeframe, provider and watchlist switches (or say it stopped) | F-05 | medium | Live goes off silently; the reconnect code is already there |
| I-3 | Keep the top bar and the chart in agreement (local datasets, failed provider switch) | F-04, F-13 | medium | The screen can name one market and show another |
| I-4 | Cancel superseded history requests | F-06 | low | Wasted server and exchange calls on quick switching; answers are already correct |
| I-5 | Accessibility basics: modal focus and name, dock tab arrow keys, live regions, labels | F-08, F-09, F-11 | medium | Keyboard and screen-reader users cannot use dialogs or tabs properly |
| I-6 | Status badge: do not count unchecked feeds as problems | F-12 | medium | The first thing a new user sees is "9 problems" |
| I-7 | Phone and panel layout polish: chart legend, dock badge, optimizer overflow, toasts over content | F-02, F-03, F-16 | low | Visual clipping, no data loss |
| I-8 | Watchlist polish: replace `window.prompt`, explain the "-" quotes | F-17, F-18 | low | Unstyled blocking dialog and an unexplained empty column |
| I-9 | Server: fix the static-file path check (compare with `DIST + path.sep`) | S-01 | medium | One-line fix for a real read into sibling folders |
| I-10 | Server: bound upstream waiting and open feeds (overall deadline, drop abandoned calls, cap and validate `/api/live`, review CORS) | S-02, S-03 | medium | A stalled exchange or a hostile page can tie up the server |
| I-11 | Server: error and status polish (431 body, upstream error cause, `refresh` limits) | S-04, S-05 | low | Small consistency gaps |
| N-1 | The `network-audit` capture scenario fails at its watchlist step | - | low | Existing evidence tooling is broken on main; not a finding of the audit, so it sits outside the one-issue-per-finding mapping |
