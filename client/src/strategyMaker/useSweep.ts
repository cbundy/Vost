/** Run state of the market search: progress, cancel and the result with the risk it was run with. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineClient } from './engineClient';
import type { SweepInput, SweepResult, SweepRisk } from './sweep/types';

export interface SweepRun {
  running: boolean;
  pct: number;
  label: string;
}

const IDLE: SweepRun = { running: false, pct: 0, label: '' };
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

export interface SweepDone {
  result: SweepResult;
  /** The sizing the run used, which "Open in Backtest" repeats even when the form has changed since. */
  risk: SweepRisk;
}

/** `getClient` is the page's engine client, so a Find or a Search replaces the run before it. */
export function useSweep(getClient: () => EngineClient) {
  const [run, setRun] = useState<SweepRun>(IDLE);
  const [done, setDone] = useState<SweepDone | null>(null);
  const [error, setError] = useState('');
  const ctl = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      ctl.current?.abort();
    },
    [],
  );

  const start = useCallback(
    async (input: SweepInput) => {
      ctl.current?.abort();
      const mine = new AbortController();
      ctl.current = mine;
      setError('');
      setRun({ running: true, pct: 0, label: '' });
      try {
        const result = await getClient().sweep(input, {
          signal: mine.signal,
          onProgress: (p) => {
            if (!mine.signal.aborted) setRun((s) => (s.running ? { running: true, pct: Math.max(s.pct, p.pct), label: p.label } : s));
          },
        });
        if (mine.signal.aborted) return;
        setDone({ result, risk: input.risk });
      } catch (e) {
        if (mine.signal.aborted || isAbort(e)) return;
        setError(`The search stopped: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (ctl.current === mine) {
          ctl.current = null;
          if (mounted.current) setRun(IDLE);
        }
      }
    },
    [getClient],
  );

  /** Stops the run; the panel shows what it showed before Run was pressed. */
  const cancel = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    setRun(IDLE);
  }, []);

  return { run, done, error, start, cancel };
}
