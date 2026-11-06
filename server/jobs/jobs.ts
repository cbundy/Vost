/**
 * The server's job manager: a page starts a heavy job (backtest, optimizer, Monte Carlo, strategy-maker
 * find, train or market search), follows its progress, cancels it and reads its result later.
 *
 * It holds its own queue and hands a job to the pool only while fewer than `pool.size` jobs run, so a job the
 * pool has is a running job. One record per job (`<id>.json` in the store) holds the summary and, once done,
 * the result; the request (candles) lives in memory only while the job is queued or running and is never
 * written. Messages stay opaque apart from the fields routed on (no import from `client/`).
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { ENGINE_BUNDLE, UNAVAILABLE, type JobHandle, type Pool } from './pool.ts';
import type { DocStore } from '../settings/store.ts';

export const JOB_KINDS = ['run', 'optimize', 'montecarlo', 'find', 'train', 'sweep'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export interface JobPlacement {
  where: 'server' | 'browser';
  reason: 'setting' | 'auto' | 'fallback';
  benchmarkMs?: number;
  /** What Auto compared: the benchmark's times (null when a place had none) and when it ran. */
  benchmark?: { browserMs: number | null; serverMs: number | null; at: number };
}

export interface JobSummary {
  id: string;
  kind: JobKind;
  scope: string;
  state: JobState;
  /** 0..1 */
  progress: number;
  stage?: string;
  error?: string;
  created: number;
  started?: number;
  finished?: number;
  placement?: JobPlacement;
}

export interface JobInput {
  kind: unknown;
  request: unknown;
  scope: unknown;
  placement?: unknown;
}

export type CreateResult = { ok: true; summary: JobSummary } | { ok: false; status: 400 | 503; error: string };

export interface JobsDeps {
  store: DocStore;
  pool: Pick<Pool, 'size' | 'run' | 'close'>;
  bundleExists?: () => boolean;
  now?: () => number;
  newId?: () => string;
  log: (line: string) => void;
}

export interface Jobs {
  /** Reads the store and marks every record left queued or running as interrupted. */
  start(): Promise<void>;
  create(input: JobInput): Promise<CreateResult>;
  list(scope?: string): JobSummary[];
  /** The summary and, when done, the result; undefined for an unknown id. */
  get(id: string): Promise<(JobSummary & { result?: unknown }) | undefined>;
  /** Cancels a queued or running job (its summary), removes a finished one ('removed'); undefined for an unknown id. */
  remove(id: string): Promise<JobSummary | 'removed' | undefined>;
  subscribe(listener: (summary: JobSummary) => void): () => void;
  /** Stops reporting; running jobs are left as they are so the next start marks them interrupted. */
  close(): void;
}

export const KEEP_FINISHED = 100;
export const PROGRESS_MS = 250;
export const MAX_SCOPE = 200;

const BACKTEST_KINDS: readonly JobKind[] = ['run', 'optimize', 'montecarlo'];
const BACKTEST_FINALS = new Set(['result', 'optimizeResult', 'monteCarloResult', 'error']);
const MAKER_FINALS = new Set(['result', 'sweep-result', 'error']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

interface Entry {
  summary: JobSummary;
  /** The envelope for the pool; dropped once the job leaves queued/running. */
  envelope?: unknown;
  handle?: JobHandle;
  /** The result of a done job until its record is written, so a read right after the state change still has it. */
  unsaved?: unknown;
  lastEmit: number;
}

/** Reads a stored record's summary, or null when it is not one. */
function readSummary(doc: unknown): JobSummary | null {
  if (!isRecord(doc) || !isRecord(doc.summary)) return null;
  const s = doc.summary;
  if (typeof s.id !== 'string' || typeof s.kind !== 'string' || typeof s.scope !== 'string' || typeof s.state !== 'string' || typeof s.created !== 'number') return null;
  return s as unknown as JobSummary;
}

export function createJobs(deps: JobsDeps): Jobs {
  const { store, pool, log } = deps;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const bundleExists = deps.bundleExists ?? (() => existsSync(ENGINE_BUNDLE));
  const index = new Map<string, Entry>();
  const queue: string[] = [];
  const listeners = new Set<(summary: JobSummary) => void>();
  let closed = false;

  const emit = (entry: Entry): void => {
    if (closed) return;
    entry.lastEmit = now();
    for (const l of [...listeners]) {
      try {
        l({ ...entry.summary });
      } catch {
        /* a failing listener must not stop the others */
      }
    }
  };
  const persist = (entry: Entry, result?: unknown): Promise<void> =>
    store.put(entry.summary.id, result === undefined ? { summary: entry.summary } : { summary: entry.summary, result }).catch((err) => {
      log(`[jobs] cannot save ${entry.summary.id}: ${err instanceof Error ? err.message : String(err)}`);
    });

  async function prune(): Promise<void> {
    const finished = [...index.values()].filter((e) => e.summary.finished !== undefined).sort((a, b) => b.summary.finished! - a.summary.finished!);
    for (const e of finished.slice(KEEP_FINISHED)) {
      index.delete(e.summary.id);
      await store.remove(e.summary.id).catch((err) => log(`[jobs] cannot remove ${e.summary.id}: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  function finish(entry: Entry, state: 'done' | 'failed' | 'cancelled', extra: { error?: string; result?: unknown } = {}): void {
    const s = entry.summary;
    const t = now();
    s.state = state;
    s.finished = t;
    if (state === 'done') s.progress = 1;
    if (extra.error !== undefined) s.error = extra.error;
    delete s.stage;
    entry.envelope = undefined;
    entry.handle = undefined;
    log(`[jobs] ${s.id} ${s.kind} ${state} in ${t - (s.started ?? t)} ms (queued ${(s.started ?? t) - s.created} ms)`);
    emit(entry);
    entry.unsaved = extra.result;
    void persist(entry, extra.result).then(() => {
      entry.unsaved = undefined;
      return prune();
    });
    pump();
  }

  function onProgress(entry: Entry, msg: unknown): void {
    if (entry.summary.state !== 'running' || !isRecord(msg) || !isRecord(msg.msg)) return;
    const m = msg.msg;
    let pct: unknown;
    let stage: unknown;
    if (m.type === 'progress') ({ pct, stage } = m);
    else if (m.type === 'sweep-progress' && isRecord(m.progress)) ({ pct, label: stage } = m.progress as { pct: unknown; label: unknown });
    else return;
    if (typeof pct === 'number' && Number.isFinite(pct)) entry.summary.progress = Math.max(entry.summary.progress, clamp01(pct));
    if (typeof stage === 'string') entry.summary.stage = stage;
    if (now() - entry.lastEmit >= PROGRESS_MS) emit(entry);
  }

  function launch(entry: Entry): void {
    const s = entry.summary;
    s.state = 'running';
    s.started = now();
    const finals = BACKTEST_KINDS.includes(s.kind) ? BACKTEST_FINALS : MAKER_FINALS;
    const isFinal = (msg: unknown): boolean => isRecord(msg) && isRecord(msg.msg) && typeof msg.msg.type === 'string' && finals.has(msg.msg.type);
    emit(entry);
    void persist(entry);
    const handle = pool.run(entry.envelope, isFinal, (msg) => onProgress(entry, msg));
    entry.handle = handle;
    handle.done.then(
      (final) => {
        if (entry.summary.state !== 'running') return;
        const body = (final as { msg: Record<string, unknown> }).msg;
        if (body.type === 'error') finish(entry, 'failed', { error: typeof body.message === 'string' ? body.message : 'The engine reported an error' });
        else finish(entry, 'done', { result: body });
      },
      (err) => {
        if (entry.summary.state !== 'running' || closed) return;
        finish(entry, 'failed', { error: err instanceof Error ? err.message : String(err) });
      },
    );
  }

  function pump(): void {
    if (closed) return;
    let running = [...index.values()].filter((e) => e.summary.state === 'running').length;
    while (running < pool.size && queue.length > 0) {
      const entry = index.get(queue.shift()!);
      if (!entry || entry.summary.state !== 'queued') continue;
      launch(entry);
      running += 1;
    }
  }

  return {
    async start() {
      const docs = await store.list();
      for (const doc of Object.values(docs)) {
        const summary = readSummary(doc);
        if (!summary) continue;
        const entry: Entry = { summary, lastEmit: 0 };
        index.set(summary.id, entry);
        if (summary.state === 'queued' || summary.state === 'running') {
          summary.state = 'interrupted';
          summary.finished = now();
          const stored = (doc as { result?: unknown }).result;
          await persist(entry, stored);
          log(`[jobs] ${summary.id} ${summary.kind} interrupted by a restart`);
        }
      }
    },

    async create(input) {
      const { kind, request, scope, placement } = input;
      if (typeof kind !== 'string' || !(JOB_KINDS as readonly string[]).includes(kind)) return { ok: false, status: 400, error: `kind must be one of ${JOB_KINDS.join(', ')}` };
      if (!isRecord(request)) return { ok: false, status: 400, error: 'request must be an object' };
      if (typeof scope !== 'string' || scope.length < 1 || scope.length > MAX_SCOPE) return { ok: false, status: 400, error: `scope must be a string of 1 to ${MAX_SCOPE} characters` };
      let place: JobPlacement | undefined;
      if (placement !== undefined) {
        const p = placement;
        const b = isRecord(p) ? p.benchmark : undefined;
        const msOrNull = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v));
        if (
          !isRecord(p) ||
          (b !== undefined && !(isRecord(b) && msOrNull(b.browserMs) && msOrNull(b.serverMs) && typeof b.at === 'number' && Number.isFinite(b.at))) ||
          (p.where !== 'server' && p.where !== 'browser') ||
          (p.reason !== 'setting' && p.reason !== 'auto' && p.reason !== 'fallback') ||
          (p.benchmarkMs !== undefined && (typeof p.benchmarkMs !== 'number' || !Number.isFinite(p.benchmarkMs)))
        ) {
          return { ok: false, status: 400, error: 'placement must be { where: "server" | "browser", reason: "setting" | "auto" | "fallback", benchmarkMs?: number, benchmark?: { browserMs: number | null, serverMs: number | null, at: number } }' };
        }
        place = { where: p.where, reason: p.reason, ...(p.benchmarkMs !== undefined ? { benchmarkMs: p.benchmarkMs as number } : {}),
          ...(b !== undefined ? { benchmark: { browserMs: (b as Record<string, unknown>).browserMs as number | null, serverMs: (b as Record<string, unknown>).serverMs as number | null, at: (b as Record<string, unknown>).at as number } } : {}),
        };
      }
      const jobKind = kind as JobKind;
      if (closed || !bundleExists()) return { ok: false, status: 503, error: UNAVAILABLE };

      const id = newId();
      const msg = jobKind === 'run' || jobKind === 'optimize' || jobKind === 'montecarlo' ? { ...request, id, type: jobKind } : { ...request, v: 1, id, type: jobKind };
      const entry: Entry = {
        summary: { id, kind: jobKind, scope, state: 'queued', progress: 0, created: now(), ...(place ? { placement: place } : {}) },
        envelope: { proto: BACKTEST_KINDS.includes(jobKind) ? 'backtest' : 'maker', msg },
        lastEmit: 0,
      };
      try {
        await store.put(id, { summary: entry.summary });
      } catch (err) {
        return { ok: false, status: 503, error: `Jobs cannot be saved (${err instanceof Error ? err.message : String(err)}). Check VOST_DATA_DIR.` };
      }
      index.set(id, entry);
      queue.push(id);
      const created = { ...entry.summary };
      emit(entry);
      pump();
      return { ok: true, summary: created };
    },

    list(scope) {
      return [...index.values()]
        .map((e) => ({ ...e.summary }))
        .filter((s) => scope === undefined || s.scope === scope)
        .sort((a, b) => b.created - a.created);
    },

    async get(id) {
      const entry = index.get(id);
      if (!entry) return undefined;
      const summary = { ...entry.summary };
      if (summary.state !== 'done') return summary;
      if (entry.unsaved !== undefined) return { ...summary, result: entry.unsaved };
      const doc = await store.get(id);
      return isRecord(doc) && 'result' in doc ? { ...summary, result: doc.result } : summary;
    },

    async remove(id) {
      const entry = index.get(id);
      if (!entry) return undefined;
      const s = entry.summary;
      if (s.state === 'queued' || s.state === 'running') {
        const handle = entry.handle;
        const at = queue.indexOf(id);
        if (at >= 0) queue.splice(at, 1);
        handle?.cancel(); // its rejection is ignored: the state is no longer running by then
        finish(entry, 'cancelled');
        return { ...entry.summary };
      }
      index.delete(id);
      await store.remove(id);
      return 'removed';
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    close() {
      closed = true;
      listeners.clear();
    },
  };
}
