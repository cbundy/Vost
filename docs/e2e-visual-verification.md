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
npm run -s e2e:capture -- zone-clock            # docs/evidence/zone-clock/zone-clock-{clock,list,filtered,tehran}-{desktop,narrow}.png
npm run -s e2e:capture -- chart --slug my-fix   # everything goes to docs/evidence/my-fix/
```

Usage: `npm run e2e:capture -- <scenario> [<scenario>...] [--slug <slug>]`. Use `-s` so npm prints no banner;
the command then prints one path per written file and nothing else, and exits 0.
An unknown or missing scenario exits non-zero and lists the known names.

What it does: builds the client, starts `server/index.mjs` on a free port bound to 127.0.0.1, waits for
`/api/health`, runs each scenario in headless Chromium, then stops the browser and the server. A failing
step exits non-zero within about 15 s with `e2e:capture: scenario "<name>" step "<step>" failed: <reason>`.

The dev container image ships Chromium at `/ms-playwright` (via `PLAYWRIGHT_BROWSERS_PATH`) at the pinned
Playwright version (`playwright` is pinned to 1.64.1, nothing is downloaded on `npm ci`).
On a machine outside the container, run `npx playwright install --with-deps chromium`.

## Demo data, offline

Every capture runs offline on the Demo provider. Each scenario starts with `localStorage` seeded
(`vost.prefs.v1` = `{ "providerId": "demo", "symbol": "DEMO", "timeframe": "1d" }`), and the browser aborts any
request whose host is not the local server, so captures are deterministic and need no network.

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

`ctx` gives `page`, `step(label, fn)` (wraps failures with the scenario and step name), `screenshot(name?)` and
`waitForChart()`. Keep the scripts to erasable TypeScript syntax (Node runs them with type stripping). Check types
with `npx tsc -p e2e` (not part of the typecheck gate).

## Use captures in a PR

This repo's route is to commit the captures under `docs/evidence/<slug>/` and link them in the PR body by
commit-pinned raw URL. The evidence upload tool is not used here.

```
![chart on desktop](https://github.com/cbundy/Vost/blob/<sha>/docs/evidence/<slug>/<file>.png?raw=true)
[chart pan video](https://github.com/cbundy/Vost/blob/<sha>/docs/evidence/<slug>/<file>.webm?raw=true)
```

Images use `![description](<url>)`; videos are a plain link.
