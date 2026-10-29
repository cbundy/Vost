/**
 * Pine libraries for `import user/name/version as x`: looked up on TradingView
 * (unofficial endpoints, open-source libraries only), kept on disk in
 * `pine-libraries.json` under the data dir, or pasted by the user when
 * TradingView has no open copy. A published library version never changes, so
 * stored entries never expire.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canWrite } from '../fsutil.ts';
import { InputError } from '../providers/errors.ts';
import { upstreamJson, type FetchFn } from '../providers/upstream.ts';

export const FILE_VERSION = 1;
export const MISS_TTL_MS = 10 * 60_000;
export const MAX_SEARCH_PAGES = 3;
export const MAX_SOURCE_BYTES = 1024 * 1024;

const SEARCH_URL = 'https://www.tradingview.com/pubscripts-suggest-json/';
const FACADE_URL = 'https://pine-facade.tradingview.com/pine-facade/get/';

export type LibraryOrigin = 'tradingview' | 'pasted';
export type MissReason = 'not-found' | 'closed-source';

export interface LibraryEntry {
  source: string;
  origin: LibraryOrigin;
  scriptId?: string;
  fetchedAt: number;
}

export interface LibrarySummary {
  path: string;
  origin: LibraryOrigin;
  scriptId?: string;
  fetchedAt: number;
  bytes: number;
}

export type LibraryLookup = ({ ok: true; path: string } & LibraryEntry) | { ok: false; path: string; reason: MissReason };

export interface LibrariesDeps {
  dir: string;
  fetch?: FetchFn;
  now?: () => number;
  log?: (line: string) => void;
}

export interface Libraries {
  /** Reads the file (a bad one is moved aside) and checks the dir is writable. */
  load(): Promise<void>;
  readonly writable: boolean;
  readonly count: number;
  list(): LibrarySummary[];
  /** Stored entry, else a TradingView lookup (saved on success). Throws `UpstreamError` when TradingView fails. */
  get(libPath: string): Promise<LibraryLookup>;
  /** Saves a pasted library, replacing any copy. Throws `InputError` for a source that is not a library, `StoreError` when the dir is not writable. */
  put(libPath: string, source: string): Promise<LibrarySummary>;
  /** False when there was no such entry. */
  remove(libPath: string): Promise<boolean>;
}

class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

const USER_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const VERSION_RE = /^[1-9][0-9]{0,5}$/;

/** `user/name/version` or null. */
export function parseLibraryPath(libPath: string): { user: string; name: string; version: number } | null {
  const parts = libPath.split('/');
  if (parts.length !== 3) return null;
  const [user, name, version] = parts;
  if (!USER_RE.test(user) || !NAME_RE.test(name) || !VERSION_RE.test(version)) return null;
  return { user, name, version: Number(version) };
}

/** A `//@version=5|6` marker and a `library(` declaration. */
export function checkLibrarySource(source: string): string | null {
  if (!/^[ \t]*\/\/\s*@version\s*=\s*[56]\b/m.test(source)) return 'The source needs a //@version=5 or //@version=6 line';
  if (!/^[ \t]*library\s*\(/m.test(source)) return 'The source is not a library: it needs a library("...") declaration';
  return null;
}

interface SearchResult {
  scriptName?: unknown;
  scriptIdPart?: unknown;
  version?: unknown;
  author?: { username?: unknown };
  extra?: { kind?: unknown };
}

interface Candidate {
  scriptId: string;
  version: number;
}

interface SearchPage {
  results?: SearchResult[];
  next?: unknown;
}

function emptyStore(): Record<string, LibraryEntry> {
  return Object.create(null) as Record<string, LibraryEntry>;
}

export function createLibraries(deps: LibrariesDeps): Libraries {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const file = path.join(deps.dir, 'pine-libraries.json');
  const ctx = { fetch: deps.fetch };
  let entries = emptyStore();
  let writable = true;
  let queue: Promise<void> = Promise.resolve();
  const misses = new Map<string, { reason: MissReason; until: number }>();
  const inflight = new Map<string, Promise<LibraryLookup>>();

  const persist = (): Promise<void> => {
    const run = async (): Promise<void> => {
      await mkdir(deps.dir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      await writeFile(tmp, JSON.stringify({ version: FILE_VERSION, libraries: entries }, null, 2));
      await rename(tmp, file);
    };
    const result = queue.then(run);
    queue = result.catch(() => undefined);
    return result;
  };

  const summary = (p: string, e: LibraryEntry): LibrarySummary => ({
    path: p,
    origin: e.origin,
    ...(e.scriptId !== undefined && { scriptId: e.scriptId }),
    fetchedAt: e.fetchedAt,
    bytes: Buffer.byteLength(e.source),
  });

  const requireWritable = (): void => {
    if (!writable) throw new StoreError('the data folder is not writable');
  };

  /** Search TradingView for the library; candidates in the fixed order. */
  async function candidates(user: string, name: string, version: number): Promise<Candidate[]> {
    const found: (Candidate & { exact: boolean })[] = [];
    let url: string | null = `${SEARCH_URL}?search=${encodeURIComponent(name)}&type=3`;
    for (let page = 0; page < MAX_SEARCH_PAGES && url; page++) {
      const body: SearchPage = await upstreamJson<SearchPage>('tradingview', url, ctx);
      for (const r of Array.isArray(body?.results) ? body.results : []) {
        if (r?.extra?.kind !== 'library') continue;
        if (typeof r.author?.username !== 'string' || r.author.username.toLowerCase() !== user.toLowerCase()) continue;
        if (typeof r.scriptName !== 'string' || r.scriptName.toLowerCase() !== name.toLowerCase()) continue;
        if (typeof r.scriptIdPart !== 'string') continue;
        const v = parseInt(String(r.version), 10);
        if (!Number.isFinite(v) || v < version) continue;
        found.push({ scriptId: r.scriptIdPart, version: v, exact: r.scriptName === name });
      }
      url = null;
      if (typeof body?.next === 'string' && body.next) {
        try {
          const next = new URL(body.next, url ?? SEARCH_URL);
          if (next.hostname === 'www.tradingview.com') url = next.href;
        } catch {
          /* no further page */
        }
      }
    }
    const pool = found.some((c) => c.exact) ? found.filter((c) => c.exact) : found;
    const seen = new Set<string>();
    return pool
      .map((c, i) => ({ c, i }))
      .sort((a, b) => b.c.version - a.c.version || a.i - b.i)
      .map(({ c }) => c)
      .filter((c) => !seen.has(c.scriptId) && !!seen.add(c.scriptId));
  }

  async function lookup(libPath: string): Promise<LibraryLookup> {
    const parsed = parseLibraryPath(libPath)!;
    let closed = false;
    for (const cand of await candidates(parsed.user, parsed.name, parsed.version)) {
      const reply = await upstreamJson<{ source?: unknown; scriptAccess?: unknown; success?: unknown }>(
        'tradingview',
        `${FACADE_URL}${encodeURIComponent(cand.scriptId)}/${parsed.version}?no_4xx=true`,
        ctx,
      );
      if (reply?.success === false) continue; // that candidate has no such version
      const open = typeof reply?.scriptAccess !== 'string' || reply.scriptAccess.startsWith('open');
      if (typeof reply?.source === 'string' && reply.source && open) {
        const entry: LibraryEntry = { source: reply.source, origin: 'tradingview', scriptId: cand.scriptId, fetchedAt: now() };
        log(`[pine-libraries] ${libPath} fetched (${cand.scriptId} v${parsed.version}, ${Buffer.byteLength(entry.source)} bytes)`);
        if (writable) {
          const previous = entries[libPath];
          entries[libPath] = entry;
          try {
            await persist();
          } catch (err) {
            if (previous) entries[libPath] = previous;
            else delete entries[libPath];
            log(`[pine-libraries] ${libPath} could not be saved: ${(err as Error).message}`);
          }
        }
        return { ok: true, path: libPath, ...entry };
      }
      closed = true;
    }
    const reason: MissReason = closed ? 'closed-source' : 'not-found';
    misses.set(libPath, { reason, until: now() + MISS_TTL_MS });
    log(`[pine-libraries] ${libPath} miss (${reason})`);
    return { ok: false, path: libPath, reason };
  }

  return {
    get writable() {
      return writable;
    },
    get count() {
      return Object.keys(entries).length;
    },
    async load() {
      writable = await canWrite(deps.dir);
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`[pine-libraries] cannot read ${file}: ${(err as Error).message}`);
        return;
      }
      try {
        const data = JSON.parse(text) as { version?: unknown; libraries?: unknown };
        if (data?.version !== FILE_VERSION || typeof data.libraries !== 'object' || data.libraries === null || Array.isArray(data.libraries)) throw new Error('unexpected version or shape');
        const loaded = emptyStore();
        for (const [p, e] of Object.entries(data.libraries as Record<string, LibraryEntry>)) {
          if (!parseLibraryPath(p) || typeof e?.source !== 'string' || (e.origin !== 'tradingview' && e.origin !== 'pasted')) throw new Error(`bad entry ${p}`);
          loaded[p] = e;
        }
        entries = loaded;
      } catch (err) {
        const name = `pine-libraries.json.bad-${now()}`;
        try {
          await rename(file, path.join(deps.dir, name));
          log(`[pine-libraries] moved bad file to ${name} (${(err as Error).message})`);
        } catch (moveErr) {
          log(`[pine-libraries] bad file could not be moved aside: ${(moveErr as Error).message}`);
          writable = false;
        }
      }
    },
    list() {
      return Object.entries(entries)
        .map(([p, e]) => summary(p, e))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    async get(libPath) {
      if (!parseLibraryPath(libPath)) throw new InputError(`"${libPath}" is not user/name/version`);
      const stored = entries[libPath];
      if (stored) {
        log(`[pine-libraries] ${libPath} stored ${stored.origin} (${stored.scriptId ? `${stored.scriptId}, ` : ''}${Buffer.byteLength(stored.source)} bytes)`);
        return { ok: true, path: libPath, ...stored };
      }
      const miss = misses.get(libPath);
      if (miss && miss.until > now()) return { ok: false, path: libPath, reason: miss.reason };
      let pending = inflight.get(libPath);
      if (!pending) {
        pending = lookup(libPath).finally(() => inflight.delete(libPath));
        inflight.set(libPath, pending);
      }
      return pending;
    },
    async put(libPath, source) {
      if (!parseLibraryPath(libPath)) throw new InputError(`"${libPath}" is not user/name/version`);
      if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) throw new InputError('The source is too large');
      const bad = checkLibrarySource(source);
      if (bad) throw new InputError(bad);
      requireWritable();
      const previous = entries[libPath];
      const entry: LibraryEntry = { source, origin: 'pasted', fetchedAt: now() };
      entries[libPath] = entry;
      try {
        await persist();
      } catch (err) {
        if (previous) entries[libPath] = previous;
        else delete entries[libPath];
        throw new StoreError((err as Error).message);
      }
      misses.delete(libPath);
      log(`[pine-libraries] ${libPath} pasted (${Buffer.byteLength(source)} bytes)`);
      return summary(libPath, entry);
    },
    async remove(libPath) {
      if (!parseLibraryPath(libPath)) throw new InputError(`"${libPath}" is not user/name/version`);
      requireWritable();
      const previous = entries[libPath];
      if (!previous) return false;
      delete entries[libPath];
      try {
        await persist();
      } catch (err) {
        entries[libPath] = previous;
        throw new StoreError((err as Error).message);
      }
      misses.delete(libPath);
      log(`[pine-libraries] ${libPath} removed`);
      return true;
    },
  };
}

