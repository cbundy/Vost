/** Run state of Find: progress, cancel, the result, and the trades of the result row the user selected. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle, Timeframe } from '../../../shared/market.ts';
import { getProvider } from '../lib/providers';
import type { Dataset } from '../types';
import { loadFromDataset, loadFromProvider } from './data';
import type { Candidate, TrainResult } from './engine';
import { createEngineClient, type AutoNote, type EngineClient } from './engineClient';
import { candidateKey } from './Results';
import { trainedOnOf } from './useModel';
import { presentOutcome, type JobKeeper, type ReattachPlan } from './reattach';
import { runFind, runRetrain, sourceLabel, tooFewMessage, type EngineOutcome, type FindInputs, type FindResult, type FoundTrade, type Loaders, type TrainedOutcome } from './run';
import type { HighlightSet, JobContext, JobRecord, ModelRecord } from './store';
import type { RunState } from './TargetsForm';
import type { FindStage } from './run';

const IDLE: RunState = { running: false, pct: 0, stage: 'Loading data', onPage: false, onServer: false };

const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

/**
 * Called with each model a run trained (not one it reused) and the sets it was trained on, in training order.
 * `trainedOn` is given for a run that finished while the page was closed: the stamps of the marks it was trained on.
 */
export type OnTrained = (model: TrainResult, usedSets: HighlightSet[], trainedOn?: ModelRecord['trainedOn']) => void;

export interface FindHooks {
  /** Keeps the record of the server job the run is waiting for. */
  keeper?: JobKeeper;
  /** The server could not take the run, so it happens in the browser. */
  onFallback?: (reason: string) => void;
}

export function useFind(bars: number, library: Dataset[], onTrained?: OnTrained, hooks: FindHooks = {}) {
  const [run, setRun] = useState<RunState>(IDLE);
  const [result, setResult] = useState<FindResult | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [found, setFound] = useState<FoundTrade[]>([]);
  const client = useRef<EngineClient | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const token = useRef(0);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const trainedRef = useRef(onTrained);
  trainedRef.current = onTrained;
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  /** The run whose server job the record names. */
  const serverJob = useRef<AbortController | null>(null);
  const unmounted = useRef(false);
  const getClient = (): EngineClient => (client.current ??= createEngineClient());

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      // A run on the server keeps going when the page closes: it is let go, not cancelled.
      if (!serverJob.current) ctl.current?.abort();
      client.current?.dispose();
      client.current = null;
    };
  }, []);

  const clearSelection = useCallback(() => {
    token.current++;
    setSelected(null);
    setFound([]);
  }, []);

  const loadersFor = useCallback(
    (): Loaders => ({
      provider: (s, signal) => loadFromProvider(getProvider(s.provider), { symbol: s.symbol, timeframe: s.timeframe as Timeframe, bars }, signal),
      library: (id) => {
        const d = libraryRef.current.find((x) => x.id === id);
        return d ? loadFromDataset(d) : { ok: false, error: 'This dataset is no longer in the library.' };
      },
    }),
    [bars],
  );
  const label = (s: HighlightSet['source']): string => sourceLabel(s, (id) => libraryRef.current.find((d) => d.id === id)?.name);

  /** Forgets the record of the server job `mine` started. */
  const release = (mine: AbortController): void => {
    if (serverJob.current !== mine) return;
    serverJob.current = null;
    if (!unmounted.current) hooksRef.current.keeper?.clear();
  };
  const serverHooks = (mine: AbortController, kind: JobRecord['kind'], context: () => JobContext | null) => ({
    onServerJob: (jobId: string) => {
      const c = context();
      if (mine.signal.aborted || !c) return;
      serverJob.current = mine;
      setRun((s) => ({ ...s, onServer: true }));
      hooksRef.current.keeper?.put({ id: 'job', version: 1, jobId, kind, started: Date.now(), context: c });
    },
    onFallback: (reason: string) => hooksRef.current.onFallback?.(reason),
    onAuto: (auto: AutoNote) => setRun((s) => ({ ...s, auto })),
  });

  const begin = (): AbortController => {
    ctl.current?.abort();
    const mine = new AbortController();
    ctl.current = mine;
    setError('');
    setRun({ ...IDLE, running: true });
    return mine;
  };
  const end = (mine: AbortController): void => {
    if (ctl.current === mine) {
      ctl.current = null;
      setRun(IDLE);
    }
  };
  const track =
    (onProgress?: (pct: number, stage: FindStage) => void) =>
    (pct: number, stage: FindStage, onPage: boolean): void => {
      onProgress?.(pct, stage);
      setRun((s) => (s.onPage === onPage ? s : { ...s, onPage }));
    };

  /** `model` is a model that is up to date for `sets` (in its training order): the run then skips training. */
  const start = useCallback(
    async (sets: HighlightSet[], inputs: FindInputs, model?: TrainResult) => {
      const mine = begin();
      const loaders = loadersFor();
      let context: JobContext | null = null;
      const server = serverHooks(mine, 'find', () => context);
      try {
        const r = await runFind({
          sets,
          inputs,
          loaders,
          label,
          model,
          signal: mine.signal,
          onLoaded: (info) =>
            (context = {
              kind: 'find',
              inputs,
              seriesLabels: info.seriesLabels,
              skippedSets: info.skippedSets,
              usedSetIds: info.usedSets.map((x) => x.id),
              reused: info.reused,
              trainedOn: trainedOnOf(info.usedSets),
            }),
          engine: (series, inp, signal, onProgress, trained) =>
            getClient().find(series, inp, { signal, model: trained, onProgress: track(onProgress), ...server }),
          onProgress: (pct, stage) => setRun((s) => (s.running ? { ...s, pct: Math.max(s.pct, pct), stage } : s)),
        });
        if (mine.signal.aborted) return;
        clearSelection();
        setResult(r);
        if (r.outcome.kind === 'ok' && !r.reused) trainedRef.current?.(r.outcome.model, r.usedSets);
      } catch (e) {
        if (mine.signal.aborted || isAbort(e)) return;
        setError(`The search stopped: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        release(mine);
        end(mine);
      }
    },
    [loadersFor, clearSelection],
  );

  /** Trains again on `sets` only, with the same progress and cancel as a find. */
  const retrain = useCallback(
    async (sets: HighlightSet[]) => {
      const mine = begin();
      let context: JobContext | null = null;
      const server = serverHooks(mine, 'train', () => context);
      try {
        const r = await runRetrain({
          sets,
          loaders: loadersFor(),
          label,
          signal: mine.signal,
          onLoaded: (info) =>
            (context = { kind: 'train', usedSetIds: info.usedSets.map((x) => x.id), skippedSets: info.skippedSets, trainedOn: trainedOnOf(info.usedSets) }),
          trainer: (series, signal, onProgress) => getClient().train(series, { signal, onProgress: track(onProgress), ...server }),
          onProgress: (pct, stage) => setRun((s) => (s.running ? { ...s, pct: Math.max(s.pct, pct), stage } : s)),
        });
        if (mine.signal.aborted) return;
        if (r.outcome.kind === 'trained') trainedRef.current?.(r.outcome.model, r.usedSets);
        else if (r.outcome.kind === 'too-few') setError(tooFewMessage(r.outcome.have, r.outcome.need));
        else setError(r.outcome.reason);
      } catch (e) {
        if (mine.signal.aborted || isAbort(e)) return;
        setError(`The training stopped: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        release(mine);
        end(mine);
      }
    },
    [loadersFor],
  );

  /** Stops the run; the page shows what it showed before Find was pressed. */
  const cancel = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setRun(IDLE);
  }, []);

  /** Shows what a find or a train job returned, rebuilt from the context kept when it started. */
  const present = (c: Extract<JobContext, { kind: 'find' | 'train' }>, outcome: EngineOutcome | TrainedOutcome, all: HighlightSet[]): void => {
    const p = presentOutcome(c, outcome, all);
    if (p.result) {
      clearSelection();
      setResult(p.result);
    }
    if (p.error) setError(p.error);
    if (p.trained) trainedRef.current?.(p.trained.model, p.trained.usedSets, p.trained.trainedOn);
  };

  /**
   * Picks up the run the page was waiting for when it was closed: follows it, shows its result or its error.
   * `all` is every saved set, to rebuild the sets the run used.
   */
  const adopt = useCallback(async (plan: ReattachPlan, all: HighlightSet[]): Promise<void> => {
    if (plan.action !== 'follow' && plan.action !== 'show' && plan.action !== 'failed') return;
    const { record } = plan;
    const c = record.context;
    if (c.kind === 'sweep') return;
    const stopped = (e: unknown): string => `${c.kind === 'find' ? 'The search' : 'The training'} stopped: ${e instanceof Error ? e.message : String(e)}`;
    if (plan.action === 'failed') {
      setError(stopped(new Error(plan.message)));
      hooksRef.current.keeper?.clear();
      return;
    }
    if (plan.action === 'show') {
      present(c, (plan.result as { outcome: EngineOutcome | TrainedOutcome }).outcome, all);
      hooksRef.current.keeper?.clear();
      return;
    }
    const mine = begin();
    serverJob.current = mine;
    setRun({ running: true, pct: plan.job.progress, stage: (plan.job.stage as FindStage | undefined) ?? 'Training', onPage: false, onServer: true });
    try {
      const o = {
        signal: mine.signal,
        onProgress: track((pct: number, stage: FindStage) => setRun((s) => (s.running ? { ...s, pct: Math.max(s.pct, pct), stage } : s))),
      };
      const outcome = c.kind === 'find' ? await getClient().resume('find', record.jobId, o) : await getClient().resume('train', record.jobId, o);
      if (mine.signal.aborted) return;
      present(c, outcome, all);
    } catch (e) {
      if (mine.signal.aborted || isAbort(e)) return;
      setError(stopped(e));
    } finally {
      release(mine);
      end(mine);
    }
  }, []);

  const select = useCallback(
    (c: Candidate | null, candles: Candle[]) => {
      const mine = ++token.current;
      if (!c || !result) {
        setSelected(null);
        setFound([]);
        return;
      }
      setSelected(candidateKey(c));
      getClient()
        .trades(candles, { strategyId: c.strategyId, params: c.params }, result.inputs)
        .then((t) => {
          if (token.current === mine) setFound(t);
        })
        .catch(() => {
          if (token.current === mine) setFound([]);
        });
    },
    [result],
  );

  return { run, result, error, selected, found, start, retrain, adopt, cancel, select, clearSelection, getClient };
}
