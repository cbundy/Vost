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
| `client/src/lib/providers/` | Data providers (`DataProvider` implementations) |
| `client/src/lib/csv.ts` | The CSV dialect-detection engine |
| `client/src/lib/indicators.ts` | Indicator math (pure functions, easy to test) |
| `client/src/lib/backtest/` | Engine, metrics, strategies, optimizer, custom-code runner |
| `client/src/lib/workers/` | Web Worker entry point for backtests/optimization |
| `server/index.mjs` | Zero-dependency Node server (static + whitelisted proxy) |
| `examples/` | Sample CSVs for the importer |

## Adding a data provider

1. Create `client/src/lib/providers/myprovider.ts`:

```ts
import type { Candle } from '../../types';
import { fetchJson, type DataProvider, type HistoryRequest } from './http';

export const myProvider: DataProvider = {
  id: 'myprovider',
  name: 'My Provider',
  description: 'Free data from example.com, no key needed.',
  needsProxy: true,                 // upstream sends no CORS headers
  timeframes: ['1d'],
  defaultTimeframe: '1d',
  defaultSymbol: 'AAPL',
  popularSymbols: [{ symbol: 'AAPL', label: 'Apple', exchange: 'NASDAQ' }],

  async fetchHistory(req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]> {
    const url = `https://api.example.com/ohlcv?symbol=${encodeURIComponent(req.symbol)}`;
    const rows = await fetchJson<Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>>(url, { signal });
    return rows.map((r) => ({ time: Math.floor(r.t / 1000), open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
  },
};
```

   For realtime candles also set `supportsLive: true` and implement `startLive(opts)`, which opens a websocket
   and returns a `{ stop() }` handle (see `lib/liveSocket.ts` for a reconnecting helper). Leave both out if the
   upstream has no candle stream; `supportsLive` must be true exactly when `startLive` exists.

2. Register it in `client/src/lib/providers/index.ts` (add to the `providers` array).
3. If the upstream needs a new host, add that hostname to `ALLOWED_HOSTS` in `server/index.mjs`.
4. Add a unit test for any parsing logic — see `client/src/lib/csv.test.ts` for the pattern.

`fetchJson`/`fetchText` route through the proxy automatically and fall back to direct fetches, so providers work in both deployment modes.

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

- Vost version / commit
- Browser + OS
- Steps to reproduce (provider & symbol if data-related — or attach a CSV row sample)
- Expected vs. actual result, console errors if any

## Code of conduct

Be kind, be constructive. We're all here to build something useful.
