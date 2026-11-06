/**
 * What the page does on load with the server job it was waiting for when it was closed: look the job up and
 * decide whether to follow it, show its result or error, forget it, or keep the record for the next load.
 */
import type { ServerJobs, ServerJobSummary } from '../lib/serverJobs';
import { RESTARTED } from './serverRun';
import { tooFewMessage, type EngineOutcome, type FindResult, type TrainedOutcome } from './run';
import type { HighlightSet, JobContext, JobRecord, ModelRecord, Store } from './store';
import type { TrainResult } from './engine';

export type ReattachPlan =
  | { action: 'none' }
  /** The server no longer has the job, or it was cancelled: the record goes. */
  | { action: 'drop' }
  /** The server cannot be reached: the record stays for the next load. */
  | { action: 'keep' }
  | { action: 'follow'; record: JobRecord; job: ServerJobSummary }
  | { action: 'show'; record: JobRecord; result: unknown }
  | { action: 'failed'; record: JobRecord; message: string };

export async function planReattach(store: Pick<Store, 'getJob'>, jobs: Pick<ServerJobs, 'getJob'>): Promise<ReattachPlan> {
  let record: JobRecord | undefined;
  try {
    record = await store.getJob();
  } catch {
    return { action: 'none' };
  }
  if (!record || record.id !== 'job' || typeof record.jobId !== 'string') return { action: 'none' };
  try {
    const job = await jobs.getJob(record.jobId);
    if (!job) return { action: 'drop' };
    if (job.state === 'queued' || job.state === 'running') return { action: 'follow', record, job };
    if (job.state === 'done') return { action: 'show', record, result: job.result };
    if (job.state === 'failed') return { action: 'failed', record, message: job.error ?? 'The server could not run this' };
    if (job.state === 'interrupted') return { action: 'failed', record, message: RESTARTED };
    return { action: 'drop' };
  } catch {
    return { action: 'keep' };
  }
}

/** The run's name in the note shown for a result that arrived while the page was closed. */
export const finishedNote = (kind: JobRecord['kind']): string =>
  `${kind === 'find' ? 'Find' : kind === 'train' ? 'Retrain' : 'Market search'} finished on the server while the page was closed`;

/** The page's hold on the record: puts it once the server accepts a job, clears it when the run is over. */
export interface JobKeeper {
  put(record: JobRecord): void;
  clear(): void;
}

/** What a find or train job that ended while the page was closed shows. */
export interface Presented {
  /** A find's result, as the page shows it. */
  result?: FindResult;
  /** The error line, for a train that did not train. */
  error?: string;
  /** A model to keep, with the stamps of the marks it was trained on (taken when the run started, not now). */
  trained?: { model: TrainResult; usedSets: HighlightSet[]; trainedOn: ModelRecord['trainedOn'] };
}

/** Rebuilds what the page shows for a find or train outcome from the context kept when the run started and the saved sets. */
export function presentOutcome(c: Extract<JobContext, { kind: 'find' | 'train' }>, outcome: EngineOutcome | TrainedOutcome, all: HighlightSet[]): Presented {
  const usedSets = c.usedSetIds.map((id) => all.find((x) => x.id === id)).filter((x): x is HighlightSet => !!x);
  if (c.kind === 'find') {
    const o = outcome as EngineOutcome;
    const result: FindResult = { outcome: o, inputs: c.inputs, seriesLabels: c.seriesLabels, skippedSets: c.skippedSets, usedSets, reused: c.reused };
    return { result, ...(o.kind === 'ok' && !c.reused ? { trained: { model: o.model, usedSets, trainedOn: c.trainedOn } } : {}) };
  }
  const o = outcome as TrainedOutcome;
  if (o.kind === 'trained') return { trained: { model: o.model, usedSets, trainedOn: c.trainedOn } };
  return { error: o.kind === 'too-few' ? tooFewMessage(o.have, o.need) : o.reason };
}
