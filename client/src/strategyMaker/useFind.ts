/** Run state of Find: progress, cancel, the result, and the trades of the result row the user selected. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle, Timeframe } from '../../../shared/market.ts';
import { getProvider } from '../lib/providers';
import type { Dataset } from '../types';
import { loadFromDataset, loadFromProvider } from './data';
import type { Candidate, TrainResult } from './engine';
import { createEngineClient, type EngineClient } from './engineClient';
import { candidateKey } from './Results';
import { runFind, runRetrain, sourceLabel, tooFewMessage, type FindInputs, type FindResult, type FoundTrade, type Loaders } from './run';
import type { HighlightSet } from './store';
import type { RunState } from './TargetsForm';
import type { FindStage } from './run';

const IDLE: RunState = { running: false, pct: 0, stage: 'Loading data', onPage: false };

const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

/** Called with each model a run trained (not one it reused) and the sets it was trained on, in training order. */
export type OnTrained = (model: TrainResult, usedSets: HighlightSet[]) => void;

export function useFind(bars: number, library: Dataset[], onTrained?: OnTrained) {
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
  const getClient = (): EngineClient => (client.current ??= createEngineClient());

  useEffect(
    () => () => {
      ctl.current?.abort();
      client.current?.dispose();
      client.current = null;
    },
    [],
  );

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
      try {
        const r = await runFind({
          sets,
          inputs,
          loaders,
          label,
          model,
          signal: mine.signal,
          engine: (series, inp, signal, onProgress, trained) =>
            getClient().find(series, inp, { signal, model: trained, onProgress: track(onProgress) }),
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
        end(mine);
      }
    },
    [loadersFor, clearSelection],
  );

  /** Trains again on `sets` only, with the same progress and cancel as a find. */
  const retrain = useCallback(
    async (sets: HighlightSet[]) => {
      const mine = begin();
      try {
        const r = await runRetrain({
          sets,
          loaders: loadersFor(),
          label,
          signal: mine.signal,
          trainer: (series, signal, onProgress) => getClient().train(series, { signal, onProgress: track(onProgress) }),
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

  return { run, result, error, selected, found, start, retrain, cancel, select, clearSelection };
}
