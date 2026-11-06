import { describe, expect, it } from 'vitest';
import type { ServerJob } from '../lib/serverJobs';
import { finishedNote, planReattach, presentOutcome } from './reattach';
import type { HighlightSet } from './store';
import type { TrainResult } from './engine';
import type { JobRecord } from './store';

const record: JobRecord = { id: 'job', version: 1, jobId: 'j1', kind: 'sweep', started: 1, context: { kind: 'sweep', risk: {} as never } };
const job = (state: ServerJob['state'], extra: Partial<ServerJob> = {}): ServerJob => ({ id: 'j1', kind: 'sweep', scope: 'strategy-maker', state, progress: 0.4, created: 1, ...extra });
const store = (r: JobRecord | undefined | Error) => ({
  getJob: async () => {
    if (r instanceof Error) throw r;
    return r;
  },
});
const jobs = (j: ServerJob | null | Error) => ({
  getJob: async () => {
    if (j instanceof Error) throw j;
    return j;
  },
});

describe('planReattach', () => {
  it('does nothing without a record', async () => {
    expect(await planReattach(store(undefined), jobs(null))).toEqual({ action: 'none' });
    expect(await planReattach(store(new Error('x')), jobs(null))).toEqual({ action: 'none' });
  });
  it('drops the record of a job the server does not know, or that was cancelled', async () => {
    expect(await planReattach(store(record), jobs(null))).toEqual({ action: 'drop' });
    expect(await planReattach(store(record), jobs(job('cancelled')))).toEqual({ action: 'drop' });
  });
  it('follows a queued or running job', async () => {
    expect((await planReattach(store(record), jobs(job('running')))).action).toBe('follow');
    expect((await planReattach(store(record), jobs(job('queued')))).action).toBe('follow');
  });
  it('shows the result of a finished job', async () => {
    expect(await planReattach(store(record), jobs(job('done', { result: { a: 1 } })))).toEqual({ action: 'show', record, result: { a: 1 } });
  });
  it('shows the error of a failed or interrupted job', async () => {
    expect(await planReattach(store(record), jobs(job('failed', { error: 'boom' })))).toEqual({ action: 'failed', record, message: 'boom' });
    expect(await planReattach(store(record), jobs(job('interrupted')))).toEqual({ action: 'failed', record, message: 'stopped: the server restarted' });
  });
  it('keeps the record when the server cannot be reached', async () => {
    expect(await planReattach(store(record), jobs(new Error('down')))).toEqual({ action: 'keep' });
  });
  it('names the run in the finished note', () => {
    expect(finishedNote('find')).toBe('Find finished on the server while the page was closed');
    expect(finishedNote('train')).toBe('Retrain finished on the server while the page was closed');
    expect(finishedNote('sweep')).toBe('Market search finished on the server while the page was closed');
  });
});

describe('presentOutcome', () => {
  const set = (id: string, trades = 1): HighlightSet => ({ id, version: 1, source: { kind: 'csv', name: id }, trades: Array(trades).fill({ side: 'long', entryTime: 1, exitTime: 2 }), updatedAt: 1 });
  const trainedOn = [{ id: 'a', trades: 3, stamp: 'old-stamp' }];
  const model = { kind: 'ok' } as unknown as TrainResult;
  const find = { kind: 'find' as const, inputs: {} as never, seriesLabels: ['A'], skippedSets: [{ label: 'B', reason: 'gone' }], usedSetIds: ['a'], reused: false, trainedOn };

  it('rebuilds a find result from the context and keeps the model with the stamps from the start', () => {
    const edited = [set('a', 9), set('z')];
    const p = presentOutcome(find, { kind: 'ok', model } as never, edited);
    expect(p.result).toMatchObject({ seriesLabels: ['A'], skippedSets: [{ label: 'B', reason: 'gone' }], reused: false });
    expect(p.result?.usedSets.map((x) => x.id)).toEqual(['a']);
    expect(p.trained?.trainedOn).toBe(trainedOn);
    expect(p.trained?.trainedOn[0].stamp).toBe('old-stamp');
  });
  it('keeps no model for a find that reused one, or that found nothing', () => {
    expect(presentOutcome({ ...find, reused: true }, { kind: 'ok', model } as never, []).trained).toBeUndefined();
    expect(presentOutcome(find, { kind: 'refused', reason: 'x' }, []).trained).toBeUndefined();
  });
  it('keeps the model a retrain trained and words a retrain that did not train', () => {
    const train = { kind: 'train' as const, usedSetIds: ['a'], skippedSets: [], trainedOn };
    expect(presentOutcome(train, { kind: 'trained', model }, [set('a')]).trained?.trainedOn).toBe(trainedOn);
    expect(presentOutcome(train, { kind: 'too-few', have: 1, need: 5 }, []).error).toContain('Only 1 of the 5');
    expect(presentOutcome(train, { kind: 'refused', reason: 'nope' }, []).error).toBe('nope');
  });
});
