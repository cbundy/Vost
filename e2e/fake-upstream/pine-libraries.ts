/**
 * TradingView's two library endpoints, as the Vost server calls them:
 * `www.tradingview.com/pubscripts-suggest-json/` (search) and
 * `pine-facade.tradingview.com/pine-facade/get/<id>/<version>` (source).
 * Serves one open-source library that imports a second one, and one closed-source library.
 */

export const OPEN_LIB_PATH = 'alice/OpenLib/1';
export const NESTED_LIB_PATH = 'alice/NestedLib/1';
export const CLOSED_LIB_PATH = 'alice/ClosedLib/1';

export const NESTED_LIB_SOURCE = `//@version=6
library("NestedLib")
export double(float x) => x * 2
`;

export const OPEN_LIB_SOURCE = `//@version=6
library("OpenLib")
import alice/NestedLib/1 as nested
export smooth(float src, int len) => nested.double(ta.sma(src, len)) / 2
`;

/** What a user pastes for the closed-source library. */
export const CLOSED_LIB_SOURCE = `//@version=6
library("ClosedLib")
export mid(float a, float b) => (a + b) / 2
`;

interface Script {
  name: string;
  id: string;
  /** Absent for a closed-source library. */
  source?: string;
}

const SCRIPTS: Script[] = [
  { name: 'OpenLib', id: 'PUB;fake-open', source: OPEN_LIB_SOURCE },
  { name: 'NestedLib', id: 'PUB;fake-nested', source: NESTED_LIB_SOURCE },
  { name: 'ClosedLib', id: 'PUB;fake-closed' },
];

interface Reply {
  status?: number;
  body: unknown;
}

export function tradingViewSearch(url: URL): Reply {
  if (url.pathname !== '/pubscripts-suggest-json/') return { status: 404, body: { error: `the fake upstream has nothing at ${url.pathname}` } };
  const term = (url.searchParams.get('search') ?? '').toLowerCase();
  const wantLibraries = url.searchParams.get('type') === '3';
  const results = SCRIPTS.filter((s) => wantLibraries && s.name.toLowerCase().includes(term)).map((s) => ({
    scriptName: s.name,
    author: { username: 'alice' },
    version: '1',
    scriptIdPart: s.id,
    access: s.source ? 1 : 3,
    extra: { kind: 'library' },
  }));
  return { body: { results, next: null } };
}

export function tradingViewFacade(url: URL): Reply {
  const m = /^\/pine-facade\/get\/([^/]+)\/(\d+)$/.exec(url.pathname);
  if (!m) return { status: 404, body: { error: `the fake upstream has nothing at ${url.pathname}` } };
  const script = SCRIPTS.find((s) => s.id === decodeURIComponent(m[1]));
  if (!script || m[2] !== '1') return { body: { reason: 'Script is not found.', success: false } };
  if (!script.source) return { body: { scriptName: script.name, scriptAccess: 'closed_no_auth', version: '1.0' } };
  return { body: { source: script.source, scriptAccess: 'open_no_auth', scriptName: script.name, version: '1.0' } };
}
