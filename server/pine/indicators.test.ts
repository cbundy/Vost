import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InputError, UpstreamError } from '../providers/errors.ts';
import { checkIndicatorSource, createIndicators, IndicatorError, licenceOf, MAX_INDICATOR_BYTES, parseScriptLink, scriptFromPage } from './indicators.ts';

const SRC = '// MPL 2.0 licence\n// (c) alice\n//@version=5\nindicator("Supertrend", overlay=true)\nplot(close)\n';

interface Hit {
  name?: string;
  id?: string;
  kind?: string;
  access?: number;
  author?: string;
  short?: string;
  plot?: number;
}
const hit = (h: Hit) => ({
  scriptName: h.name ?? 'Supertrend',
  author: { username: h.author ?? 'alice' },
  version: '3',
  scriptIdPart: h.id ?? 'PUB;a',
  imageUrl: h.short ?? 'abc123',
  access: h.access ?? 1,
  extra: { kind: h.kind ?? 'study', stats: { plot: h.plot ?? 2 } },
});

interface Fake {
  fetch: typeof globalThis.fetch;
  calls: string[];
  pages: { results: unknown[]; next: string | null }[];
  facade: Record<string, unknown>;
  html: Record<string, string>;
  fail: boolean;
}
function fake(): Fake {
  const f: Fake = {
    calls: [],
    pages: [{ results: [], next: null }],
    facade: {},
    html: {},
    fail: false,
    fetch: (async (input: string | URL) => {
      const url = String(input);
      f.calls.push(url);
      if (f.fail) return new Response('boom', { status: 400 });
      const u = new URL(url);
      if (u.pathname === '/pubscripts-suggest-json/') {
        const page = Number(u.searchParams.get('page') ?? 0);
        return Response.json(f.pages[page] ?? { results: [], next: null });
      }
      if (u.pathname.startsWith('/script/')) {
        const html = f.html[u.pathname.split('/')[2]];
        return html === undefined ? new Response('nope', { status: 404 }) : new Response(html);
      }
      const m = /\/pine-facade\/get\/(.+)\/last$/.exec(u.pathname);
      return Response.json((m && f.facade[decodeURIComponent(m[1])]) ?? { reason: 'Script is not found.', success: false });
    }) as typeof globalThis.fetch,
  };
  return f;
}

let dir = '';
let logs: string[] = [];
let clock = 1000;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-pine-ind-'));
  logs = [];
  clock = 1000;
});
afterEach(async () => {
  await chmod(dir, 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const make = (f: Fake) => createIndicators({ dir, fetch: f.fetch, now: () => clock++, log: (l) => logs.push(l) });
const open = (extra: Record<string, unknown> = {}) => ({ source: SRC, scriptAccess: 'open_no_auth', scriptName: 'Supertrend', version: '3.0', ...extra });

describe('search', () => {
  it('keeps only open studies, with name, author, ids, plots and whether each is stored', async () => {
    const f = fake();
    f.pages = [{ results: [hit({}), hit({ id: 'PUB;closed', access: 3 }), hit({ id: 'PUB;strat', kind: 'strategy' }), hit({ id: 'PUB;lib', kind: 'library' }), hit({ id: 'PUB;b', name: 'Other', author: 'bob', short: 'zzz' })], next: null }];
    f.facade['PUB;a'] = open();
    const ind = make(f);
    await ind.load();
    await ind.add({ scriptId: 'PUB;a' });
    const hits = await ind.search('super');
    expect(hits).toEqual([
      { scriptId: 'PUB;a', shortId: 'abc123', name: 'Supertrend', author: 'alice', plots: 2, stored: true },
      { scriptId: 'PUB;b', shortId: 'zzz', name: 'Other', author: 'bob', plots: 2, stored: false },
    ]);
    expect(f.calls.some((c) => c.includes('search=super'))).toBe(true);
  });

  it('refuses an empty query', async () => {
    const ind = make(fake());
    await expect(ind.search('  ')).rejects.toBeInstanceOf(InputError);
  });

  it('caps at 50 results', async () => {
    const f = fake();
    f.pages = [{ results: Array.from({ length: 80 }, (_, i) => hit({ id: `PUB;n${i}` })), next: null }];
    expect(await make(f).search('x')).toHaveLength(50);
  });

  it('follows next for at most 3 pages', async () => {
    const f = fake();
    f.pages = [0, 1, 2, 3, 4].map((i) => ({ results: [hit({ id: `PUB;p${i}` })], next: `https://www.tradingview.com/pubscripts-suggest-json/?search=x&page=${i + 1}` }));
    const hits = await make(f).search('x');
    expect(hits.map((h) => h.scriptId)).toEqual(['PUB;p0', 'PUB;p1', 'PUB;p2']);
    expect(f.calls).toHaveLength(3);
  });

  it('does not follow a next on another host', async () => {
    const f = fake();
    f.pages = [{ results: [hit({})], next: 'https://evil.example/pubscripts-suggest-json/?page=1' }];
    await make(f).search('x');
    expect(f.calls).toHaveLength(1);
  });

  it('turns an upstream failure into UpstreamError', async () => {
    const f = fake();
    f.fail = true;
    await expect(make(f).search('x')).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('add', () => {
  it('stores name, author, version, licence and source by script id, and lists without the source', async () => {
    const f = fake();
    f.pages = [{ results: [hit({})], next: null }];
    f.facade['PUB;a'] = open();
    const ind = make(f);
    await ind.load();
    const added = await ind.add({ scriptId: 'PUB;a' });
    expect(added).toMatchObject({ scriptId: 'PUB;a', name: 'Supertrend', author: 'alice', version: '3.0', licence: '// MPL 2.0 licence\n// (c) alice\n//@version=5', shortId: 'abc123', pineVersion: 5 });
    expect(f.calls.some((c) => c.endsWith('/get/PUB%3Ba/last?no_4xx=true'))).toBe(true);
    expect(ind.get('PUB;a')?.source).toBe(SRC);
    expect(ind.list()[0]).not.toHaveProperty('source');
    expect(logs.some((l) => l.startsWith('[pine-indicators] PUB;a added'))).toBe(true);
  });

  it('adds by link and reads only the "script" object id, even when a related PUB id comes first', async () => {
    const f = fake();
    f.html.AbC123 = '<script>{"related":[{"script_id_part":"PUB;other"}]}</script><script>{"script":{"script_id_part":"PUB;mine","author":{"username":"carol"}},"x":{"script_id_part":"PUB;later"}}</script>';
    f.facade['PUB;mine'] = open();
    f.facade['PUB;other'] = open({ scriptName: 'Wrong' });
    const added = await make(f).add({ link: 'https://www.tradingview.com/script/AbC123-Supertrend/' });
    expect(added).toMatchObject({ scriptId: 'PUB;mine', author: 'carol', shortId: 'AbC123' });
    expect(f.calls.some((c) => c.includes('PUB%3Bother'))).toBe(false);
  });

  it.each(['https://evil.example/script/AbC123/', 'http://www.tradingview.com/script/AbC123/', 'https://www.tradingview.com/chart/AbC123/', 'https://www.tradingview.com.evil.example/script/AbC123/', 'not a url', 'https://www.tradingview.com/script/'])('refuses the link %s without any request', async (link) => {
    const f = fake();
    await expect(make(f).add({ link })).rejects.toBeInstanceOf(InputError);
    expect(f.calls).toEqual([]);
  });

  it('refuses a script id of another shape', async () => {
    await expect(make(fake()).add({ scriptId: 'USER;x' })).rejects.toBeInstanceOf(InputError);
  });

  it('refuses a closed-source script', async () => {
    const f = fake();
    f.facade['PUB;c'] = { scriptName: 'Closed', scriptAccess: 'closed_no_auth', version: '1.0' };
    const ind = make(f);
    await ind.load();
    await expect(ind.add({ scriptId: 'PUB;c' })).rejects.toMatchObject({ name: 'IndicatorError', reason: 'closed-source' });
    expect(ind.list()).toEqual([]);
  });

  it('reports an unknown script as not-found', async () => {
    await expect(make(fake()).add({ scriptId: 'PUB;nope' })).rejects.toMatchObject({ reason: 'not-found' });
  });

  it.each([
    ['strategy', '//@version=5\nstrategy("S")\n'],
    ['library', '//@version=5\nlibrary("L")\n'],
  ])('refuses a %s as not an indicator', async (_n, source) => {
    const f = fake();
    f.facade['PUB;s'] = open({ source });
    const ind = make(f);
    await expect(ind.add({ scriptId: 'PUB;s' })).rejects.toBeInstanceOf(InputError);
    expect(ind.count).toBe(0);
  });

  it('refuses a source over 1 MB', async () => {
    const f = fake();
    f.facade['PUB;big'] = open({ source: `//@version=5\nindicator("x")\n// ${'a'.repeat(MAX_INDICATOR_BYTES)}\n` });
    await expect(make(f).add({ scriptId: 'PUB;big' })).rejects.toBeInstanceOf(InputError);
  });

  it('refreshes a script that is already stored', async () => {
    const f = fake();
    f.facade['PUB;a'] = open();
    const ind = make(f);
    await ind.load();
    const first = await ind.add({ scriptId: 'PUB;a' });
    f.facade['PUB;a'] = open({ source: SRC + '// newer\n', version: '4.0' });
    const second = await ind.add({ scriptId: 'PUB;a' });
    expect(ind.count).toBe(1);
    expect(second.version).toBe('4.0');
    expect(second.fetchedAt).toBeGreaterThan(first.fetchedAt);
  });

  it('marks a pre-v5 script by its Pine version', async () => {
    const f = fake();
    f.facade['PUB;old'] = open({ source: '//@version=4\nstudy("Old")\nplot(close)\n' });
    expect(await make(f).add({ scriptId: 'PUB;old' })).toMatchObject({ pineVersion: 4, name: 'Supertrend' });
  });

  it('turns an upstream failure into UpstreamError', async () => {
    const f = fake();
    f.fail = true;
    await expect(make(f).add({ scriptId: 'PUB;a' })).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('licenceOf', () => {
  it('is the leading comment block, cut at the first code line', () => {
    expect(licenceOf('// a\n// b\nindicator("x")\n// not this\n')).toBe('// a\n// b');
  });
  it('is null with no leading comment', () => {
    expect(licenceOf('indicator("x")\n// c\n')).toBeNull();
    expect(licenceOf('')).toBeNull();
  });
  it('is cut at 500 characters', () => {
    expect(licenceOf(`// ${'x'.repeat(900)}\ncode`)).toHaveLength(500);
  });
});

describe('parsing helpers', () => {
  it('parseScriptLink accepts only the TradingView script form', () => {
    expect(parseScriptLink('https://www.tradingview.com/script/AbC123-Name/?x=1')).toBe('AbC123');
    expect(parseScriptLink('https://tradingview.com/script/AbC123/')).toBeNull();
  });
  it('scriptFromPage ignores braces inside strings and fails without a script object', () => {
    expect(scriptFromPage('{"script":{"name":"a}b","script_id_part":"PUB;x"}}')).toEqual({ scriptId: 'PUB;x', author: null });
    expect(scriptFromPage('{"other":{"script_id_part":"PUB;x"}}')).toBeNull();
  });
  it('checkIndicatorSource passes an indicator', () => {
    expect(checkIndicatorSource(SRC)).toBeNull();
  });
});

describe('storage', () => {
  it('survives a reload and removes', async () => {
    const f = fake();
    f.facade['PUB;a'] = open();
    const a = make(f);
    await a.load();
    await a.add({ scriptId: 'PUB;a' });
    const b = make(f);
    await b.load();
    expect(b.get('PUB;a')?.source).toBe(SRC);
    expect(await b.remove('PUB;a')).toBe(true);
    expect(await b.remove('PUB;a')).toBe(false);
    const c = make(f);
    await c.load();
    expect(c.count).toBe(0);
    expect(JSON.parse(await readFile(path.join(dir, 'pine-indicators.json'), 'utf8'))).toMatchObject({ version: 1, indicators: {} });
  });

  it('moves a corrupt file aside and starts empty', async () => {
    await writeFile(path.join(dir, 'pine-indicators.json'), '{not json');
    const ind = make(fake());
    await ind.load();
    expect(ind.list()).toEqual([]);
    expect((await readdir(dir)).some((n) => n.startsWith('pine-indicators.json.bad-'))).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)('refuses an add when the dir is not writable', async () => {
    const f = fake();
    f.facade['PUB;a'] = open();
    await chmod(dir, 0o555);
    const ind = make(f);
    await ind.load();
    expect(ind.writable).toBe(false);
    await expect(ind.add({ scriptId: 'PUB;a' })).rejects.toMatchObject({ name: 'StoreError' });
    expect(f.calls).toEqual([]);
  });

  it('exports IndicatorError for the route', () => {
    expect(new IndicatorError('closed-source', 'x').name).toBe('IndicatorError');
  });
});
