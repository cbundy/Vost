# Contributing to Vost

Thanks for helping out! This document covers everything you need to get productive quickly.

## Setup

```bash
git clone https://github.com/cbundy/Vost.git
cd Vost
npm install
npm run dev      # server on :8787, Vite dev server on :5173 (open this one)
```

Useful scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Node API server (watch mode) + Vite dev server with HMR |
| `npm test` | Vitest unit + integration tests |
| `npm run typecheck` | Strict typecheck of the whole client |
| `npm run build` | Typecheck + production bundle into `client/dist` |
| `npm start` | Serve the production build on :8787 |
| `npm run -s e2e:capture -- <scenario>` | Screenshots/video into `docs/evidence` (see `docs/e2e-visual-verification.md`) |

## Project layout

| Path | Contents |
|---|---|
| `client/src/components/` | React UI (chart panel, top bar, dock, CSV modal, …) |
| `client/src/state/store.ts` | zustand store — owns data, indicators, datasets, backtest lifecycle |
| `client/src/lib/providers/` | Provider registry (built from the catalog), `/api` client, live feeds, demo |
| `client/src/lib/csv.ts` | The CSV dialect-detection engine |
| `client/src/lib/indicators.ts` | Indicator math (pure functions, easy to test) |
| `client/src/lib/backtest/` | Engine, metrics, strategies, optimizer, custom-code runner |
| `client/src/lib/workers/` | Web Worker entry point for backtests/optimization |
| `server/index.mjs`, `server/main.ts` | Zero-dependency Node server (static files + the `/api` routes) |
| `server/providers/` | One REST adapter per data provider (runs on the server) |
| `shared/` | Wire types and the provider catalog, imported by both server and client |
| `examples/` | Sample CSVs for the importer |

## Adding a data provider

The server fetches every remote provider's data; the browser only calls `/api/*`. A provider has
three parts:

1. A server adapter, `server/providers/myprovider.ts`. The server is TypeScript that Node runs by type
   stripping, so use erasable syntax only (no enums, namespaces or constructor parameter properties),
   import relative files with their `.ts` extension, and import only `node:` built-ins and `shared/`.

```ts
import type { Candle } from '../../shared/market.ts';
import { NotFoundError } from './errors.ts';
import type { ProviderAdapter } from './types.ts';
import { upstreamJson } from './upstream.ts';

export const myAdapter: ProviderAdapter = {
  id: 'myprovider',

  async history(ctx, req) {
    const url = `https://api.example.com/ohlcv?symbol=${encodeURIComponent(req.symbol)}`;
    const rows = await upstreamJson<Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>>('My Provider', url, ctx);
    const candles: Candle[] = rows.map((r) => ({ time: Math.floor(r.t / 1000), open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
    if (candles.length === 0) throw new NotFoundError(`No data returned for ${req.symbol}.`);
    return candles;
  },

  async search(ctx, query) {
    return [];
  },
};
```

   `upstreamJson` / `upstreamText` add the user-agent, retries and the timeout, and raise an `UpstreamError`
   (which the API turns into a 502 naming the provider). Take the fetch from `ctx` so tests can inject a fake.
   Register the adapter in `server/providers/index.ts`.

2. A catalog entry in `shared/providerCatalog.ts` (id, name, description, timeframes, default symbol and
   timeframe, popular symbols, `supportsLive`, `hasSymbolList`, `hasSearch`). The client builds its provider
   from it, so the UI picks it up automatically. The catalog holds no host name.

3. Only if the exchange has a public candle websocket (until the server takes streaming over): its feed in
   `client/src/lib/providers/liveFeeds.ts`, registered in `LIVE_FEEDS`, with `supportsLive: true` in the catalog.
   `supportsLive` must be true exactly when a feed exists.

Add unit tests for the adapter in `server/providers/` with an injected fake fetch (see `exchanges.test.ts`);
no test may touch the network.

## Adding a built-in strategy

Open `client/src/lib/backtest/strategies.ts` and add a `StrategyDef`:

```ts
const myStrategy: StrategyDef = {
  id: 'my_strategy',
  name: 'My strategy',
  description: 'Long while close > SMA(200).',
  params: [{ key: 'length', label: 'Length', type: 'int', default: 200, min: 1, max: 2000 }],
  build(candles, p) {
    const closes = candles.map((c) => c.close);
    const avg = sma(closes, Math.round(p.length ?? 200));
    return closes.map((c, i) => (avg[i] == null ? null : c > (avg[i] as number) ? 1 : 0));
  },
};
```

Then append it to the `strategies` array. Rules:

- **No look-ahead**: signal at index `i` may only use data up to `i`. The engine fills at bar `i + 1`'s open.
- Return `Signal[]` — `1` long, `0` flat, `-1` short, `null` warm-up.
- Keep the computation linear (`O(n)`) — strategies run inside the optimizer grid too.
- Add a test in `client/src/lib/backtest/engine.test.ts` (the "runs every built-in strategy" test covers new ones automatically).

## Tests & style

- `npm test` must pass; add tests for new pure logic (indicators, CSV parsing, engine behavior, metrics).
- TypeScript strict mode; no `any` unless there's a good reason (worker boundaries).
- Keep components small; state lives in `state/store.ts`, not scattered across components.
- Prettier-ish formatting: 2-space indent, single quotes, ~120 col width. Match the surrounding code.
- Comments explain *why*, not *what*.

## Commit & PR flow

1. Fork, branch (`feat/drawing-tools`, `fix/csv-day-first`).
2. Conventional commit messages (`feat:`, `fix:`, `docs:`, `refactor:` …) are appreciated.
3. Make sure `npm run typecheck && npm test && npm run build` pass.
4. Open a PR describing the change, with a screenshot for UI work (see `docs/e2e-visual-verification.md`).

## Reporting bugs

Please include:

- Vost version / commit (the version is in the top bar, in `GET /api/health` and in the server startup log)
- Browser + OS
- Steps to reproduce (provider & symbol if data-related — or attach a CSV row sample)
- Expected vs. actual result, console errors if any

## Code of conduct

Be kind, be constructive. We're all here to build something useful.
