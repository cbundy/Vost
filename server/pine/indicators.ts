/**
 * TradingView indicators the user added to Vost: searched on TradingView (unofficial
 * endpoints, open-source scripts only), fetched by script id or by script link, and
 * kept on disk in `pine-indicators.json` under the data dir with their author and
 * licence. The browser never contacts TradingView; the server does it all.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canWrite } from '../fsutil.ts';
import { InputError, UpstreamError } from '../providers/errors.ts';
import { upstreamJson, upstreamText, type FetchFn } from '../providers/upstream.ts';

export const INDICATORS_FILE_VERSION = 1;
export const MAX_SEARCH_PAGES = 3;
export const MAX_RESULTS = 50;
export const MAX_INDICATOR_BYTES = 1024 * 1024;
export const MAX_LICENCE_CHARS = 500;
export const MAX_QUERY_CHARS = 200;

const SEARCH_URL = 'https://www.tradingview.com/pubscripts-suggest-json/';
const FACADE_URL = 'https://pine-facade.tradingview.com/pine-facade/get/';
const SCRIPT_PAGE_URL = 'https://www.tradingview.com/script/';
const TV_HOST = 'www.tradingview.com';

const SCRIPT_ID_RE = /^PUB;[A-Za-z0-9_.-]{1,128}$/;
const SHORT_ID_RE = /^[A-Za-z0-9]{1,32}$/;

export interface IndicatorEntry {
  scriptId: string;
  shortId?: string;
  name: string;
  author: string;
  version: string;
  source: string;
  licence: string | null;
  fetchedAt: number;
}

/** What the list shows: no source, plus the script's Pine version. */
export type IndicatorSummary = Omit<IndicatorEntry, 'source'> & { pineVersion: number | null; bytes: number };

export interface IndicatorHit {
  scriptId: string;
  shortId: string | null;
  name: string;
  author: string;
  plots: number | null;
  stored: boolean;
}

export type AddInput = { scriptId: string } | { link: string };

export interface IndicatorsDeps {
  dir: string;
  fetch?: FetchFn;
  now?: () => number;
  log?: (line: string) => void;
}

export interface Indicators {
  /** Reads the file (a bad one is moved aside) and checks the dir is writable. */
  load(): Promise<void>;
  readonly writable: boolean;
  readonly count: number;
  list(): IndicatorSummary[];
  /** The stored entry with its source, or null. */
  get(scriptId: string): IndicatorEntry | null;
  /** Open-source indicators matching `q`. Throws `InputError` for an empty query, `UpstreamError` when TradingView fails. */
  search(q: string): Promise<IndicatorHit[]>;
  /** Fetches (or refreshes) and stores one. Throws `IndicatorError`, `InputError`, `UpstreamError` or `StoreError`. */
  add(input: AddInput): Promise<IndicatorSummary>;
  /** False when there was no such entry. */
  remove(scriptId: string): Promise<boolean>;
}

/** The script exists but cannot be used: `closed-source` or `not-found` (both answer 404). */
export class IndicatorError extends Error {
  readonly reason: 'closed-source' | 'not-found';
  constructor(reason: 'closed-source' | 'not-found', message: string) {
    super(message);
    this.name = 'IndicatorError';
    this.reason = reason;
  }
}

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

export const isScriptId = (id: string): boolean => SCRIPT_ID_RE.test(id);

/** The `https://www.tradingview.com/script/<shortId>...` form only; returns the short id. */
export function parseScriptLink(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== TV_HOST || url.port !== '' || url.username || url.password) return null;
  const m = /^\/script\/([^/]+)/.exec(url.pathname);
  return m && SHORT_ID_RE.test(m[1].split('-')[0]) ? m[1].split('-')[0] : null;
}

/**
 * The `script_id_part` of the page's `"script":{...}` object (and its author, when the object has one),
 * never another `PUB;` id elsewhere on the page.
 */
export function scriptFromPage(html: string): { scriptId: string; author: string | null } | null {
  const m = /"script"\s*:\s*\{/.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const text = html.slice(start, end + 1);
  let scriptId: unknown;
  let author: unknown;
  try {
    const obj = JSON.parse(text) as { script_id_part?: unknown; author?: { username?: unknown } };
    scriptId = obj.script_id_part;
    author = obj.author?.username;
  } catch {
    scriptId = /"script_id_part"\s*:\s*"([^"]+)"/.exec(text)?.[1];
  }
  if (typeof scriptId !== 'string' || !SCRIPT_ID_RE.test(scriptId)) return null;
  return { scriptId, author: typeof author === 'string' && author ? author : null };
}

/** The leading `//` comment block (to the first code line), at most 500 characters, or null. */
export function licenceOf(source: string): string | null {
  const lines: string[] = [];
  for (const raw of source.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('//')) break;
    lines.push(line);
  }
  const text = lines.join('\n');
  return text ? text.slice(0, MAX_LICENCE_CHARS) : null;
}

export function pineVersionOf(source: string): number | null {
  const m = /^[ \t]*\/\/\s*@version\s*=\s*(\d+)/m.exec(source);
  return m ? Number(m[1]) : null;
}

/** An error text when the source is not an indicator. */
export function checkIndicatorSource(source: string): string | null {
  if (/^[ \t]*strategy\s*\(/m.test(source)) return 'This script is a strategy, not an indicator';
  if (/^[ \t]*library\s*\(/m.test(source)) return 'This script is a library, not an indicator';
  return null;
}

interface SearchResult {
  scriptName?: unknown;
  scriptIdPart?: unknown;
  imageUrl?: unknown;
  access?: unknown;
  author?: { username?: unknown };
  extra?: { kind?: unknown; stats?: { plot?: unknown } };
}

interface SearchPage {
  results?: SearchResult[];
  next?: unknown;
}

interface FacadeReply {
  success?: unknown;
  source?: unknown;
  scriptAccess?: unknown;
  scriptName?: unknown;
  version?: unknown;
  author?: { username?: unknown };
  userName?: unknown;
}

function emptyStore(): Record<string, IndicatorEntry> {
  return Object.create(null) as Record<string, IndicatorEntry>;
}

export function createIndicators(deps: IndicatorsDeps): Indicators {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const file = path.join(deps.dir, 'pine-indicators.json');
  const ctx = { fetch: deps.fetch };
  let entries = emptyStore();
  let writable = true;
  let queue: Promise<void> = Promise.resolve();

  const persist = (): Promise<void> => {
    const run = async (): Promise<void> => {
      await mkdir(deps.dir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      await writeFile(tmp, JSON.stringify({ version: INDICATORS_FILE_VERSION, indicators: entries }, null, 2));
      await rename(tmp, file);
    };
    const result = queue.then(run);
    queue = result.catch(() => undefined);
    return result;
  };

  const summary = (e: IndicatorEntry): IndicatorSummary => {
    const { source, ...rest } = e;
    return { ...rest, pineVersion: pineVersionOf(source), bytes: Buffer.byteLength(source) };
  };

  const requireWritable = (): void => {
    if (!writable) throw new StoreError('the data folder is not writable');
  };

  /** Pages of the TradingView search, following `next` only within www.tradingview.com. */
  async function searchPages(q: string, each: (r: SearchResult) => boolean): Promise<void> {
    let url: string | null = `${SEARCH_URL}?search=${encodeURIComponent(q)}`;
    for (let page = 0; page < MAX_SEARCH_PAGES && url; page++) {
      const body: SearchPage = await upstreamJson<SearchPage>('tradingview', url, ctx);
      for (const r of Array.isArray(body?.results) ? body.results : []) if (!each(r)) return;
      let nextUrl: string | null = null;
      if (typeof body?.next === 'string' && body.next) {
        try {
          const next: URL = new URL(body.next, url);
          if (next.protocol === 'https:' && next.hostname === TV_HOST) nextUrl = next.href;
        } catch {
          /* no further page */
        }
      }
      url = nextUrl;
    }
  }

  const isOpenStudy = (r: SearchResult): boolean => r?.extra?.kind === 'study' && r.access === 1 && typeof r.scriptIdPart === 'string' && SCRIPT_ID_RE.test(r.scriptIdPart);

  async function resolveLink(link: string): Promise<{ scriptId: string; shortId: string; author: string | null }> {
    const shortId = parseScriptLink(link);
    if (!shortId) throw new InputError('Use a link like https://www.tradingview.com/script/<id>/');
    const html = await upstreamText('tradingview', `${SCRIPT_PAGE_URL}${shortId}/`, ctx);
    const found = scriptFromPage(html);
    if (!found) throw new IndicatorError('not-found', `TradingView has no script at ${SCRIPT_PAGE_URL}${shortId}/`);
    return { ...found, shortId };
  }

  async function fetchAndStore(scriptId: string, shortId: string | undefined, pageAuthor: string | null): Promise<IndicatorEntry> {
    const reply = await upstreamJson<FacadeReply>('tradingview', `${FACADE_URL}${encodeURIComponent(scriptId)}/last?no_4xx=true`, ctx);
    if (reply?.success === false) throw new IndicatorError('not-found', `TradingView has no script ${scriptId}`);
    if (typeof reply?.scriptAccess === 'string' && !reply.scriptAccess.startsWith('open')) {
      throw new IndicatorError('closed-source', 'This script is closed-source: TradingView does not share its code');
    }
    if (typeof reply?.source !== 'string' || !reply.source) throw new IndicatorError('not-found', `TradingView sent no source for ${scriptId}`);
    const source = reply.source;
    if (Buffer.byteLength(source) > MAX_INDICATOR_BYTES) throw new InputError('The source is too large');
    const bad = checkIndicatorSource(source);
    if (bad) throw new InputError(bad);

    const titled = /^[ \t]*indicator\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/m.exec(source)?.[1];
    let name = typeof reply.scriptName === 'string' && reply.scriptName ? reply.scriptName : (titled ?? '');
    let author = pageAuthor ?? (typeof reply.author?.username === 'string' && reply.author.username ? reply.author.username : typeof reply.userName === 'string' && reply.userName ? reply.userName : null);
    let found = shortId;
    if ((!author || !found) && name) {
      // The facade names no author: take it from the search hit with the same script id.
      try {
        await searchPages(name, (r) => {
          if (r?.scriptIdPart !== scriptId) return true;
          if (!author && typeof r.author?.username === 'string') author = r.author.username;
          if (!found && typeof r.imageUrl === 'string' && SHORT_ID_RE.test(r.imageUrl)) found = r.imageUrl;
          return false;
        });
      } catch {
        /* the author stays unknown */
      }
    }
    if (!name) name = scriptId;

    const entry: IndicatorEntry = {
      scriptId,
      ...(found && { shortId: found }),
      name,
      author: author ?? 'unknown',
      version: typeof reply.version === 'string' || typeof reply.version === 'number' ? String(reply.version) : '',
      source,
      licence: licenceOf(source),
      fetchedAt: now(),
    };
    const previous = entries[scriptId];
    entries[scriptId] = entry;
    try {
      await persist();
    } catch (err) {
      if (previous) entries[scriptId] = previous;
      else delete entries[scriptId];
      throw new StoreError((err as Error).message);
    }
    return entry;
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
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`[pine-indicators] cannot read ${file}: ${(err as Error).message}`);
        return;
      }
      try {
        const data = JSON.parse(text) as { version?: unknown; indicators?: unknown };
        if (data?.version !== INDICATORS_FILE_VERSION || typeof data.indicators !== 'object' || data.indicators === null || Array.isArray(data.indicators)) throw new Error('unexpected version or shape');
        const loaded = emptyStore();
        for (const [id, e] of Object.entries(data.indicators as Record<string, IndicatorEntry>)) {
          if (!isScriptId(id) || e?.scriptId !== id || typeof e.source !== 'string' || typeof e.name !== 'string' || typeof e.author !== 'string') throw new Error(`bad entry ${id}`);
          loaded[id] = e;
        }
        entries = loaded;
      } catch (err) {
        const name = `pine-indicators.json.bad-${now()}`;
        try {
          await rename(file, path.join(deps.dir, name));
          log(`[pine-indicators] moved bad file to ${name} (${(err as Error).message})`);
        } catch (moveErr) {
          log(`[pine-indicators] bad file could not be moved aside: ${(moveErr as Error).message}`);
          writable = false;
        }
      }
    },
    list() {
      return Object.values(entries)
        .map(summary)
        .sort((a, b) => a.name.localeCompare(b.name) || a.scriptId.localeCompare(b.scriptId));
    },
    get(scriptId) {
      return entries[scriptId] ?? null;
    },
    async search(q) {
      const term = q.trim();
      if (!term) throw new InputError('Give a search text');
      if (term.length > MAX_QUERY_CHARS) throw new InputError(`The search text must be at most ${MAX_QUERY_CHARS} characters`);
      const hits: IndicatorHit[] = [];
      const seen = new Set<string>();
      try {
        await searchPages(term, (r) => {
          if (!isOpenStudy(r)) return true;
          const scriptId = r.scriptIdPart as string;
          if (seen.has(scriptId)) return true;
          seen.add(scriptId);
          const plots = typeof r.extra?.stats?.plot === 'number' ? r.extra.stats.plot : null;
          hits.push({
            scriptId,
            shortId: typeof r.imageUrl === 'string' && SHORT_ID_RE.test(r.imageUrl) ? r.imageUrl : null,
            name: typeof r.scriptName === 'string' ? r.scriptName : scriptId,
            author: typeof r.author?.username === 'string' ? r.author.username : 'unknown',
            plots,
            stored: scriptId in entries,
          });
          return hits.length < MAX_RESULTS;
        });
      } catch (err) {
        if (err instanceof UpstreamError) log(`[pine-indicators] search "${term}" failed (${err.message})`);
        throw err;
      }
      log(`[pine-indicators] search "${term}" ok (${hits.length} open indicators)`);
      return hits;
    },
    async add(input) {
      const what = 'link' in input ? input.link : input.scriptId;
      try {
        requireWritable();
        let scriptId: string;
        let shortId: string | undefined;
        let author: string | null = null;
        if ('link' in input) {
          const r = await resolveLink(input.link);
          ({ scriptId, shortId, author } = r);
        } else {
          if (!isScriptId(input.scriptId)) throw new InputError('Not a TradingView script id (expected PUB;...)');
          scriptId = input.scriptId;
        }
        const entry = await fetchAndStore(scriptId, shortId, author);
        log(`[pine-indicators] ${what} added (${scriptId}, ${entry.name} by ${entry.author}, ${Buffer.byteLength(entry.source)} bytes)`);
        return summary(entry);
      } catch (err) {
        log(`[pine-indicators] ${what} ${err instanceof IndicatorError ? err.reason : err instanceof InputError ? 'refused' : err instanceof StoreError ? 'not saved' : 'failed'} (${err instanceof Error ? err.message : String(err)})`);
        throw err;
      }
    },
    async remove(scriptId) {
      if (!isScriptId(scriptId)) throw new InputError('Not a TradingView script id (expected PUB;...)');
      requireWritable();
      const previous = entries[scriptId];
      if (!previous) return false;
      delete entries[scriptId];
      try {
        await persist();
      } catch (err) {
        entries[scriptId] = previous;
        throw new StoreError((err as Error).message);
      }
      log(`[pine-indicators] ${scriptId} removed`);
      return true;
    },
  };
}
