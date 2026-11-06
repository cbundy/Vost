/**
 * Where a heavy job runs. `runJob` and `runOptimizerJob` take the same requests as `workerCall` and
 * `optimizerCall` and give back the same replies: with "Server" picked, a backtest, optimizer or Monte Carlo
 * run of a built-in strategy goes to the server's jobs API; everything else (Browser picked, a Pine or custom
 * strategy, a server that cannot take the job) runs in the browser as before. `reattachJobs` finds the jobs a
 * chart left on the server when the tab closed.
 */
import { CancelledError, optimizerCall, workerCall, type WorkerProgress } from './worker';
import type { WorkerRequestBody, WorkerResponse } from '../lib/workers/backtest.worker';
import type { BacktestStage } from '../lib/backtest/types';
import { serverJobs, ServerUnavailableError, isTerminal, type ServerJobPlacement, type ServerJobs, type ServerJobSummary } from '../lib/serverJobs';
import { autoChoice, loadBenchmark, type JobSetting } from '../lib/benchmark';
import { getJobRecord, patchJobRecord, putJobRecord, removeJobRecord, type JobRecord, type RecordKind } from './jobRecord';

/** Where a job ran or will run. */
export type JobPlace = 'browser' | 'server';
export type { JobSetting };

/** Strategies whose code only exists in the browser. */
const BROWSER_ONLY = new Set(['pine', 'custom']);

export const JOB_LABEL: Record<RecordKind, string> = { run: 'Backtest', optimize: 'Optimizer', montecarlo: 'Monte Carlo' };
const FINISHED_LABEL: Record<RecordKind, string> = { run: 'Backtest', optimize: 'Optimizer run', montecarlo: 'Monte Carlo' };

/** A server job that ended because the server restarted. */
export class ServerRestartedError extends Error {
  constructor(kind: RecordKind) {
    super(`${JOB_LABEL[kind]} stopped: the server restarted`);
    this.name = 'ServerRestartedError';
  }
}

export interface JobOptions {
  /** What a server job is saved under so a reload finds it again. */
  record?: Pick<JobRecord, 'symbol' | 'timeframe' | 'strategyId' | 'context' | 'sourceRunId' | 'options'>;
  /** The server accepted the job. */
  onStarted?: (job: ServerJobSummary) => void;
  /** The server could not take the job; it runs in the browser instead. */
  onFallback?: (reason: string) => void;
  api?: ServerJobs;
  /** The server cannot take the job: reject with `ServerUnavailableError` instead of running it in the browser. */
  noFallback?: boolean;
  /** The strategy to settle the place by when `record` is not given (a Monte Carlo run names none in its request). */
  strategyId?: string;
}

export interface JobRun {
  promise: Promise<WorkerResponse>;
  cancel: () => void;
  /** Where the job actually ran (settled once the promise is). */
  place: () => JobPlace;
  /** Auto chose the place (the setting was Auto and the job could be placed). */
  auto: boolean;
  /** The setting was Auto and the benchmark had nothing for this job, so it ran in the browser. */
  unmeasured: boolean;
}

/** The part of a `JobRun` the dispatcher fills in from the setting. */
interface Settled {
  server: boolean;
  placement: ServerJobPlacement;
  auto: boolean;
  unmeasured: boolean;
}

function toServer(
  kind: RecordKind,
  scope: string,
  req: WorkerRequestBody,
  onProgress: ((pct: number, stage?: BacktestStage) => void) | undefined,
  opts: JobOptions,
  browser: () => { promise: Promise<WorkerResponse>; cancel: () => void },
  settled: Settled,
): JobRun {
  const api = opts.api ?? serverJobs;
  let place: JobPlace = 'server';
  let cancelled = false;
  let cancelNow: () => void = () => {
    cancelled = true;
  };
  const promise = (async (): Promise<WorkerResponse> => {
    let job: ServerJobSummary;
    try {
      job = await api.startJob(kind, req, scope, settled.placement);
    } catch (err) {
      if (err instanceof ServerUnavailableError && opts.noFallback) throw err;
      if (err instanceof ServerUnavailableError) {
        place = 'browser';
        removeJobRecord(scope, kind);
        opts.onFallback?.(err.reason);
        const b = browser();
        cancelNow = b.cancel;
        if (cancelled) b.cancel();
        return b.promise;
      }
      throw err;
    }
    if (opts.record) putJobRecord(scope, kind, { ...opts.record, id: job.id, started: Date.now(), seen: false });
    opts.onStarted?.(job);
    return new Promise<WorkerResponse>((resolve, reject) => {
      let over = false;
      let unfollow: () => void = () => {};
      const stop = (): boolean => {
        if (over) return false;
        over = true;
        unfollow();
        return true;
      };
      cancelNow = () => {
        if (!stop()) return;
        removeJobRecord(scope, kind, job.id);
        void api.cancelJob(job.id).catch(() => {});
        reject(new CancelledError());
      };
      if (cancelled) return cancelNow();
      const onSummary = (s: ServerJobSummary): void => {
        if (over) return;
        if (!isTerminal(s.state)) {
          onProgress?.(s.progress, s.stage as BacktestStage | undefined);
          return;
        }
        if (!stop()) return;
        if (s.state === 'done') {
          api.getJob(job.id).then(
            (full) => {
              if (!full || full.result === undefined) return reject(new Error('The server no longer has the result of this job'));
              patchJobRecord(scope, kind, job.id, { seen: true });
              resolve({ id: job.id, ...(full.result as object) } as WorkerResponse);
            },
            (err) => reject(err instanceof Error ? err : new Error(String(err))),
          );
          return;
        }
        removeJobRecord(scope, kind, job.id);
        if (s.state === 'interrupted') reject(new ServerRestartedError(kind));
        else if (s.state === 'cancelled') reject(new Error('The job was cancelled on the server'));
        else reject(new Error(s.error ?? 'The job failed on the server'));
      };
      unfollow = api.followJob(job.id, onSummary);
    });
  })();
  return { promise, cancel: () => cancelNow(), place: () => place, auto: settled.auto, unmeasured: false };
}

const canRunOnServer = (strategyId: string | undefined): strategyId is string => strategyId !== undefined && !BROWSER_ONLY.has(strategyId);

/**
 * Settles where a job of this kind runs. Browser and Server are taken as set; Auto asks the saved benchmark.
 * A strategy that only exists in the browser stays there whatever the setting says.
 */
function settle(setting: JobSetting, kind: RecordKind, strategyId: string | undefined): Settled {
  if (!canRunOnServer(strategyId) || setting === 'browser') return { server: false, placement: { where: 'browser', reason: 'setting' }, auto: false, unmeasured: false };
  if (setting === 'server') return { server: true, placement: { where: 'server', reason: 'setting' }, auto: false, unmeasured: false };
  const choice = autoChoice(kind, loadBenchmark());
  return {
    server: choice.where === 'server',
    placement: { where: 'server', reason: 'auto', ...(choice.benchmark ? { benchmark: choice.benchmark } : {}) },
    auto: choice.measured,
    unmeasured: !choice.measured,
  };
}

/** A backtest or a Monte Carlo run. */
export function runJob(
  setting: JobSetting,
  scope: string,
  req: Exclude<WorkerRequestBody, { type: 'optimize' | 'pine' }>,
  onProgress?: WorkerProgress,
  opts: JobOptions = {},
): JobRun {
  const kind: RecordKind = req.type;
  const strategyId = req.type === 'run' ? req.config.strategyId : (opts.record?.strategyId ?? opts.strategyId);
  const browser = () => ({ promise: workerCall(req, onProgress), cancel: () => {} });
  const settled = settle(setting, kind, strategyId);
  if (!settled.server) {
    removeJobRecord(scope, kind);
    return { ...browser(), place: () => 'browser', auto: settled.auto, unmeasured: settled.unmeasured };
  }
  return toServer(kind, scope, req, onProgress, opts, browser, settled);
}

/** An optimizer run: `cancel` stops it and rejects with `CancelledError`. */
export function runOptimizerJob(
  setting: JobSetting,
  scope: string,
  req: Extract<WorkerRequestBody, { type: 'optimize' }>,
  onProgress?: (pct: number) => void,
  opts: JobOptions = {},
): JobRun {
  const browser = () => optimizerCall(req, onProgress);
  const settled = settle(setting, 'optimize', req.config.strategyId);
  if (!settled.server) {
    removeJobRecord(scope, 'optimize');
    return { ...browser(), place: () => 'browser', auto: settled.auto, unmeasured: settled.unmeasured };
  }
  return toServer('optimize', scope, req, onProgress, opts, browser, settled);
}

/** What a chart gives `reattachJobs`: how to read it and how to show a job found on the server. */
export interface ReattachTarget {
  chartId: string;
  current(): { symbol: string; timeframe: string; strategyId: string; runId: string | null };
  /** A job is still going: show its progress. `cancel` stops it. */
  running(kind: RecordKind, pct: number, stage: BacktestStage | undefined, cancel: () => void): void;
  /** A job finished: show its result (`body` is the engine's final message). */
  done(kind: RecordKind, record: JobRecord, body: Record<string, unknown>): void;
  /** A job ended without a result. */
  failed(kind: RecordKind, error: Error): void;
  /** A followed job ended with nothing to show (cancelled elsewhere, or its result could not be read): clear the running state. */
  stopped?(kind: RecordKind): void;
  note(text: string): void;
  api?: ServerJobs;
}

/** Finds the server jobs this chart left behind and shows them. Resolves once each is shown or being followed. */
export async function reattachJobs(target: ReattachTarget): Promise<void> {
  const api = target.api ?? serverJobs;
  const { chartId } = target;

  // Read every record now: a job this chart starts a moment later must not be mistaken for a leftover.
  const records: Partial<Record<RecordKind, JobRecord>> = {};
  for (const kind of ['run', 'optimize', 'montecarlo'] as const) {
    const rec = getJobRecord(chartId, kind);
    if (rec) records[kind] = rec;
  }
  if (Object.keys(records).length === 0) return;

  const attach = async (kind: RecordKind): Promise<void> => {
    const rec = records[kind];
    if (!rec) return;
    const cur = target.current();
    if (rec.symbol !== cur.symbol || rec.timeframe !== cur.timeframe || rec.strategyId !== cur.strategyId) return;
    if (kind === 'montecarlo' && (rec.sourceRunId === undefined || rec.sourceRunId !== cur.runId)) return;
    let job;
    try {
      job = await api.getJob(rec.id);
    } catch {
      return; // the server is away: keep the record for the next load
    }
    if (!job) {
      removeJobRecord(chartId, kind, rec.id);
      return;
    }
    const finish = async (s: ServerJobSummary, followed: boolean): Promise<void> => {
      if (s.state === 'done') {
        let full;
        try {
          full = await api.getJob(rec.id);
        } catch {
          target.stopped?.(kind);
          return;
        }
        if (!full || full.result === undefined) {
          removeJobRecord(chartId, kind, rec.id);
          target.stopped?.(kind);
          return;
        }
        if (!followed && !rec.seen) target.note(`${FINISHED_LABEL[kind]} finished on the server while Vost was closed`);
        patchJobRecord(chartId, kind, rec.id, { seen: true });
        target.done(kind, rec, full.result as Record<string, unknown>);
        return;
      }
      removeJobRecord(chartId, kind, rec.id);
      if (s.state === 'interrupted') target.failed(kind, new ServerRestartedError(kind));
      else if (s.state === 'failed') target.failed(kind, new Error(s.error ?? 'The job failed on the server'));
      else target.stopped?.(kind);
    };
    if (!isTerminal(job.state)) {
      let over = false;
      let unfollow: () => void = () => {};
      const cancel = () => {
        if (over) return;
        over = true;
        unfollow();
        removeJobRecord(chartId, kind, rec.id);
        void api.cancelJob(rec.id).catch(() => {});
      };
      target.running(kind, job.progress, job.stage as BacktestStage | undefined, cancel);
      unfollow = api.followJob(rec.id, (s) => {
        if (over) return;
        if (!isTerminal(s.state)) {
          target.running(kind, s.progress, s.stage as BacktestStage | undefined, cancel);
          return;
        }
        over = true;
        void finish(s, true);
      });
      return;
    }
    await finish(job, false);
  };

  await attach('run');
  await Promise.all([attach('optimize'), attach('montecarlo')]);
}
