/** Run state of the market search: progress, cancel and the result with the risk it was run with. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineClient } from './engineClient';
import type { JobKeeper, ReattachPlan } from './reattach';
import type { SweepInput, SweepResult, SweepRisk } from './sweep/types';

export interface SweepRun {
  running: boolean;
  pct: number;
  label: string;
  /** The run is a job on the Vost server, which keeps going when the page closes. */
  onServer: boolean;
}

const IDLE: SweepRun = { running: false, pct: 0, label: '', onServer: false };
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

export interface SweepDone {
  result: SweepResult;
  /** The sizing the run used, which "Open in Backtest" repeats even when the form has changed since. */
  risk: SweepRisk;
}

export interface SweepHooks {
  /** Keeps the record of the server job the run is waiting for. */
  keeper?: JobKeeper;
  /** The server could not take the run, so it happens in the browser. */
  onFallback?: (reason: string) => void;
}

/** `getClient` is the page's engine client, so a Find or a Search replaces the run before it. */
export function useSweep(getClient: () => EngineClient, hooks: SweepHooks = {}) {
  const [run, setRun] = useState<SweepRun>(IDLE);
  const [done, setDone] = useState<SweepDone | null>(null);
  const [error, setError] = useState('');
  const ctl = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  /** The run whose server job the record names. */
  const serverJob = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A run on the server keeps going when the page closes: it is let go, not cancelled.
      if (!serverJob.current) ctl.current?.abort();
    };
  }, []);

  const release = (mine: AbortController): void => {
    if (serverJob.current !== mine) return;
    serverJob.current = null;
    if (mounted.current) hooksRef.current.keeper?.clear();
  };

  const start = useCallback(
    async (input: SweepInput) => {
      ctl.current?.abort();
      const mine = new AbortController();
      ctl.current = mine;
      setError('');
      setRun({ ...IDLE, running: true });
      try {
        const result = await getClient().sweep(input, {
          signal: mine.signal,
          onProgress: (p) => {
            if (!mine.signal.aborted) setRun((s) => (s.running ? { ...s, pct: Math.max(s.pct, p.pct), label: p.label } : s));
          },
          onServerJob: (jobId) => {
            if (mine.signal.aborted) return;
            serverJob.current = mine;
            setRun((s) => ({ ...s, onServer: true }));
            hooksRef.current.keeper?.put({ id: 'job', version: 1, jobId, kind: 'sweep', started: Date.now(), context: { kind: 'sweep', risk: input.risk } });
          },
          onFallback: (reason) => hooksRef.current.onFallback?.(reason),
        });
        if (mine.signal.aborted) return;
        setDone({ result, risk: input.risk });
      } catch (e) {
        if (mine.signal.aborted || isAbort(e)) return;
        setError(`The search stopped: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        release(mine);
        if (ctl.current === mine) {
          ctl.current = null;
          if (mounted.current) setRun(IDLE);
        }
      }
    },
    [getClient],
  );

  /** Picks up the market search the page was waiting for when it was closed. */
  const adopt = useCallback(
    async (plan: ReattachPlan): Promise<void> => {
      if (plan.action !== 'follow' && plan.action !== 'show' && plan.action !== 'failed') return;
      const c = plan.record.context;
      if (c.kind !== 'sweep') return;
      if (plan.action === 'failed') {
        setError(`The search stopped: ${plan.message}`);
        hooksRef.current.keeper?.clear();
        return;
      }
      if (plan.action === 'show') {
        setDone({ result: (plan.result as { result: SweepResult }).result, risk: c.risk });
        hooksRef.current.keeper?.clear();
        return;
      }
      ctl.current?.abort();
      const mine = new AbortController();
      ctl.current = mine;
      serverJob.current = mine;
      setError('');
      setRun({ running: true, pct: plan.job.progress, label: plan.job.stage ?? '', onServer: true });
      try {
        const result = await getClient().resume('sweep', plan.record.jobId, {
          signal: mine.signal,
          onProgress: (p) => {
            if (!mine.signal.aborted) setRun((s) => (s.running ? { ...s, pct: Math.max(s.pct, p.pct), label: p.label } : s));
          },
        });
        if (mine.signal.aborted) return;
        setDone({ result, risk: c.risk });
      } catch (e) {
        if (mine.signal.aborted || isAbort(e)) return;
        setError(`The search stopped: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        release(mine);
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

  return { run, done, error, start, adopt, cancel };
}
