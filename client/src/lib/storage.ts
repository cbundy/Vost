/**
 * Everything the app keeps (preferences, layouts, drawings, watchlists, datasets, ...) lives on the
 * Vost server as one JSON document per name (`/api/settings`). This module keeps an in-memory copy of
 * those documents so reads stay synchronous: `hydrate()` fills it once at start-up, `saveJson` and
 * `removeKey` update it at once and queue the matching request. Writes to one key are coalesced
 * (latest value wins), sent one at a time and retried until they succeed, so nothing is lost while
 * the server is away; `onStorageOutage` tells the app when that happens.
 *
 * The only code that ever touches `localStorage` is `migrateBrowserData` below: it moves the
 * `vost.*` keys of an older version to the server once and removes them from the browser.
 */

const API = '/api/settings';
const JSON_HEADERS = { 'content-type': 'application/json' };
/** Pending bodies that may go out as `keepalive` requests on page hide (the browser caps them at 64 KB together). */
export const KEEPALIVE_LIMIT = 64 * 1024;
/** A write still pending after this long counts as an outage. */
export const OUTAGE_GRACE_MS = 3000;
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30000;
export const UNREACHABLE = 'Settings are not saved: the Vost server cannot be reached';

export interface StorageResponse {
  status: number;
  json: () => Promise<unknown>;
}
/** `fetch`, narrowed to what this module needs; tests inject their own. */
export type StorageTransport = (url: string, init: RequestInit) => Promise<StorageResponse>;

export type StorageOutageEvent =
  | { kind: 'down'; message: string }
  | { kind: 'up' }
  /** A write the server refused for good (a 4xx): logged and reported once, never retried. */
  | { kind: 'rejected'; message: string };

export interface MigrationNotice {
  adopted: number;
  archived: number;
  file: string | null;
}

type TestGlobal = { __vostStorageCache?: Map<string, string> };
const testCache = (): Map<string, string> | undefined => (globalThis as TestGlobal).__vostStorageCache;

/** JSON text per name. */
let cache: Map<string, string> = testCache() ?? new Map();
let transport: StorageTransport = testCache() ? async () => ({ status: 204, json: async () => null }) : (url, init) => fetch(url, init);

interface Entry {
  /** `null` is a delete. */
  body: string | null;
  version: number;
  sending: boolean;
  failures: number;
  retry?: ReturnType<typeof setTimeout>;
}
const queue = new Map<string, Entry>();
const listeners = new Set<(e: StorageOutageEvent) => void>();
let outage = false;
let graceTimer: ReturnType<typeof setTimeout> | undefined;
let scheduled = false;
let migrationNotice: MigrationNotice | null = null;
let guardsInstalled = false;

const emit = (e: StorageOutageEvent) => {
  for (const l of [...listeners]) l(e);
};

/** Subscribe to outages (`down` once per outage, `up` when the queue drains) and refused writes. */
export function onStorageOutage(listener: (e: StorageOutageEvent) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = cache.get(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** A stored JSON value read without a fallback: `ok` is false when the value is not valid JSON; a missing key gives `value: null`. */
export function peekJson(key: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const raw = cache.get(key);
    return { ok: true, value: raw === undefined || raw === '' ? null : JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

export function saveJson(key: string, value: unknown): { ok: boolean; error?: string } {
  let body: string;
  try {
    body = JSON.stringify(value) ?? 'null';
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  cache.set(key, body);
  enqueue(key, body);
  return { ok: true };
}

export function removeKey(key: string): void {
  if (!cache.delete(key)) return;
  enqueue(key, null);
}

/** Debounce helper used for autosaving preferences. `flush()` runs a pending call now; `cancel()` drops it. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait = 400) {
  let t: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  const debounced = (...args: A) => {
    if (t) clearTimeout(t);
    pending = args;
    t = setTimeout(() => {
      t = undefined;
      const a = pending!;
      pending = undefined;
      fn(...a);
    }, wait);
  };
  debounced.cancel = () => {
    if (t) clearTimeout(t);
    t = undefined;
    pending = undefined;
  };
  debounced.flush = () => {
    if (!t) return;
    const a = pending!;
    debounced.cancel();
    fn(...a);
  };
  return debounced;
}

// ---- the write queue ----

function enqueue(key: string, body: string | null): void {
  const entry = queue.get(key);
  if (entry) {
    entry.body = body;
    entry.version += 1;
  } else {
    queue.set(key, { body, version: 1, sending: false, failures: 0 });
  }
  if (!graceTimer && !outage) graceTimer = setTimeout(onGrace, OUTAGE_GRACE_MS);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      for (const k of [...queue.keys()]) {
        const e = queue.get(k)!;
        if (!e.sending && !e.retry) send(k, false);
      }
    });
  }
}

function onGrace(): void {
  graceTimer = undefined;
  if (queue.size > 0 && !outage) startOutage(UNREACHABLE);
}

function startOutage(message: string): void {
  if (outage) return;
  outage = true;
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = undefined;
  emit({ kind: 'down', message });
}

function settleIfDrained(): void {
  if (queue.size > 0) return;
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = undefined;
  if (outage) {
    outage = false;
    emit({ kind: 'up' });
  }
}

function send(key: string, keepalive: boolean): void {
  const entry = queue.get(key);
  if (!entry || entry.sending) return;
  if (entry.retry) clearTimeout(entry.retry);
  entry.retry = undefined;
  entry.sending = true;
  const sent = entry.version;
  const url = `${API}/${encodeURIComponent(key)}`;
  const isDelete = entry.body === null;
  const init: RequestInit = isDelete ? { method: 'DELETE', headers: JSON_HEADERS } : { method: 'PUT', headers: JSON_HEADERS, body: entry.body! };
  if (keepalive) init.keepalive = true;
  const done = (): void => {
    entry.sending = false;
    if (entry.version !== sent) return send(key, false);
    queue.delete(key);
    settleIfDrained();
  };
  const fail = (message: string): void => {
    entry.sending = false;
    entry.failures += 1;
    startOutage(message);
    const wait = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** (entry.failures - 1));
    entry.retry = setTimeout(() => {
      entry.retry = undefined;
      send(key, false);
    }, wait);
  };
  void (async () => {
    try {
      const res = await transport(url, init);
      if ((res.status >= 200 && res.status < 300) || (isDelete && res.status === 404)) return done();
      if (res.status >= 400 && res.status < 500 && res.status !== 503) {
        const message = `Setting ${key} was refused by the server (${res.status})`;
        console.error(`[storage] ${message}`);
        emit({ kind: 'rejected', message });
        return done();
      }
      let reason = UNREACHABLE;
      if (res.status === 503) {
        try {
          const b = (await res.json()) as { error?: unknown };
          if (typeof b?.error === 'string' && b.error) reason = b.error;
        } catch {
          /* keep the default */
        }
      }
      fail(reason);
    } catch {
      fail(UNREACHABLE);
    }
  })();
}

/**
 * Page hide: send everything still pending now. Bodies that together fit {@link KEEPALIVE_LIMIT} go out
 * as `keepalive` requests (they survive the page); bigger ones go as normal requests.
 */
export function flushStorage(): void {
  let bytes = 0;
  for (const e of queue.values()) bytes += e.body?.length ?? 0;
  const keepalive = bytes <= KEEPALIVE_LIMIT;
  for (const k of [...queue.keys()]) send(k, keepalive);
}

/** True while a write is queued or in flight. */
export function storageHasPending(): boolean {
  return queue.size > 0;
}

function installPageGuards(): void {
  if (guardsInstalled || typeof window === 'undefined') return;
  guardsInstalled = true;
  window.addEventListener('pagehide', flushStorage);
  window.addEventListener('beforeunload', (e) => {
    if (!outage) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

// ---- start-up ----

/** The one-time import notice from this start-up, if any (read once). */
export function takeMigrationNotice(): MigrationNotice | null {
  const n = migrationNotice;
  migrationNotice = null;
  return n;
}

/**
 * Moves the `vost.*` keys an older version kept in this browser to the server, then removes from the
 * browser only the keys the server took. Never throws: a failed import leaves the browser data alone and is tried again next start.
 */
async function migrateBrowserData(): Promise<void> {
  try {
    if (typeof localStorage === 'undefined') return;
    const values: Record<string, unknown> = {};
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const full = localStorage.key(i);
      if (!full || !full.startsWith('vost.')) continue;
      try {
        const raw = localStorage.getItem(full);
        if (raw === null) continue;
        values[full.slice(5)] = JSON.parse(raw);
        keys.push(full);
      } catch {
        /* not JSON: skipped and left in place */
      }
    }
    if (keys.length === 0) return;
    const res = await transport(`${API}/import`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ values }) });
    if (res.status !== 200) return;
    const result = (await res.json()) as { adopted?: unknown; archived?: unknown; file?: unknown };
    const adopted = Array.isArray(result.adopted) ? result.adopted.map(String) : [];
    const archived = Array.isArray(result.archived) ? result.archived.map(String) : [];
    for (const name of [...adopted, ...archived]) localStorage.removeItem(`vost.${name}`);
    migrationNotice = { adopted: adopted.length, archived: archived.length, file: typeof result.file === 'string' ? result.file : null };
  } catch {
    /* leave the browser data for the next start */
  }
}

/** Start-up: migrate old browser data, then load every document from the server. Rejects when the server cannot be reached. */
export function hydrate(): Promise<void> {
  starting ??= load().finally(() => {
    starting = undefined;
  });
  return starting;
}
let starting: Promise<void> | undefined;

async function load(): Promise<void> {
  await migrateBrowserData();
  const res = await transport(API, { method: 'GET' });
  if (res.status !== 200) throw new Error(`The Vost server answered ${res.status}`);
  const body = (await res.json()) as { values?: Record<string, unknown> };
  const next = new Map<string, string>();
  for (const [name, value] of Object.entries(body.values ?? {})) next.set(name, JSON.stringify(value));
  cache = next;
  const t = testCache();
  if (t) {
    t.clear();
    for (const [k, v] of next) t.set(k, v);
    cache = t;
  }
  installPageGuards();
}

// ---- test seams ----

/**
 * Tests: replace the stored documents (and share them across `vi.resetModules()`, which re-imports this
 * module). Without a transport of its own the test cache takes every write as saved.
 */
export function seedStorageForTest(values: Record<string, unknown> = {}): void {
  const next = new Map<string, string>();
  for (const [k, v] of Object.entries(values)) next.set(k, JSON.stringify(v));
  (globalThis as TestGlobal).__vostStorageCache = next;
  resetStorageForTest();
  cache = next;
  transport = async () => ({ status: 204, json: async () => null });
}

/** Tests: use this transport for every request. */
export function setStorageTransportForTest(t: StorageTransport): void {
  transport = t;
}

/** Tests: drop the queue, timers, listeners and outage state (the cache is left as it is). */
export function resetStorageForTest(): void {
  for (const e of queue.values()) if (e.retry) clearTimeout(e.retry);
  queue.clear();
  listeners.clear();
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = undefined;
  outage = false;
  scheduled = false;
  migrationNotice = null;
}
