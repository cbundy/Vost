# E2E visual verification

`npm run e2e:capture` takes screenshots and videos of the running app as evidence for UI changes.
It is not a test suite: it is in no gate and must never run from CI or a gate command.

## Run it

```bash
npm ci
npm run -s e2e:capture -- alerts                # docs/evidence/alerts/alerts-{demo,empty,created,popup,inbox,triggered,menu,prefilled}-{desktop,narrow}.png + alerts-{telegram,checks}-{desktop,narrow}.txt (Binance on the fake feed, real server)
npm run -s e2e:capture -- chart                 # docs/evidence/chart/chart-desktop.png, chart-narrow.png
npm run -s e2e:capture -- chart-history       # docs/evidence/chart-history/chart-history-{opened,before,after,zoomed-out}-desktop.png + chart-history-checks-desktop.txt (Binance on the fake upstream opens on its latest 1000 bars with no Bars menu; the first older page is held so the visible time window is read before and after it arrives and must match to within one bar; zooming out pages more older bars in, with the paged /api/history?...&to= requests logged)
npm run -s e2e:capture -- settings            # docs/evidence/settings/settings-{topbar,open,all}-{desktop,narrow}.png + settings-checks-{desktop,narrow}.txt (the Settings gear at the right end of the top bar opens the popup; picking Load all bars at once saves the setting, reloads the chart and shows the Bars menu)
npm run -s e2e:capture -- chart-pan             # docs/evidence/chart-pan/chart-pan.webm (+ .gif if ffmpeg is on PATH)
npm run -s e2e:capture -- chart-panes           # docs/evidence/chart-panes/chart-panes-{default,crosshair,dragged,kept}-{desktop,narrow}.png + chart-panes-checks-{desktop,narrow}.txt
npm run -s e2e:capture -- chart-reset           # docs/evidence/chart-reset/{fresh,moved,reset,moved-minutes,reset-minutes}.png + chart-reset.webm
npm run -s e2e:capture -- chart-range          # docs/evidence/chart-range/chart-range-{before,quick,applied,refused,fetched,cleared}-{desktop,narrow}.png
npm run -s e2e:capture -- drawings           # docs/evidence/drawings/drawings-{rail,magnet,hidden,ray,rectangle,fib,drawn,selected,moved,rectangle-resized,deleted,undone,reloaded,timeframe,panned,text-placed,text-edited,text-reloaded,measure-up,measure-down}-desktop.png + drawings-{narrow,menu,first-tap,touch-drawn,touch-selected,touch-zoomed,touch-text-typing,touch-text,touch-measure}-narrow.png + drawings-checks-{desktop,narrow}.txt
npm run -s e2e:capture -- drawing-lines # docs/evidence/drawing-lines/drawing-lines-{drawn-<tool>,all,vertical-selected,cross-selected,timeframe}-{desktop,narrow}.png + drawing-lines-checks-{desktop,narrow}.txt (the info line, extended line, trend angle, horizontal ray, vertical line and cross line: draw each by drag or tap, a vertical line dragged keeps its price, undo and redo, a selected cross line with its axis labels, reload and a timeframe change)
npm run -s e2e:capture -- drawing-text     # docs/evidence/drawing-text/drawing-text-{typing,text,text-tab,text-styled,anchored,panned,zoomed,timeframe,coordinates,reloaded}-desktop.png + drawing-text-{typing,text,anchored,reloaded}-narrow.png + drawing-text-checks-{desktop,narrow}.txt (a three-line Text note that wraps, the Text tab, Anchored text kept on the pane through a pan, a zoom and a timeframe change, X %/Y %)
npm run -s e2e:capture -- drawing-toolbar # docs/evidence/drawing-toolbar/drawing-toolbar-{selected,colour,dashed,locked,more,followed,below,horizontal,note,narrow-360}-{desktop,narrow}.png + drawing-toolbar-checks-{desktop,narrow}.txt (the floating toolbar over a selected trend line: above it, below near the top, following a pan and a price-scale drag; quick colour, width and line style as single undo steps; gear, lock, clone, the more menu and delete; a horizontal line and a note with only their own pickers; none for two selected; a press on it neither draws nor pans; fits at 360 px)
npm run -s e2e:capture -- drawing-table    # docs/evidence/drawing-table/drawing-table-{preview,first-cell,tabbing,table,menu,rows-added,dialog,styled,reloaded,timeframe}-desktop.png + drawing-table-{first-cell,tabbing,table,reloaded}-narrow.png + drawing-table-checks-{desktop,narrow}.txt (Table placed by a click and its first cell typed, Tab and Shift+Tab between cells, a cell edited by double-click or double tap, a row and a column added from the right-click menu, Rows, Columns, header row and border colour in settings as one undo step; undo, redo, a reload and a timeframe change)
npm run -s e2e:capture -- drawing-image    # docs/evidence/drawing-image/drawing-image-{placed,preview,dragged,resized,resized-free,dialog,styled,deleted,undone,pasted,refused-big,refused-type,reloaded,timeframe}-desktop.png + drawing-image-{placed,reloaded}-narrow.png + drawing-image-checks-{desktop,narrow}.txt (Image: a generated PNG uploaded and placed by a click at its natural size, the same file again stored once, press-drag-release with a live preview, a corner resize with the ratio kept and with Shift, opacity and border in settings, delete then undo, redo, copy and paste, a 6 MB file and a renamed text file refused with their messages, a reload and a timeframe change; the checks record the IndexedDB record count and that no console error occurred)
npm run -s e2e:capture -- drawing-notes    # docs/evidence/drawing-notes/drawing-notes-{closed,hover,pinned,anchored,callout,callout-moved,comment,comment-edited,reloaded}-desktop.png + drawing-notes-{closed,pinned,anchored,callout,comment,comment-edited,reloaded}-narrow.png + drawing-notes-checks-{desktop,narrow}.txt (Note: popup on hover, pinned by a click and unpinned by another; Anchored note kept through a pan; Callout placed by press-drag-release and by two clicks, its box handle dragged with the target kept, restyled; Comment with a long text edited by double-click; undo, redo and a reload)
npm run -s e2e:capture -- drawing-positions # docs/evidence/drawing-positions/drawing-positions-{preview,placed,selected,clamping,clamped,inputs,style,restyled,outcomes,reloaded,timeframe,short}-desktop.png + drawing-positions-{placed,reloaded}-narrow.png + drawing-positions-checks-{desktop,narrow}.txt (Long position and Short position: the shape follows the pointer, one click places it, select shows four handles and the stats, a target dragged across the entry stops at it, the Inputs tab and Style change the label, a long with its target hit and a short with its stop hit show the closed profit or loss checked against the maths, a reload and a timeframe change; at 390 px a tap places one)
npm run -s e2e:capture -- drawing-forecast # docs/evidence/drawing-forecast/drawing-forecast-{forecast-preview,forecast-placed,projection-preview,projection-placed,forecast-selected,forecast-resized,projection-selected,projection-resized,forecast-settings,projection-settings,restyled,verdicts,reloaded,timeframe}-desktop.png + drawing-forecast-{forecast-placed,projection-placed,tapped,reloaded}-narrow.png + drawing-forecast-checks-{desktop,narrow}.txt (Forecast and Projection: press-drag-release and three-click placement, handles and axis labels, resizing by a handle, the settings dialogs and a restyle, a forecast whose past target was reached (Success), one that was missed (Failure) and one with a future target (no verdict) checked against the maths, a reload and a timeframe change; at 390 px both are placed by taps)
npm run -s e2e:capture -- drawing-bars # docs/evidence/drawing-bars/drawing-bars-{bars-preview,bars-placed,bars-drag-preview,bars-selected,bars-moved,bars-settings,bars-mirrored,bars-flipped,ghost-preview,ghost-placed,ghost-selected,ghost-resized,ghost-settings,restyled,reloaded,timeframe}-desktop.png + drawing-bars-{bars-placed,ghost-placed,reloaded}-narrow.png + drawing-bars-checks-{desktop,narrow}.txt (Bars pattern and Ghost feed: a bars pattern by two clicks and by press-drag-release with the preview, Mirrored, Flipped, a display mode change and a move of the copy; a ghost feed placed point by point and ended by double-click, selected, resized by a handle and restyled; a reload and a timeframe change with the ghost feed bars worked out from the stored anchors compared before and after; at 390 px both are placed by taps)
npm run -s e2e:capture -- drawing-ranges # docs/evidence/drawing-ranges/drawing-ranges-{priceRange-preview,dateRange-preview,datePriceRange-preview,placed,price-range-selected,price-range-resized,date-price-range-selected,date-range-settings,restyled,reloaded,timeframe}-desktop.png + drawing-ranges-{placed,tapped,reloaded}-narrow.png + drawing-ranges-checks-{desktop,narrow}.txt (Price range, Date range and Date and price range: press-drag-release and click placement, handles and axis labels, resizing by a handle, the settings dialog and a restyle, figures worked out again from the demo bars (the labels are read against them in the screenshots), a reload and a timeframe change; at 390 px each is placed by taps)
npm run -s e2e:capture -- drawing-price-markers # docs/evidence/drawing-price-markers/drawing-price-markers-{price-note,price-note-dragged,price-label,signpost,flag-mark,flag-mark-red,timeframe,reloaded}-desktop.png + drawing-price-markers-{price-note,price-label,signpost,flag-mark,reloaded}-narrow.png + drawing-price-markers-checks-{desktop,narrow}.txt (Price note placed by press-drag-release and by two clicks, its dot dragged with the price text read before and after; Price label; Signpost below with an emoji; Flag mark recoloured; undo, redo, a timeframe change and a reload)
npm run -s e2e:capture -- drawing-icons    # docs/evidence/drawing-icons/drawing-icons-{picker,search,preview,emoji-category,recent,resized,rotated,dialog,placed,reloaded,timeframe}-desktop.png + drawing-icons-{picker,search,emoji-category,recent,reloaded}-narrow.png + drawing-icons-checks-{desktop,narrow}.txt (the Icons picker with search and category tabs, the item following the pointer, Emojis by category, Stickers from Recent, a corner drag to resize, the rotation handle with Shift, settings and undo, a reload and a timeframe change; at 390 px the picker fits)
npm run -s e2e:capture -- drawing-channels # docs/evidence/drawing-channels/drawing-channels-{preview-parallelChannel,placing-flatTopBottom,drawn-<tool>,all,selected-<tool>,styled-<tool>,reloaded,timeframe}-{desktop,narrow}.png + drawing-channels-checks-{desktop,narrow}.txt (the parallel channel, regression trend, flat top/bottom and disjoint channel: draw each by clicks, drag then click or taps with a live preview, Escape cancels, move, resize by a handle, restyle (the regression source and deviation), undo and redo, reload and a timeframe change)
npm run -s e2e:capture -- drawing-patterns # docs/evidence/drawing-patterns/drawing-patterns-{preview-xabcdPattern,drawn-<tool>,all,selected-<tool>,styled-<tool>,reloaded,timeframe}-{desktop,narrow}.png + drawing-patterns-checks-{desktop,narrow}.txt (the XABCD, Cypher, ABCD, Head and shoulders, Triangle pattern and Three drives patterns: place each point by point by clicks, drag then click or taps with a live preview, Escape cancels, move, drag a handle, restyle (line width and the ratio switch or the fill), undo and redo, reload and a timeframe change)
npm run -s e2e:capture -- drawing-elliott # docs/evidence/drawing-elliott/drawing-elliott-{preview-elliottImpulse,drawn-<tool>,all,selected-<tool>,styled-<tool>,reloaded,timeframe}-{desktop,narrow}.png + drawing-elliott-checks-{desktop,narrow}.txt (the five Elliott wave tools: place each point by point by clicks or taps with a live preview, Escape cancels, move, drag a handle, change the Wave degree and line width, undo and redo, reload and a timeframe change)
npm run -s e2e:capture -- drawing-cycles   # docs/evidence/drawing-cycles/drawing-cycles-{preview-sineLine,drawn-<tool>,all,selected-<tool>,styled-<tool>,reloaded,timeframe,zoomed-out}-{desktop,narrow}.png + drawing-cycles-checks-{desktop,narrow}.txt (Cyclic lines, Time cycles and Sine line: placed by clicks, press-drag-release or taps with a live preview, Escape cancels, move, drag a handle, restyle, undo and redo, reload, a timeframe change and zoom out)
npm run -s e2e:capture -- drawing-volume   # docs/evidence/drawing-volume/drawing-volume-{flyout,preview-fixedRangeVolumeProfile,drawn-<tool>,selected-<tool>,styled-<tool>,redone-<tool>,reloaded,timeframe,zoomed-out}-{desktop,narrow}.png + drawing-volume-checks-{desktop,narrow}.txt (Anchored VWAP, Fixed range volume profile and Anchored volume profile: placed by a click, press-drag-release or taps with a live preview, move, restyle, undo and redo, reload, a timeframe change and zoom out)
npm run -s e2e:capture -- drawing-fib      # docs/evidence/drawing-fib/drawing-fib-{preview-fibCircles,placing-fibCircles,drawn-<tool>,all,selected-<tool>,styled-<tool>,reloaded,timeframe}-{desktop,narrow}.png + drawing-fib-checks-{desktop,narrow}.txt (the five Fibonacci tools: drawn with a live preview, selected, resized, restyled, undo and redo, reload and a timeframe change)
npm run -s e2e:capture -- drawing-gann     # docs/evidence/drawing-gann/drawing-gann-{preview-gannSquareFixed,placing-gannSquareFixed,drawn-<tool>,all,selected-<tool>,styled-<tool>,reloaded,timeframe}-{desktop,narrow}.png + drawing-gann-checks-{desktop,narrow}.txt (the four Gann tools: drawn with a live preview, selected, resized, restyled, undo and redo, reload and a timeframe change)
npm run -s e2e:capture -- drawing-fib-trend # docs/evidence/drawing-fib-trend/drawing-fib-trend-{preview-fibExtension,placing-<tool>,drawn-<tool>,all,selected-<tool>,styled-<tool>,reloaded,timeframe}-{desktop,narrow}.png + drawing-fib-trend-checks-{desktop,narrow}.txt (the three-point Fibonacci tools: drawn with a live preview, selected, resized, restyled, undo and redo, reload and a timeframe change)
npm run -s e2e:capture -- drawing-shapes # docs/evidence/drawing-shapes/drawing-shapes-{preview-<tool>,preview-brush,preview-highlighter,drawn-<tool>,drawn-brushes,selected-brush,styled-brushes,placing-path,backspace-path,selected-both,styled-both,all,selected-circle,selected-arrowMarker,selected-<new shape>,styled-new,settings-<mark>,styled-arrowMarker,reloaded,timeframe}-{desktop,narrow}.png + drawing-shapes-checks-{desktop,narrow}.txt (Circle, Arrow, Arrow marker, Arrow mark up and down, Rotated rectangle, Ellipse, Triangle, Arc, Curve, Double curve, Path and Polyline, Brush and Highlighter: draw each by clicks, press-drag-release or taps with a live preview, check an arrow mark is on a bar time and stays on one when dragged sideways, resize and move the circle by its handles, select each new shape and drag one handle (width, vertex, bulge, control point), restyle the ellipse and the double curve, set a label on the marker and the marks in settings, place a Path (ended by double-click or double tap, or Enter) and a Polyline (closed on its first point) with Backspace and Escape, drag a point or the body, draw a Brush and a Highlighter freehand with a mid-stroke preview (a touch press-drag on narrow), move one by its body, set smoothing and width, undo and redo, reload and a timeframe change)
npm run -s e2e:capture -- drawing-pitchforks # docs/evidence/drawing-pitchforks/drawing-pitchforks-{preview-pitchfork,placing-<tool>,drawn-<tool>,all,selected-<tool>,styled-<tool>,reloaded,timeframe}-{desktop,narrow}.png + drawing-pitchforks-checks-{desktop,narrow}.txt (the Pitchfork, Schiff, Modified Schiff and Inside pitchforks: draw each by clicks, drag then click or taps with a live preview, Escape cancels, move, resize by a handle, restyle (a level on and recoloured, Background off, the Style choice), undo and redo, reload and a timeframe change)
npm run -s e2e:capture -- drawing-manage # docs/evidence/drawing-manage/drawing-manage-{menu,locked,rename,menu-named,ctrl-drag,front,back,empty-menu,multi-selected,box,multi-menu,multi-moved,pasted-other-chart,tree,tree-hidden,tree-drag,tree-deleted,tree-other-chart}-{desktop,narrow}.png + drawing-manage-checks-{desktop,narrow}.txt (right-click menu on a trend line, lock and a refused drag, rename, clone, Ctrl+drag clone as one undo step, bring to front and send to back of two rectangles, the empty-chart menu with Paste and Remove drawings, Shift+click and a Shift+drag box selecting several drawings to move, lock, order, copy, paste and delete together, copy and paste onto a second chart showing another symbol)
npm run -s e2e:capture -- drawing-settings # docs/evidence/drawing-settings/drawing-settings-{dialog,styled-dialog,styled,undone,reloaded,preview,coordinates,fib-dialog,fib,default-applied,visibility,hidden-days,shown-hours}-desktop.png + drawing-settings-{dialog,visibility}-narrow.png (360 px) + drawing-settings-{checks,payload}-desktop.txt + drawing-settings-checks-narrow.txt (double-click a trend line, set colour, width, dashed and extend right, OK as one undo step, undo, redo, reload, Cancel and Escape restore, the Coordinates tab, a Fibonacci level and background, Save as default, Visibility on days and hours; writes the stored v2 payload)
npm run -s e2e:capture -- drawing-rail       # docs/evidence/drawing-rail/drawing-rail-{rail,flyout-<family>,keyboard,last-tool,favorites,bar-dragged,cursor-{cross,dot,arrow},eraser-hover,eraser-erased}-desktop.png + drawing-rail-{menu,menu-lines,favorites}-narrow.png + drawing-rail-checks-{desktop,narrow}.txt (family buttons and flyouts, keyboard, long press, last tool and favourites kept across a reload, the draggable favourites bar, cursor kinds, the eraser with undo, the phone menu sections)
npm run -s e2e:capture -- layouts            # docs/evidence/layouts/layouts-{picker,grid-2x2,active,large-plus-3,dragged,reloaded,sixteen,sync-picker,sync-interval,sync-crosshair,sync-reloaded,menu,rename,switched,open-dialog,unsaved,named-reloaded}-desktop.png + layouts-{picker,switcher,switcher-menu,picker-open,menu}-narrow.png + layouts-checks-{desktop,narrow}.txt (the picker with its 55 arrangements, four markets in a 2x2 grid, the active chart, a dragged divider, the layout after a reload, the Sync in layout switches (interval synced across a 2x2 grid, the synced crosshair, the switches after a reload), the narrow switcher, and the named layouts menu: rename, copy, switching, the open-layout dialog, the unsaved marker with autosave off, the last layout back after a reload)
npm run -s e2e:capture -- built-timeframe   # docs/evidence/built-timeframe/built-timeframe-{chart,live,picker,setting-on}-desktop.png and built-timeframe-{chart,setting-off,setting-on}-narrow.png (Coinbase 4h built from 1h on the fake upstream, Live on with the last bar updating, built options marked; the Build setting off and on)
npm run -s e2e:capture -- custom-timeframe  # docs/evidence/custom-timeframe/custom-timeframe-{picker-entry,refused,added,live,reloaded,removed}-{desktop,narrow}.png (Coinbase on the fake upstream: the Custom intervals dialog refuses 2000 minutes, adds 2 hours built from 1h, charts it live, keeps it across a reload and removes it)
npm run -s e2e:capture -- bt-range              # docs/evidence/bt-range/bt-range-{no-range,before-run,range,chart-range,from-after-to}-{desktop,narrow}.png (the range run loads the older history first and moves the chart to it)
npm run -s e2e:capture -- bt-progress           # docs/evidence/bt-progress/bt-progress-{backtest-tab,results-tab,finished}-{desktop,narrow}.png (the progress bar mid-run under the Run button and in the Results tab, then the finished state; the page holds the worker messages back at about 40% so the bar can be shot)
npm run -s e2e:capture -- optimizer             # docs/evidence/optimizer/optimizer-{slow-sweep,split-settings,held-out-check,split-invalid,walk-forward-settings,walk-forward-results,walk-forward-anchored,walk-forward-refused,results-sorted,fractional-step,over-limit,robustness-settings,robustness-results,robustness-heatmap,monte-carlo-settings,monte-carlo-results,monte-carlo-sorted,three-parameters,paging}-{desktop,narrow}.png
npm run -s e2e:capture -- bt-results            # docs/evidence/bt-results/bt-results-{equity,tip-card,tip-row,breakdown,streaks,exit-reasons}-{desktop,narrow}.png (Results tab: equity legend, a hovered card in the right-most column and a keyboard-focused Long vs short row each showing their tooltip inside the viewport, then long vs short, streaks and exit reasons with Allow short, stop loss and take profit on)
npm run -s e2e:capture -- monte-carlo        # docs/evidence/monte-carlo/monte-carlo-{shuffle,resample,histogram,invalid}-{desktop,narrow}.png (the Results tab's Monte Carlo panel: 1000 shuffled runs, resampled trades, and Runs below 100 with the button disabled)
npm run -s e2e:capture -- conn-status           # docs/evidence/conn-status/conn-status-{closed,open}-{desktop,narrow}.png (stubbed /api/status)
npm run -s e2e:capture -- network-audit         # docs/evidence/network-audit/network-audit-{provider-<id>,timeframe,search,live-coinbase,watchlist,live,status}-desktop.png + network-audit-requests-desktop.txt (also fails if a daily quote URL is requested more than 1 + floor(seconds / 60) times)
npm run -s e2e:capture -- watchlist             # docs/evidence/watchlist/watchlist-{quotes,card,initial,with-section,after-drag,pinned-card}-desktop.png + a desktop webm (rows with Last, Chg, Chg% and the symbol card)
npm run -s e2e:capture -- outage                # docs/evidence/outage/outage.webm (+ .gif) and outage-{live,outage,recovered}-desktop.png
npm run -s e2e:capture -- zone-clock            # docs/evidence/zone-clock/zone-clock-{clock,list,filtered,tehran}-{desktop,narrow}.png
npm run -s e2e:capture -- pine-security        # docs/evidence/pine-security/pine-security-{daily-ema,declared-timeframe,other-symbol}-desktop.png (a script reading the daily EMA with request.security, one declaring timeframe="D" with timeframe_gaps=false (both step once a day), then one plotting request.security("BYBIT:ETHUSDT", "", close) under the Binance chart, checking the fake upstream got a Bybit kline request)
npm run -s e2e:capture -- pine-pane            # docs/evidence/pine-pane/pine-pane-{editor,error,reopened,resized,messages,inputs,inputs-more,empty}-{desktop,narrow}.png
npm run -s e2e:capture -- pine-drawings    # docs/evidence/pine-drawings/pine-drawings-{overlay,clicked,pane,labels,labels-scrolled,labels-tooltip,labels-pane}-{desktop,narrow}.png (a script drawing lines, boxes, polylines and a linefill on the candles, a click on a Pine line selecting nothing, and an overlay=false script drawing in its own pane with one force_overlay box on the candles; labels in several styles and a top-right table on the candles, the table at the same pixels after the chart is scrolled, a label tooltip on hover with a click on the label selecting nothing, and an overlay=false script drawing a table and a label in its pane with one force_overlay label on the candles)
npm run -s e2e:capture -- pine-render         # docs/evidence/pine-render/pine-render-{pane,overlay,fill-band,fill-cloud,candles,plot-styles,plot-chars,bar-colors,bar-colors-off}-{desktop,narrow}.png (Pine shapes, fills, custom candles, barcolor, and plot options: width, offset, step, area, columns, shape text, plotchar characters, hline styles)
npm run -s e2e:capture -- pine-convert        # docs/evidence/pine-convert/pine-convert-{legacy,converted}-{desktop,narrow}.png
npm run -s e2e:capture -- pine-libraries    # docs/evidence/pine-libraries/pine-libraries-{fetched,missing,dialog,pasted,removed}-{desktop,narrow}.png (a script importing an open-source library from the fake TradingView runs, a closed-source one shows the error and Paste library, pasting it makes the script run, Remove brings the error back)
npm run -s e2e:capture -- compare             # docs/evidence/compare/compare-{empty,two,four,reference,reloaded}-{desktop,narrow}.png + compare-requests-{desktop,narrow}.txt + compare-typing-{desktop,narrow}.txt (the /compare page: folded unchanged lines, inline edits, a fold opened by a click; proves it requests no market data; typing 20 characters in a 1000-line script in four panes at 6x CPU throttling records its long tasks and fails over 50 ms after the first)
npm run -s e2e:capture -- replay              # docs/evidence/replay/replay-{before,picking,start,stepped,played,repick,restarted,exited}-{desktop,narrow}.png + a desktop webm
npm run -s e2e:capture -- pane-resize         # docs/evidence/pane-resize/pane-resize-{seeded,dragged,sidebar-focus,sidebar-max,dock-max,dock-collapsed,reset,small-window,small-window-max}-desktop.png + pane-resize-checks-desktop.txt + pane-resize.webm
npm run -s e2e:capture -- responsive        # docs/evidence/responsive/responsive-{360x740,768x1024,1024x768,1920x1080,740x360,drawer-360,drawer-768,more-360,csv-360,inbox-360}-desktop.png + responsive-checks-desktop.txt
npm run -s e2e:capture -- ui-audit           # docs/evidence/ui-audit/ui-audit-{console,requests,leaks,layout,a11y,stack,races,states}-{desktop,narrow}.txt + screenshots of each state (research audit, see docs/spikes/ui-audit/README.md; about 2.5 minutes)
npm run -s e2e:capture -- chart --slug my-fix   # everything goes to docs/evidence/my-fix/
```

Usage: `npm run e2e:capture -- <scenario> [<scenario>...] [--slug <slug>]`. Use `-s` so npm prints no banner;
the command then prints one path per written file and nothing else, and exits 0.
An unknown or missing scenario exits non-zero and lists the known names.

What it does: builds the client, starts the fake market-data service (see "Fake market data" below), then `server/index.mjs` on a free port bound to 127.0.0.1, waits for
`/api/health`, runs each scenario in headless Chromium, then stops the browser and the server. A failing
step exits non-zero within about 15 s with `e2e:capture: scenario "<name>" step "<step>" failed: <reason>`.

The dev container image ships Chromium at `/ms-playwright` (via `PLAYWRIGHT_BROWSERS_PATH`) at the pinned
Playwright version (`playwright` is pinned to 1.64.1, nothing is downloaded on `npm ci`).
On a machine outside the container, run `npx playwright install --with-deps chromium`.

Troubleshooting a failed browser launch: `error while loading shared libraries: <lib>` means the container
predates the Chromium image change (rebuild it) or, outside it, that the system libraries are missing (run the
`--with-deps` install above). `Executable doesn't exist` means the browser download is missing
(`npx playwright install chromium`).

## Fake market data, offline

Most captures run on the Demo provider. Each scenario starts with `localStorage` seeded
(`vost.prefs.v1` = `{ "providerId": "demo", "symbol": "DEMO", "timeframe": "1d" }`).

The remote providers are served by a fake market-data service in `e2e/fake-upstream/`. `npm run e2e:capture` always
starts it before the server and passes the server `VOST_TEST_UPSTREAM=http://127.0.0.1:<port>`, so a capture never
reaches the real network from the server either. With that setting the server rewrites every outbound REST and
websocket URL to the fake, keeping the original scheme and host in the path:
`https://api.binance.com/api/v3/klines?x` becomes `http://127.0.0.1:<port>/https/api.binance.com/api/v3/klines?x`
and `wss://stream.binance.com:9443/ws/a` becomes `ws://127.0.0.1:<port>/wss/stream.binance.com:9443/ws/a`
(`server/testUpstream.ts`). Unset, URLs are untouched, which is the production path.

- The fake answers in each provider's real format: history, symbols and search for all 8 providers (Binance on both
  hosts, Coinbase, Kraken, Bybit, OKX, Hyperliquid Perps, Hyperliquid Spot, Yahoo) and a new live kline at least every second (a changing close) on
  the seven live feeds, including their subscribe and ping messages (Coinbase sends trades, `last_match` then `match`,
  priced at the fake forming bar, and the server builds the candle). It records every request it served (with method and body for a POST). It also answers Telegram's
  `sendMessage`, and the capture runner turns Telegram on with a test token, so a fired alert sends to the fake only.
- `stop()` closes the listener and terminates every open socket, so new connects are refused; `start()` listens again
  on the same port. A scenario reaches both through `ctx.upstream` (see `outage`).
- The setting is for tests only. With `NODE_ENV=production` (the Docker image sets it) the server prints an error naming
  `VOST_TEST_UPSTREAM` and exits non-zero before it listens, and it refuses any value that is not an `http://` loopback URL.
- `e2e/fake-upstream/fake-upstream.test.ts` (in `npm test`) runs every real adapter and live feed against the fake,
  including `stop()` and `start()`.

The browser may only reach the Vost server. The runner aborts every other request (http(s) and websocket; `data:` and
`blob:` excepted), and **any aborted request fails the scenario**, listing the URLs. `network-audit` walks every remote
provider in the UI and writes every URL the browser requested, with counts, to `network-audit-requests-desktop.txt`;
`outage` stops the fake while live data is on and shows the app recovering without a reload.

## Add a scenario

Create `e2e/capture/scenarios/<name>.ts` exporting a `Scenario`, and add it to the list in
`e2e/capture/scenarios/index.ts`:

```ts
import type { Scenario } from '../scenario.ts';

export const myScenario: Scenario = {
  name: 'my-scenario',
  description: 'What it shows',
  viewports: ['desktop', 'narrow'], // default: desktop (1440x900); narrow is 390x844
  video: false,                      // true records a WebM at desktop size
  async run(ctx) {
    await ctx.step('open app', () => ctx.page.goto('/'));
    await ctx.waitForChart();
    await ctx.screenshot('detail'); // writes my-scenario-detail-desktop.png (<scenario>-<name>-<viewport>.png)
  },
};
```

`ctx` gives `page`, `step(label, fn)` (wraps failures with the scenario and step name), `screenshot(name?)`,
`waitForChart()`, `upstream` (`stop()` / `start()` of the fake market data), `requests` (every URL the browser asked
for) and `writeText(name, text)` (writes `<scenario>-<name>-<viewport>.txt`). Keep the scripts to erasable TypeScript syntax (Node runs them with type stripping). Check types
with `npx tsc -p e2e` (not part of the typecheck gate).

## Use captures in a PR

This repo's route is to commit the captures under `docs/evidence/<slug>/` and link them in the PR body by
commit-pinned raw URL. The evidence upload tool is not used here.

```
![chart on desktop](https://github.com/cbundy/Vost/blob/<sha>/docs/evidence/<slug>/<file>.png?raw=true)
[chart pan video](https://github.com/cbundy/Vost/blob/<sha>/docs/evidence/<slug>/<file>.webm?raw=true)
```

Images use `![description](<url>)`; videos are a plain link.
