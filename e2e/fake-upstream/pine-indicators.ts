/**
 * TradingView's indicator side, as the Vost server calls it:
 * `www.tradingview.com/pubscripts-suggest-json/` (search, no `type=3`),
 * `www.tradingview.com/script/<shortId>/` (the script page) and
 * `pine-facade.tradingview.com/pine-facade/get/<id>/last` (source).
 * Serves an open-source Supertrend with a licence comment, a closed-source one and a strategy.
 */

export const OPEN_INDICATOR_ID = 'PUB;fake-supertrend';
export const OPEN_INDICATOR_SHORT_ID = 'SuperTr1';
export const CLOSED_INDICATOR_ID = 'PUB;fake-supertrend-pro';
export const CLOSED_INDICATOR_SHORT_ID = 'SuperPr2';
export const STRATEGY_ID = 'PUB;fake-supertrend-strategy';
export const STRATEGY_SHORT_ID = 'SuperSt3';

export const OPEN_INDICATOR_SOURCE = `// This Pine Script(R) code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/
// (c) alice
//@version=5
indicator("Supertrend", overlay=true)
factor = input.float(3.0, "Factor")
len = input.int(10, "ATR Length")
[st, dir] = ta.supertrend(factor, len)
plot(st, "Supertrend", color = dir < 0 ? color.green : color.red)
`;

export const STRATEGY_SOURCE = `//@version=5
strategy("Supertrend Strategy", overlay=true)
[st, dir] = ta.supertrend(3.0, 10)
if ta.change(dir) < 0
    strategy.entry("Long", strategy.long)
`;

interface Script {
  name: string;
  id: string;
  shortId: string;
  kind: 'study' | 'strategy';
  /** Absent for a closed-source script. */
  source?: string;
  plots: number;
}

const SCRIPTS: Script[] = [
  { name: 'Supertrend', id: OPEN_INDICATOR_ID, shortId: OPEN_INDICATOR_SHORT_ID, kind: 'study', source: OPEN_INDICATOR_SOURCE, plots: 1 },
  { name: 'Supertrend Pro', id: CLOSED_INDICATOR_ID, shortId: CLOSED_INDICATOR_SHORT_ID, kind: 'study', plots: 2 },
  { name: 'Supertrend Strategy', id: STRATEGY_ID, shortId: STRATEGY_SHORT_ID, kind: 'strategy', source: STRATEGY_SOURCE, plots: 1 },
];

interface Reply {
  status?: number;
  type?: string;
  body: unknown;
}

/** Search without `type=3`: studies and strategies (libraries are the other fake's). */
export function indicatorSearch(url: URL): Reply {
  const term = (url.searchParams.get('search') ?? '').toLowerCase();
  const results = SCRIPTS.filter((s) => s.name.toLowerCase().includes(term)).map((s) => ({
    scriptName: s.name,
    author: { username: 'alice' },
    version: '3',
    scriptIdPart: s.id,
    imageUrl: s.shortId,
    type: 1,
    access: s.source ? 1 : 3,
    extra: { kind: s.kind, stats: { plot: s.plots } },
  }));
  return { body: { results, next: null } };
}

/** `/script/<shortId>/`: another `PUB;` id comes first, the script's own is in the `"script"` object. */
export function scriptPage(url: URL): Reply {
  const m = /^\/script\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
  const script = m && SCRIPTS.find((s) => s.shortId === m[1]);
  if (!script) return { status: 404, type: 'text/html; charset=utf-8', body: '<html><body>Script not found</body></html>' };
  const page = `<html><head><title>${script.name}</title></head><body>
<script type="application/json">{"related":[{"script_id_part":"PUB;fake-related-other","name":"Another script"}]}</script>
<script type="application/json">{"script":{"script_id_part":${JSON.stringify(script.id)},"script_name":${JSON.stringify(script.name)},"author":{"username":"alice"}},"other":{"script_id_part":"PUB;fake-later"}}</script>
</body></html>`;
  return { type: 'text/html; charset=utf-8', body: page };
}

/** `/pine-facade/get/<id>/last`. */
export function indicatorFacade(url: URL): Reply {
  const m = /^\/pine-facade\/get\/([^/]+)\/last$/.exec(url.pathname);
  if (!m) return { status: 404, body: { error: `the fake upstream has nothing at ${url.pathname}` } };
  const script = SCRIPTS.find((s) => s.id === decodeURIComponent(m[1]));
  if (!script) return { body: { reason: 'Script is not found.', success: false } };
  if (!script.source) return { body: { scriptName: script.name, scriptAccess: 'closed_no_auth', version: '3.0' } };
  return { body: { source: script.source, scriptAccess: 'open_no_auth', scriptName: script.name, version: '3.0' } };
}
