/**
 * The page's client for the server's jobs API (`/api/jobs`): start a heavy job, follow it to its end, read it
 * later, cancel it. Generic over the job kind. One same-origin EventSource per tab carries the state changes of
 * every followed job; while that stream is down each followed job is polled instead.
 */

export type ServerJobKind = 'run' | 'optimize' | 'montecarlo' | 'find' | 'train' | 'sweep';
export type ServerJobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export interface ServerJobPlacement {
  where: 'server' | 'browser';
  reason: 'setting' | 'auto' | 'fallback';
  benchmarkMs?: number;
  /** What Auto compared: the benchmark's times (null when a place had none) and when it ran. */
  benchmark?: { browserMs: number | null; serverMs: number | null; at: number };
}

export interface ServerJobSummary {
  id: string;
  kind: ServerJobKind;
  scope: string;
  state: ServerJobState;
  /** 0..1 */
  progress: number;
  stage?: string;
  error?: string;
  created: number;
  started?: number;
  finished?: number;
  placement?: ServerJobPlacement;
}

export type ServerJob = ServerJobSummary & { result?: unknown };

export const isTerminal = (state: ServerJobState): boolean => state !== 'queued' && state !== 'running';

/** The server cannot take the job now (503, 413 or unreachable): the caller may run it in the browser. */
export class ServerUnavailableError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = 'ServerUnavailableError';
  }
}

export const POLL_MS = 1000;
const BASE = '/api/jobs';

export interface ServerJobsDeps {
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (t: ReturnType<typeof setTimeout>) => void;
  pollMs?: number;
}

export interface ServerJobs {
  startJob(kind: ServerJobKind, request: unknown, scope: string, placement: ServerJobPlacement): Promise<ServerJobSummary>;
  /** Calls `onSummary` on every state change until the job ends; the returned function stops following. */
  followJob(id: string, onSummary: (s: ServerJobSummary) => void): () => void;
  /** The job with its result when done; null for an unknown id. */
  getJob(id: string): Promise<ServerJob | null>;
  cancelJob(id: string): Promise<void>;
  listJobs(scope: string): Promise<ServerJobSummary[]>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    /* no JSON body */
  }
  return `HTTP ${res.status}`;
}

export function createServerJobs(deps: ServerJobsDeps = {}): ServerJobs {
  const doFetch = (url: string, init?: RequestInit): Promise<Response> => (deps.fetch ?? fetch)(url, init);
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((t) => clearTimeout(t));
  const pollMs = deps.pollMs ?? POLL_MS;

  const followers = new Map<string, Set<(s: ServerJobSummary) => void>>();
  let es: EventSource | null = null;
  let streamUp = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const deliver = (s: ServerJobSummary): void => {
    const set = followers.get(s.id);
    if (!set) return;
    for (const fn of [...set]) fn(s);
    if (isTerminal(s.state)) {
      followers.delete(s.id);
      closeIfIdle();
    }
  };

  const pollOnce = async (): Promise<void> => {
    for (const id of [...followers.keys()]) {
      try {
        const job = await getJob(id);
        if (job) deliver(job);
        else followers.delete(id);
      } catch {
        /* the server is away: try again next round */
      }
    }
  };

  const schedulePoll = (): void => {
    if (pollTimer !== undefined || streamUp || followers.size === 0) return;
    pollTimer = setT(() => {
      pollTimer = undefined;
      void pollOnce().then(schedulePoll);
    }, pollMs);
  };

  const closeIfIdle = (): void => {
    if (followers.size > 0) return;
    if (pollTimer !== undefined) clearT(pollTimer);
    pollTimer = undefined;
    es?.close();
    es = null;
    streamUp = false;
  };

  const openStream = (): void => {
    if (es) return;
    const ES = deps.EventSource ?? (typeof EventSource === 'undefined' ? undefined : EventSource);
    if (!ES) {
      schedulePoll();
      return;
    }
    const stream = new ES(`${BASE}/events`);
    es = stream;
    stream.addEventListener('open', () => {
      streamUp = true;
      if (pollTimer !== undefined) clearT(pollTimer);
      pollTimer = undefined;
      void pollOnce(); // anything that changed while the stream was down
    });
    stream.addEventListener('job', (ev) => {
      try {
        deliver(JSON.parse((ev as MessageEvent<string>).data) as ServerJobSummary);
      } catch {
        /* a malformed event */
      }
    });
    stream.addEventListener('error', () => {
      streamUp = false;
      schedulePoll();
    });
  };

  async function getJob(id: string): Promise<ServerJob | null> {
    const res = await doFetch(`${BASE}/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await errorText(res));
    return (await res.json()) as ServerJob;
  }

  return {
    async startJob(kind, request, scope, placement) {
      let res: Response;
      try {
        res = await doFetch(BASE, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ kind, request, scope, placement }) });
      } catch (err) {
        throw new ServerUnavailableError(`the server cannot be reached${err instanceof Error && err.message ? ` (${err.message})` : ''}`);
      }
      if (res.status === 503 || res.status === 413) throw new ServerUnavailableError(await errorText(res));
      if (!res.ok) throw new Error(await errorText(res));
      return (await res.json()) as ServerJobSummary;
    },

    followJob(id, onSummary) {
      let set = followers.get(id);
      if (!set) followers.set(id, (set = new Set()));
      set.add(onSummary);
      openStream();
      // Catch up on anything that happened before the stream carried this job.
      void getJob(id).then(
        (job) => {
          if (job && followers.get(id)?.has(onSummary)) deliver(job);
        },
        () => {},
      );
      return () => {
        const cur = followers.get(id);
        if (!cur) return;
        cur.delete(onSummary);
        if (cur.size === 0) followers.delete(id);
        closeIfIdle();
      };
    },

    getJob,

    async cancelJob(id) {
      const res = await doFetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(await errorText(res));
    },

    async listJobs(scope) {
      const res = await doFetch(`${BASE}?scope=${encodeURIComponent(scope)}`);
      if (!res.ok) throw new Error(await errorText(res));
      return ((await res.json()) as { jobs: ServerJobSummary[] }).jobs;
    },
  };
}

/** The tab's own client. */
export const serverJobs: ServerJobs = createServerJobs();
