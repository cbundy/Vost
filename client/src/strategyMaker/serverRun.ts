/**
 * One strategy maker run on the Vost server: start (or pick up) the job, follow it, turn its state into a
 * result or an error, and stop. Cancel rejects at once and tells the server afterwards; `stop` lets go of the
 * job without cancelling it, so it keeps going while the page is away.
 */
import type { ServerJob, ServerJobs, ServerJobSummary } from '../lib/serverJobs';

export const SERVER_SCOPE = 'strategy-maker';
export const RESTARTED = 'stopped: the server restarted';

export const abortError = (): Error => new DOMException('The run was cancelled', 'AbortError');

export interface ServerRunArgs<T> {
  jobs: ServerJobs;
  /** Starts the job (a fresh run) or names an existing one (a resume). */
  begin: () => Promise<{ id: string }>;
  /** Reads the finished job's result. */
  extract: (job: ServerJob) => T;
  onSummary?: (s: ServerJobSummary) => void;
  /** Called with the id of the job once the server has it, for a fresh run only. */
  onServerJob?: (id: string) => void;
  fresh: boolean;
}

export interface ServerRun<T> {
  done: Promise<T>;
  /** Rejects at once with an AbortError and cancels the job on the server. */
  cancel(): void;
  /** Rejects at once with an AbortError and leaves the job running. */
  stop(): void;
}

export function startServerRun<T>(a: ServerRunArgs<T>): ServerRun<T> {
  let jobId: string | undefined;
  let ended = false;
  let wantCancel = false;
  let unfollow: (() => void) | null = null;
  let rejectDone: (e: Error) => void = () => undefined;
  let resolveDone: (v: T) => void = () => undefined;
  const done = new Promise<T>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const finish = (): boolean => {
    if (ended) return false;
    ended = true;
    unfollow?.();
    unfollow = null;
    return true;
  };

  const settle = (s: ServerJobSummary): void => {
    if (s.state === 'queued' || s.state === 'running') {
      a.onSummary?.(s);
      return;
    }
    if (!finish()) return;
    if (s.state === 'done') {
      a.jobs.getJob(s.id).then(
        (job) => {
          if (!job) return rejectDone(new Error('The server no longer has this result'));
          try {
            resolveDone(a.extract(job));
          } catch (e) {
            rejectDone(e instanceof Error ? e : new Error(String(e)));
          }
        },
        (e) => rejectDone(e instanceof Error ? e : new Error(String(e))),
      );
    } else if (s.state === 'failed') rejectDone(new Error(s.error ?? 'The server could not run this'));
    else if (s.state === 'interrupted') rejectDone(new Error(RESTARTED));
    else rejectDone(abortError());
  };

  a.begin().then(
    ({ id }) => {
      jobId = id;
      if (a.fresh) a.onServerJob?.(id);
      if (wantCancel) {
        void a.jobs.cancelJob(id).catch(() => undefined);
        return;
      }
      if (ended) return;
      unfollow = a.jobs.followJob(id, settle);
    },
    (e) => {
      if (finish()) rejectDone(e instanceof Error ? e : new Error(String(e)));
    },
  );

  return {
    done,
    cancel() {
      if (!finish()) return;
      wantCancel = true;
      rejectDone(abortError());
      if (jobId !== undefined) void a.jobs.cancelJob(jobId).catch(() => undefined);
    },
    stop() {
      if (!finish()) return;
      rejectDone(abortError());
    },
  };
}
