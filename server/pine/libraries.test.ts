import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLibraries, MISS_TTL_MS, parseLibraryPath } from './libraries.ts';
import { UpstreamError } from '../providers/errors.ts';

const LIB = '//@version=6\nlibrary("MyLib")\nexport f(x) => x + 1\n';

interface Hit {
  scriptName: string;
  username: string;
  version: string;
  id: string;
  kind?: string;
}
const hit = (h: Hit) => ({ scriptName: h.scriptName, author: { username: h.username }, version: h.version, scriptIdPart: h.id, extra: { kind: h.kind ?? 'library' } });

interface Fake {
  fetch: typeof globalThis.fetch;
  calls: string[];
  pages: { results: unknown[]; next: string | null }[];
  facade: Record<string, unknown>;
  fail: boolean;
}
function fake(): Fake {
  const f: Fake = {
    calls: [],
    pages: [{ results: [], next: null }],
    facade: {},
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
      const m = /\/pine-facade\/get\/(.+)\/(\d+)$/.exec(u.pathname);
      const body = m ? f.facade[`${decodeURIComponent(m[1])}/${m[2]}`] : undefined;
      return Response.json(body ?? { reason: 'Script is not found.', success: false });
    }) as typeof globalThis.fetch,
  };
  return f;
}

let dir = '';
let logs: string[] = [];
let clock = 1000;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-pine-'));
  logs = [];
  clock = 1000;
});
afterEach(async () => {
  await chmod(dir, 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});
const make = (f: Fake, d = dir) => createLibraries({ dir: d, fetch: f.fetch, now: () => clock, log: (l) => logs.push(l) });
const openReply = { source: LIB, scriptAccess: 'open_no_auth' };

describe('parseLibraryPath', () => {
  it('accepts user/name/version and rejects the rest', () => {
    expect(parseLibraryPath('alice/MyLib/1')).toEqual({ user: 'alice', name: 'MyLib', version: 1 });
    for (const bad of ['alice/MyLib', 'a/b/c/1', 'alice/My-Lib/1', 'alice/MyLib/0', 'alice/MyLib/1.5', 'alice/1Lib/1', '../x/y/1', 'alice//1']) expect(parseLibraryPath(bad), bad).toBeNull();
  });
});

describe('TradingView lookup', () => {
  it('searches libraries only (type=3), picks the right author and name, and saves it', async () => {
    const f = fake();
    f.pages = [
      {
        results: [
          hit({ scriptName: 'MyLib', username: 'bob', version: '2', id: 'PUB;bob' }),
          hit({ scriptName: 'MyLib', username: 'Alice', version: '2', id: 'PUB;wrongkind', kind: 'indicator' }),
          hit({ scriptName: 'mylib', username: 'ALICE', version: '3', id: 'PUB;lower' }),
          hit({ scriptName: 'MyLib', username: 'alice', version: '2', id: 'PUB;exact' }),
        ],
        next: null,
      },
    ];
    f.facade['PUB;exact/1'] = openReply;
    const libs = make(f);
    await libs.load();
    const got = await libs.get('alice/MyLib/1');
    expect(got).toMatchObject({ ok: true, origin: 'tradingview', scriptId: 'PUB;exact', source: LIB, fetchedAt: 1000 });
    expect(f.calls[0]).toContain('search=MyLib');
    expect(f.calls[0]).toContain('type=3');
    expect(f.calls[1]).toContain('/pine-facade/get/PUB%3Bexact/1?no_4xx=true');
    expect(logs.some((l) => l.startsWith('[pine-libraries] alice/MyLib/1 fetched (PUB;exact v1, '))).toBe(true);
  });

  it('falls back to a case-insensitive name, highest version first, then search order', async () => {
    const f = fake();
    f.pages = [
      {
        results: [
          hit({ scriptName: 'mylib', username: 'alice', version: '2', id: 'PUB;a' }),
          hit({ scriptName: 'MYLIB', username: 'alice', version: '5', id: 'PUB;b' }),
          hit({ scriptName: 'mylib', username: 'alice', version: '2', id: 'PUB;c' }),
          hit({ scriptName: 'mylib', username: 'alice', version: '2', id: 'PUB;a' }),
        ],
        next: null,
      },
    ];
    f.facade['PUB;b/1'] = { reason: 'x', success: false };
    f.facade['PUB;a/1'] = openReply;
    f.facade['PUB;c/1'] = openReply;
    const libs = make(f);
    await libs.load();
    expect(await libs.get('alice/MyLib/1')).toMatchObject({ ok: true, scriptId: 'PUB;a' });
    expect(f.calls.filter((c) => c.includes('pine-facade')).map((c) => /get\/([^/]+)\//.exec(c)![1])).toEqual(['PUB%3Bb', 'PUB%3Ba']);
  });

  it('is not found when the requested version is above every candidate', async () => {
    const f = fake();
    f.pages = [{ results: [hit({ scriptName: 'MyLib', username: 'alice', version: '2', id: 'PUB;a' })], next: null }];
    const libs = make(f);
    await libs.load();
    expect(await libs.get('alice/MyLib/3')).toMatchObject({ ok: false, reason: 'not-found' });
    expect(f.calls.some((c) => c.includes('pine-facade'))).toBe(false);
  });

  it('treats the success:false reply as not found', async () => {
    const f = fake();
    f.pages = [{ results: [hit({ scriptName: 'MyLib', username: 'alice', version: '2', id: 'PUB;a' })], next: null }];
    const libs = make(f);
    await libs.load();
    expect(await libs.get('alice/MyLib/2')).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('treats a missing source or a non-open scriptAccess as closed source', async () => {
    const f = fake();
    f.pages = [{ results: [hit({ scriptName: 'MyLib', username: 'alice', version: '2', id: 'PUB;a' })], next: null }];
    f.facade['PUB;a/1'] = { scriptAccess: 'closed_no_auth' };
    f.facade['PUB;a/2'] = { source: LIB, scriptAccess: 'protected' };
    const libs = make(f);
    await libs.load();
    expect(await libs.get('alice/MyLib/1')).toMatchObject({ ok: false, reason: 'closed-source' });
    expect(await libs.get('alice/MyLib/2')).toMatchObject({ ok: false, reason: 'closed-source' });
  });

  it('stops following pages after three', async () => {
    const f = fake();
    const next = (n: number) => `https://www.tradingview.com/pubscripts-suggest-json/?search=MyLib&type=3&page=${n}`;
    f.pages = [0, 1, 2, 3, 4].map((n) => ({ results: [], next: next(n + 1) }));
    const libs = make(f);
    await libs.load();
    await libs.get('alice/MyLib/1');
    expect(f.calls.filter((c) => c.includes('pubscripts-suggest-json'))).toHaveLength(3);
  });
});

describe('storage and caching', () => {
  const lib = (): Fake => {
    const f = fake();
    f.pages = [{ results: [hit({ scriptName: 'MyLib', username: 'alice', version: '1', id: 'PUB;a' })], next: null }];
    f.facade['PUB;a/1'] = openReply;
    return f;
  };

  it('serves the second GET from the store and survives a restart', async () => {
    const f = lib();
    const libs = make(f);
    await libs.load();
    await libs.get('alice/MyLib/1');
    const n = f.calls.length;
    await libs.get('alice/MyLib/1');
    expect(f.calls).toHaveLength(n);
    const again = make(f);
    await again.load();
    expect(await again.get('alice/MyLib/1')).toMatchObject({ ok: true, origin: 'tradingview' });
    expect(f.calls).toHaveLength(n);
    expect(again.list()).toEqual([{ path: 'alice/MyLib/1', origin: 'tradingview', scriptId: 'PUB;a', fetchedAt: 1000, bytes: Buffer.byteLength(LIB) }]);
    expect(JSON.parse(await readFile(path.join(dir, 'pine-libraries.json'), 'utf8')).version).toBe(1);
  });

  it('shares one lookup between concurrent GETs', async () => {
    const f = lib();
    const libs = make(f);
    await libs.load();
    const all = await Promise.all([libs.get('alice/MyLib/1'), libs.get('alice/MyLib/1'), libs.get('alice/MyLib/1')]);
    expect(all.every((x) => x.ok)).toBe(true);
    expect(f.calls.filter((c) => c.includes('pubscripts'))).toHaveLength(1);
  });

  it('remembers a miss for 10 minutes but never a failure', async () => {
    const f = fake();
    const libs = make(f);
    await libs.load();
    await libs.get('alice/Nope/1');
    const n = f.calls.length;
    await libs.get('alice/Nope/1');
    expect(f.calls).toHaveLength(n);
    clock += MISS_TTL_MS + 1;
    await libs.get('alice/Nope/1');
    expect(f.calls.length).toBeGreaterThan(n);

    f.fail = true;
    await expect(libs.get('alice/Other/1')).rejects.toBeInstanceOf(UpstreamError);
    const m = f.calls.length;
    await expect(libs.get('alice/Other/1')).rejects.toBeInstanceOf(UpstreamError);
    expect(f.calls.length).toBeGreaterThan(m);
  });

  it('a paste replaces a cached copy and clears a miss, a delete brings the fetch back', async () => {
    const f = lib();
    const libs = make(f);
    await libs.load();
    await libs.get('alice/Gone/1');
    await libs.put('alice/Gone/1', LIB);
    expect(await libs.get('alice/Gone/1')).toMatchObject({ ok: true, origin: 'pasted' });
    await libs.get('alice/MyLib/1');
    const pasted = LIB + '// pasted\n';
    await libs.put('alice/MyLib/1', pasted);
    expect(await libs.get('alice/MyLib/1')).toMatchObject({ ok: true, origin: 'pasted', source: pasted });
    const n = f.calls.length;
    expect(await libs.remove('alice/MyLib/1')).toBe(true);
    expect(await libs.remove('alice/MyLib/1')).toBe(false);
    expect(await libs.get('alice/MyLib/1')).toMatchObject({ ok: true, origin: 'tradingview', source: LIB });
    expect(f.calls.length).toBeGreaterThan(n);
  });

  it('rejects a source that is not a library', async () => {
    const libs = make(fake());
    await libs.load();
    await expect(libs.put('alice/MyLib/1', '//@version=6\nindicator("x")\n')).rejects.toThrow(/library/);
    await expect(libs.put('alice/MyLib/1', 'library("x")')).rejects.toThrow(/@version/);
    await expect(libs.put('alice/MyLib/1', '//@version=4\nlibrary("x")')).rejects.toThrow(/@version/);
  });

  it('moves a corrupt file aside and starts empty', async () => {
    await writeFile(path.join(dir, 'pine-libraries.json'), '{not json');
    const libs = make(fake());
    await libs.load();
    expect(libs.list()).toEqual([]);
    expect((await readdir(dir)).some((n) => n.startsWith('pine-libraries.json.bad-'))).toBe(true);
    expect(logs.some((l) => l.includes('moved bad file'))).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)('serves but does not keep a fetched library when the dir is read-only', async () => {
    const f = lib();
    await chmod(dir, 0o555);
    const libs = make(f);
    await libs.load();
    expect(libs.writable).toBe(false);
    expect(await libs.get('alice/MyLib/1')).toMatchObject({ ok: true });
    expect(libs.list()).toEqual([]);
    await expect(libs.put('alice/MyLib/1', LIB)).rejects.toMatchObject({ name: 'StoreError' });
  });
});
