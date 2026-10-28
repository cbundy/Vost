# E2E visual verification

`npm run e2e:capture` takes screenshots and videos of the running app as evidence for UI changes.
It is not a test suite: it is in no gate and must never run from CI or a gate command.

## Run it

```bash
npm ci
npm run -s e2e:capture -- chart                 # docs/evidence/chart/chart-desktop.png, chart-narrow.png
npm run -s e2e:capture -- chart-pan             # docs/evidence/chart-pan/chart-pan.webm (+ .gif if ffmpeg is on PATH)
npm run -s e2e:capture -- chart-reset           # docs/evidence/chart-reset/{fresh,moved,reset}.png + chart-reset.webm
npm run -s e2e:capture -- chart-range          # docs/evidence/chart-range/chart-range-{before,applied,refused,fetched,cleared}-{desktop,narrow}.png
npm run -s e2e:capture -- bt-range              # docs/evidence/bt-range/bt-range-{no-range,range,from-after-to}-{desktop,narrow}.png
npm run -s e2e:capture -- conn-status           # docs/evidence/conn-status/conn-status-{closed,open}-{desktop,narrow}.png (stubbed /api/status)
npm run -s e2e:capture -- network-audit         # docs/evidence/network-audit/network-audit-{provider-<id>,timeframe,search,watchlist,live,status}-desktop.png + network-audit-requests-desktop.txt
npm run -s e2e:capture -- outage                # docs/evidence/outage/outage.webm (+ .gif) and outage-{live,outage,recovered}-desktop.png
npm run -s e2e:capture -- zone-clock            # docs/evidence/zone-clock/zone-clock-{clock,list,filtered,tehran}-{desktop,narrow}.png
npm run -s e2e:capture -- pine-tab             # docs/evidence/pine-tab/pine-tab-{sidebar-edit,editor,error,collapsed-edit,empty}-{desktop,narrow}.png
npm run -s e2e:capture -- pine-convert        # docs/evidence/pine-convert/pine-convert-{legacy,converted}-{desktop,narrow}.png
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

- The fake answers in each provider's real format: history, symbols and search for all 7 providers (Binance on both
  hosts, Coinbase, Kraken, Bybit, OKX, Yahoo, Stooq) and a new live kline at least every second (a changing close) on
  the four live feeds, including their subscribe and ping messages. It records every request it served.
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
