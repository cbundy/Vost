/** Settings > Heavy jobs: run the benchmark (five standard jobs, in the browser and on the server) and show the saved result. */
import { useEffect, useRef, useState } from 'react';
import {
  BENCHMARK_KINDS,
  BENCHMARK_LABEL,
  formatMs,
  progressText,
  runBenchmark,
  type BenchmarkDoc,
  type BenchmarkJobResult,
  type BenchmarkStep,
} from '../lib/benchmark';
import { createBenchmarkRunners } from '../lib/benchmarkRunners';

/** Which place was faster for a job: the server only when it was strictly quicker (as Auto reads it). */
export function fasterOf(j: BenchmarkJobResult): 'Browser' | 'Server' | '-' {
  if (j.browserMs === null) return j.serverMs === null ? '-' : 'Server';
  return j.serverMs !== null && j.serverMs < j.browserMs ? 'Server' : 'Browser';
}

const when = (at: number): string => new Date(at).toLocaleString();

export function BenchmarkSection({ doc, onDoc }: { doc: BenchmarkDoc | null; onDoc: (d: BenchmarkDoc) => void }) {
  const [step, setStep] = useState<BenchmarkStep | null>(null);
  const [note, setNote] = useState('');
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const running = step !== null;

  const run = async (): Promise<void> => {
    const mine = new AbortController();
    ctl.current = mine;
    const { runners, dispose } = createBenchmarkRunners();
    setNote('');
    setStep({ kind: BENCHMARK_KINDS[0], where: 'browser', step: 1, total: BENCHMARK_KINDS.length * 2 });
    try {
      const next = await runBenchmark(
        runners,
        { perf: () => performance.now(), epoch: () => Date.now() },
        (s) => !mine.signal.aborted && setStep(s),
        mine.signal,
        { userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency ?? null },
      );
      onDoc(next);
    } catch (e) {
      setNote(mine.signal.aborted || (e instanceof Error && e.name === 'AbortError') ? 'Benchmark cancelled; the earlier result is kept.' : `Benchmark stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      dispose();
      if (ctl.current === mine) ctl.current = null;
      setStep(null);
    }
  };

  return (
    <div className="settings-row settings-benchmark">
      <div className="settings-benchmark-bar">
        <button type="button" onClick={() => void run()} disabled={running}>
          Run benchmark
        </button>
        {running && (
          <button type="button" onClick={() => ctl.current?.abort()}>
            Cancel
          </button>
        )}
      </div>
      {running ? (
        <p className="hint" role="status" aria-live="polite">
          {progressText(step)}
        </p>
      ) : (
        <p className="hint">
          {doc ? `Last run ${when(doc.at)}${doc.serverVersion ? ` (server ${doc.serverVersion})` : ''}.` : 'Times five standard jobs in this browser and on the server, so Auto can pick the faster place for each.'}
        </p>
      )}
      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}
      {doc && (
        <div className="table-wrap">
          <table className="data-table settings-benchmark-table" aria-label="Benchmark result">
            <thead>
              <tr>
                <th>Job</th>
                <th>Browser</th>
                <th>Server</th>
                <th>Faster</th>
              </tr>
            </thead>
            <tbody>
              {BENCHMARK_KINDS.map((kind) => {
                const j = doc.jobs[kind];
                return (
                  <tr key={kind}>
                    <td>{BENCHMARK_LABEL[kind]}</td>
                    <td>{j.browserMs === null ? '-' : formatMs(j.browserMs)}</td>
                    <td title={j.serverError}>{j.serverMs === null ? 'Unavailable' : formatMs(j.serverMs)}</td>
                    <td>{fasterOf(j)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {doc && BENCHMARK_KINDS.some((k) => doc.jobs[k].serverError) && (
        <p className="hint">
          Server unavailable: {[...new Set(BENCHMARK_KINDS.map((k) => doc.jobs[k].serverError).filter(Boolean))].join('; ')}
        </p>
      )}
    </div>
  );
}
