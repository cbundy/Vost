/**
 * The page's side of the worker protocol: a lazily created worker, ids mapped to promises, cancel with a
 * one-second terminate fallback, and the same engine run on the page when there is no worker or it crashes.
 */
import type { Candle } from '../../../shared/market.ts';
import { loadJson } from '../lib/storage';
import { serverJobs, ServerUnavailableError, type ServerJobPlacement, type ServerJobs, type ServerJobSummary } from '../lib/serverJobs';
import { autoChoice, loadBenchmark, sanitizeJobSetting, type JobSetting } from '../lib/benchmark';
import type { SeriesInput, TrainResult } from './engine';
import { createHost } from './engineHost';
import type { Reply, Request, TradesCandidate } from './protocol';
import type { SweepInput, SweepLoad, SweepProgress, SweepResult } from './sweep/types';
import type { EngineOutcome, FindInputs, FindStage, FoundTrade, TrainedOutcome } from './run';
import { SERVER_SCOPE, startServerRun, type ServerRun } from './serverRun';

export const CANCEL_GRACE_MS = 1000;

/** What a run may tell the page about the server: the job it started and why it fell back to the browser. */
export interface ServerHooks {
  /** The server accepted the job (a fresh run only). */
  onServerJob?: (id: string) => void;
  /** The server could not take the job: the same run now happens in the browser. */
  onFallback?: (reason: string) => void;
  /** The setting is Auto: where it sent this run ('unmeasured' means the browser, for want of a benchmark). Called as the run starts. */
  onAuto?: (choice: AutoNote) => void;
}

/** What Auto did with a run. */
export type AutoNote = 'browser' | 'server' | 'unmeasured';

export type JobPlace = JobSetting;

export interface FindOptions extends ServerHooks {
  signal?: AbortSignal;
  /** A model that is up to date for the series (in its training order): training is skipped. */
  model?: TrainResult;
  /** `onPage` is true while the run is on the page's own thread. */
  onProgress?: (pct: number, stage: FindStage, onPage: boolean) => void;
}

export interface SweepOptions extends ServerHooks {
  signal?: AbortSignal;
  onProgress?: (p: SweepProgress, onPage: boolean) => void;
}

export interface EngineClient {
  /** The market search; stopped and replaced like a find. */
  sweep(input: SweepInput, opts?: SweepOptions): Promise<SweepResult>;
  find(series: SeriesInput[], inputs: FindInputs, opts?: FindOptions): Promise<EngineOutcome>;
  /** Training alone (Retrain); stopped and replaced like a find. */
  train(series: SeriesInput[], opts?: FindOptions): Promise<TrainedOutcome>;
  trades(candles: Candle[], candidate: TradesCandidate, inputs: Pick<FindInputs, 'direction' | 'risk'>): Promise<FoundTrade[]>;
  /** Follows a find, train or sweep job the server already has; it becomes the current run and ends like a fresh one. */
  resume(kind: 'find', jobId: string, opts?: Omit<FindOptions, 'model' | keyof ServerHooks>): Promise<EngineOutcome>;
  resume(kind: 'train', jobId: string, opts?: Omit<FindOptions, 'model' | keyof ServerHooks>): Promise<TrainedOutcome>;
  resume(kind: 'sweep', jobId: string, opts?: Omit<SweepOptions, keyof ServerHooks>): Promise<SweepResult>;
  /** Stops any run and ends the worker. A run on the server is let go, not cancelled: it keeps going there. */
  dispose(): void;
}

/** What the client needs of a Worker; a stub implements just this. */
export interface WorkerLike {
  postMessage(msg: Request): void;
  terminate(): void;
  onmessage: ((ev: { data: Reply }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface ClientOptions {
  /** Makes the worker; null or a throw means there is none (the page runs the engine itself). */
  makeWorker?: () => WorkerLike | null;
  cancelGraceMs?: number;
  /** How a sweep run on the page loads candles (default: the server's history route). */
  load?: SweepLoad;
  /** The scope the server jobs are started under (default: the strategy maker's). */
  scope?: string;
  /** Where heavy runs go; read at the start of each run (default: the Settings choice). */
  place?: () => JobPlace;
  /** The jobs API (default: the tab's client). */
  jobs?: ServerJobs;
}

/** The Settings choice, read without the main app's state code. */
const settingPlace = (): JobPlace => sanitizeJobSetting(loadJson<{ jobPlace?: unknown } | null>('prefs.v1', null)?.jobPlace);

const defaultMakeWorker = (): WorkerLike | null =>
  typeof Worker === 'undefined' ? null : (new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);

const abortError = (): Error => new DOMException('The run was cancelled', 'AbortError');

interface Pending {
  request: Request;
  resolve: (r: Reply) => void;
  reject: (e: Error) => void;
  onProgress?: FindOptions['onProgress'];
  onSweepProgress?: SweepOptions['onProgress'];
  last: number;
}

interface Channel {
  post(msg: Request): void;
  close(): void;
  onPage: boolean;
}

export function createEngineClient(opts: ClientOptions = {}): EngineClient {
  const makeWorker = opts.makeWorker ?? defaultMakeWorker;
  const grace = opts.cancelGraceMs ?? CANCEL_GRACE_MS;
  let channel: Channel | null = null;
  let broken = false;
  let seq = 0;
  const pending = new Map<string, Pending>();
  /** Cancels the worker has not answered yet. */
  const unanswered = new Map<string, ReturnType<typeof setTimeout>>();
  let current: string | null = null;
  let onServer: ServerRun<unknown> | null = null;

  const answer = (id: string): void => {
    const t = unanswered.get(id);
    if (t !== undefined) clearTimeout(t);
    unanswered.delete(id);
  };

  const deliver = (reply: Reply): void => {
    if (reply.type === 'error' && reply.cancelled) return answer(reply.id);
    const p = pending.get(reply.id);
    if (!p) return;
    if (reply.type === 'sweep-progress') {
      p.last = Math.max(p.last, reply.progress.pct);
      p.onSweepProgress?.({ ...reply.progress, pct: p.last }, channel?.onPage ?? false);
      return;
    }
    if (reply.type === 'progress') {
      p.last = Math.max(p.last, reply.pct);
      p.onProgress?.(p.last, reply.stage, channel?.onPage ?? false);
      return;
    }
    pending.delete(reply.id);
    if (current === reply.id) current = null;
    if (reply.type === 'error') p.reject(new Error(reply.message));
    else p.resolve(reply);
  };

  const openChannel = (): Channel => {
    if (channel) return channel;
    let worker: WorkerLike | null = null;
    if (!broken) {
      try {
        worker = makeWorker();
      } catch {
        worker = null;
      }
    }
    if (worker) {
      const w = worker;
      const mine: Channel = {
        onPage: false,
        post: (m) => w.postMessage(m),
        close: () => {
          w.onmessage = null;
          w.onerror = null;
          w.terminate();
        },
      };
      w.onmessage = (ev) => {
        if (channel === mine) deliver(ev.data);
      };
      w.onerror = () => {
        if (channel !== mine) return;
        broken = true;
        mine.close();
        channel = null;
        // What was running starts again on the page.
        const again = [...pending.values()].map((p) => p.request);
        for (const r of again) openChannel().post(r);
      };
      channel = mine;
    } else {
      const host = createHost((reply) => queueMicrotask(() => deliver(reply)), opts.load);
      channel = { onPage: true, post: (m) => host.receive(m), close: () => undefined };
    }
    return channel;
  };

  const cancel = (id: string): void => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (current === id) current = null;
    p.reject(abortError());
    if (!channel) return;
    const ch = channel;
    ch.post({ v: 1, id, type: 'cancel' });
    if (ch.onPage) return;
    // A worker that is deep in one long step cannot hear the cancel: after the grace it is ended and replaced.
    unanswered.set(
      id,
      setTimeout(() => {
        unanswered.delete(id);
        if (channel !== ch) return;
        ch.close();
        channel = null;
        // Requests made after the cancel were queued behind the stuck step: they start again on the new worker.
        for (const q of [...pending.values()]) openChannel().post(q.request);
      }, grace),
    );
  };

  const request = <T extends Reply>(make: (id: string) => Request, extra: Partial<Pending> = {}): { id: string; done: Promise<T> } => {
    const id = String(++seq);
    const msg = make(id);
    const done = new Promise<T>((resolve, reject) => {
      pending.set(id, { request: msg, resolve: resolve as (r: Reply) => void, reject, last: 0, ...extra });
    });
    openChannel().post(msg);
    return { id, done };
  };

  /** Stops the run that is going, wherever it is: a newer find, train or sweep replaces it. */
  const stopCurrent = (): void => {
    if (current) cancel(current);
    onServer?.cancel();
  };

  /**
   * Where this run goes: the placement to post when it goes to the server, or null for the browser. Auto asks the
   * saved benchmark (Retrain uses the Find measurement) and tells the page what it chose.
   */
  const placementFor = (kind: 'find' | 'train' | 'sweep', o: ServerHooks): ServerJobPlacement | null => {
    const setting = (opts.place ?? settingPlace)();
    if (setting === 'browser') return null;
    if (setting === 'server') return { where: 'server', reason: 'setting' };
    const choice = autoChoice(kind, loadBenchmark());
    o.onAuto?.(choice.measured ? choice.where : 'unmeasured');
    return choice.where === 'server' ? { where: 'server', reason: 'auto', ...(choice.benchmark ? { benchmark: choice.benchmark } : {}) } : null;
  };

  /** Runs a job on the server; when the server cannot take it, `local` runs the same request in the browser. */
  const viaServer = <T>(
    kind: 'find' | 'train' | 'sweep',
    placement: ServerJobPlacement,
    req: unknown,
    o: ServerHooks & { signal?: AbortSignal },
    extract: (result: unknown) => T,
    onSummary: (s: ServerJobSummary) => void,
    local: () => Promise<T>,
    resumeId?: string,
  ): Promise<T> => {
    const jobs = opts.jobs ?? serverJobs;
    const sr = startServerRun<T>({
      jobs,
      fresh: resumeId === undefined,
      begin: resumeId === undefined ? () => jobs.startJob(kind, req, opts.scope ?? SERVER_SCOPE, placement) : async () => ({ id: resumeId }),
      extract: (job) => extract(job.result),
      onSummary,
      onServerJob: o.onServerJob,
    });
    onServer = sr;
    o.signal?.addEventListener('abort', () => sr.cancel(), { once: true });
    const clear = (): void => {
      if (onServer === sr) onServer = null;
    };
    sr.done.then(clear, clear);
    return sr.done.catch((e: unknown) => {
      if (!(e instanceof ServerUnavailableError)) throw e;
      o.onFallback?.(e.reason);
      return local();
    });
  };

  /** Progress of a find or train job, held to never decrease. */
  const findProgress = (o: FindOptions): ((s: ServerJobSummary) => void) => {
    let last = 0;
    let stage: FindStage = 'Training';
    return (s) => {
      last = Math.max(last, s.progress);
      if (s.stage) stage = s.stage as FindStage;
      o.onProgress?.(last, stage, false);
    };
  };

  /** A find or a train: a new one stops the one running. */
  const run = (make: (id: string) => Request, o: FindOptions): Promise<EngineOutcome | TrainedOutcome> => {
    if (o.signal?.aborted) return Promise.reject(abortError());
    stopCurrent();
    const { id, done } = request<Extract<Reply, { type: 'result' }>>(make, { onProgress: o.onProgress });
    current = id;
    o.signal?.addEventListener('abort', () => cancel(id), { once: true });
    return done.then((r) => r.outcome);
  };

  const outcomeOf = (r: unknown): EngineOutcome | TrainedOutcome => (r as { outcome: EngineOutcome | TrainedOutcome }).outcome;

  const sweepRun = (input: SweepInput, o: SweepOptions): Promise<SweepResult> => {
    if (o.signal?.aborted) return Promise.reject(abortError());
    stopCurrent();
    const { id, done } = request<Extract<Reply, { type: 'sweep-result' }>>((rid) => ({ v: 1, id: rid, type: 'sweep', input }), {
      onSweepProgress: o.onProgress,
    });
    current = id;
    o.signal?.addEventListener('abort', () => cancel(id), { once: true });
    return done.then((r) => r.result);
  };

  const sweepProgress = (o: SweepOptions): ((s: ServerJobSummary) => void) => {
    let last = 0;
    return (s) => {
      last = Math.max(last, s.progress);
      o.onProgress?.({ pct: last, label: s.stage ?? '' }, false);
    };
  };

  const findFn = (series: SeriesInput[], inputs: FindInputs, o: FindOptions = {}): Promise<EngineOutcome> => {
    const local = () => run((id) => ({ v: 1, id, type: 'find', series, inputs, ...(o.model ? { model: o.model } : {}) }), o) as Promise<EngineOutcome>;
    if (o.signal?.aborted) return Promise.reject(abortError());
    const placement = placementFor('find', o);
    if (!placement) return local();
    stopCurrent();
    return viaServer('find', placement, { series, inputs, ...(o.model ? { model: o.model } : {}) }, o, (r) => outcomeOf(r) as EngineOutcome, findProgress(o), local);
  };

  const trainFn = (series: SeriesInput[], o: FindOptions = {}): Promise<TrainedOutcome> => {
    const local = () => run((id) => ({ v: 1, id, type: 'train', series }), o) as Promise<TrainedOutcome>;
    if (o.signal?.aborted) return Promise.reject(abortError());
    const placement = placementFor('train', o);
    if (!placement) return local();
    stopCurrent();
    return viaServer('train', placement, { series }, o, (r) => outcomeOf(r) as TrainedOutcome, findProgress(o), local);
  };

  const sweepFn = (input: SweepInput, o: SweepOptions = {}): Promise<SweepResult> => {
    const local = () => sweepRun(input, o);
    if (o.signal?.aborted) return Promise.reject(abortError());
    const placement = placementFor('sweep', o);
    if (!placement) return local();
    stopCurrent();
    return viaServer('sweep', placement, { input }, o, (r) => (r as { result: SweepResult }).result, sweepProgress(o), local);
  };

  return {
    sweep: sweepFn,
    find: findFn,
    train: trainFn,
    resume(kind: 'find' | 'train' | 'sweep', jobId: string, o: FindOptions & SweepOptions = {}): Promise<never> {
      if (o.signal?.aborted) return Promise.reject(abortError());
      stopCurrent();
      const never = (): Promise<never> => Promise.reject(new Error('The server job is not available'));
      const sum = kind === 'sweep' ? sweepProgress(o) : findProgress(o);
      const extract: (r: unknown) => never = kind === 'sweep' ? (r) => (r as { result: SweepResult }).result as never : (r) => outcomeOf(r) as never;
      return viaServer(kind, { where: 'server', reason: 'setting' }, undefined, o, extract, sum, never, jobId) as Promise<never>;
    },
    trades(candles, candidate, inputs) {
      return request<Extract<Reply, { type: 'trades' }>>((id) => ({ v: 1, id, type: 'trades', candles, candidate, inputs })).done.then((r) => r.trades);
    },
    dispose() {
      if (current) cancel(current);
      onServer?.stop();
      onServer = null;
      for (const t of unanswered.values()) clearTimeout(t);
      unanswered.clear();
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(abortError());
      }
      channel?.close();
      channel = null;
    },
  };
}
