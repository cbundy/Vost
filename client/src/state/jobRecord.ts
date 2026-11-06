/**
 * The server job each chart is showing or waiting for, kept as its own settings document (`serverJobs.v1`) so a
 * reload finds the run again. It is deliberately not part of the layout record: named layouts would otherwise
 * show as unsaved every time a job starts, and would carry job ids.
 */
import { loadJson, saveJson } from '../lib/storage';
import type { MonteCarloOptions } from '../lib/backtest/monteCarlo';
import type { OptimizeRunContext } from '../lib/backtest/optimizerCsv';

export const JOB_RECORD_KEY = 'serverJobs.v1';

export type RecordKind = 'run' | 'optimize' | 'montecarlo';
const KINDS: readonly RecordKind[] = ['run', 'optimize', 'montecarlo'];

export interface JobRecord {
  id: string;
  symbol: string;
  timeframe: string;
  strategyId: string;
  started: number;
  /** Whether a tab followed the job to its end (or the finish was already announced). */
  seen: boolean;
  /** Optimizer: the run's context, shown with its result. */
  context?: OptimizeRunContext;
  /** Monte Carlo: the backtest it ran on, and the options it ran with. */
  sourceRunId?: string;
  options?: MonteCarloOptions;
}

export type ChartJobs = Partial<Record<RecordKind, JobRecord>>;
type Doc = Record<string, ChartJobs>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sane(v: unknown): JobRecord | null {
  if (!isObj(v)) return null;
  if (typeof v.id !== 'string' || typeof v.symbol !== 'string' || typeof v.timeframe !== 'string' || typeof v.strategyId !== 'string') return null;
  return { ...v, started: typeof v.started === 'number' ? v.started : 0, seen: v.seen === true } as unknown as JobRecord;
}

function load(): Doc {
  const raw = loadJson<unknown>(JOB_RECORD_KEY, {});
  const doc: Doc = {};
  if (!isObj(raw)) return doc;
  for (const [chart, jobs] of Object.entries(raw)) {
    if (!isObj(jobs)) continue;
    const out: ChartJobs = {};
    for (const kind of KINDS) {
      const rec = sane(jobs[kind]);
      if (rec) out[kind] = rec;
    }
    if (Object.keys(out).length > 0) doc[chart] = out;
  }
  return doc;
}

export function getJobRecord(chartId: string, kind: RecordKind): JobRecord | null {
  return load()[chartId]?.[kind] ?? null;
}

export function hasJobRecords(chartId: string): boolean {
  return load()[chartId] !== undefined;
}

export function putJobRecord(chartId: string, kind: RecordKind, rec: JobRecord): void {
  const doc = load();
  doc[chartId] = { ...doc[chartId], [kind]: rec };
  saveJson(JOB_RECORD_KEY, doc);
}

export function patchJobRecord(chartId: string, kind: RecordKind, id: string, patch: Partial<JobRecord>): void {
  const cur = getJobRecord(chartId, kind);
  if (!cur || cur.id !== id) return;
  putJobRecord(chartId, kind, { ...cur, ...patch });
}

/** Removes the record; with `id`, only when it still holds that job (a newer job's record stays). */
export function removeJobRecord(chartId: string, kind: RecordKind, id?: string): void {
  const doc = load();
  const cur = doc[chartId]?.[kind];
  if (!cur || (id !== undefined && cur.id !== id)) return;
  delete doc[chartId][kind];
  if (Object.keys(doc[chartId]).length === 0) delete doc[chartId];
  saveJson(JOB_RECORD_KEY, doc);
}
