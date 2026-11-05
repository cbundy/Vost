/** Run state of Find: progress, cancel, the result, and the trades of the result row the user selected. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle, Timeframe } from '../../../shared/market.ts';
import { getProvider } from '../lib/providers';
import type { Dataset } from '../types';
import { loadFromDataset, loadFromProvider } from './data';
import type { Candidate } from './engine';
import { createEngineClient, type EngineClient } from './engineClient';
import { candidateKey } from './Results';
import { runFind, sourceLabel, type FindInputs, type FindResult, type FoundTrade, type Loaders } from './run';
import type { HighlightSet } from './store';
import type { RunState } from './TargetsForm';

const IDLE: RunState = { running: false, pct: 0, stage: 'Loading data', onPage: false };

const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

export function useFind(bars: number, library: Dataset[]) {
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

  const start = useCallback(
    async (sets: HighlightSet[], inputs: FindInputs) => {
      ctl.current?.abort();
      const mine = new AbortController();
      ctl.current = mine;
      setError('');
      setRun({ ...IDLE, running: true });
      const loaders: Loaders = {
        provider: (s, signal) =>
          loadFromProvider(getProvider(s.provider), { symbol: s.symbol, timeframe: s.timeframe as Timeframe, bars }, signal),
        library: (id) => {
          const d = libraryRef.current.find((x) => x.id === id);
          return d ? loadFromDataset(d) : { ok: false, error: 'This dataset is no longer in the library.' };
        },
      };
      const label = (s: HighlightSet['source']): string => sourceLabel(s, (id) => libraryRef.current.find((d) => d.id === id)?.name);
      try {
        const r = await runFind({
          sets,
          inputs,
          loaders,
          label,
          signal: mine.signal,
          engine: (series, inp, signal, onProgress) =>
            getClient().find(series, inp, {
              signal,
              onProgress: (pct, stage, onPage) => {
                onProgress?.(pct, stage);
                setRun((s) => (s.onPage === onPage ? s : { ...s, onPage }));
              },
            }),
          onProgress: (pct, stage) => setRun((s) => (s.running ? { ...s, pct: Math.max(s.pct, pct), stage } : s)),
        });
        if (mine.signal.aborted) return;
        clearSelection();
        setResult(r);
      } catch (e) {
        if (mine.signal.aborted || isAbort(e)) return;
        setError(`The search stopped: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (ctl.current === mine) {
          ctl.current = null;
          setRun(IDLE);
        }
      }
    },
    [bars, clearSelection],
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

  return { run, result, error, selected, found, start, cancel, select, clearSelection };
}
