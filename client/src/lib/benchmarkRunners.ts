/**
 * The runners the benchmark uses for real: each standard job, forced to one place. The browser side goes
 * through the same worker calls and engine client the app uses; the server side through the same dispatchers
 * and client, with the place forced and no fallback (a server that cannot take a job says so instead of the
 * job quietly running in the browser). The scope `benchmark` keeps these jobs apart from the charts' and the
 * strategy maker's, and nothing here writes a job record.
 */
import { CancelledError, optimizerCall, workerCall } from '../state/worker';
import { runJob, runOptimizerJob, type JobRun } from '../state/jobs';
import { fetchStatus } from './status';
import { benchmarkInputs, BENCHMARK_INPUTS, BENCHMARK_SCOPE, type BenchmarkKind, type BenchmarkRunners } from './benchmark';

const abortError = (): Error => new DOMException('The benchmark was cancelled', 'AbortError');

/** Runs `job` until it ends; the signal cancels it. */
function follow(job: { promise: Promise<unknown>; cancel: () => void }, signal: AbortSignal): Promise<unknown> {
  const onAbort = (): void => job.cancel();
  signal.addEventListener('abort', onAbort, { once: true });
  return job.promise
    .catch((e: unknown) => {
      throw e instanceof CancelledError ? abortError() : e;
    })
    .finally(() => signal.removeEventListener('abort', onAbort));
}

/** The real runners, and a function that ends the workers and clients they made. */
export function createBenchmarkRunners(): { runners: BenchmarkRunners; dispose: () => void } {
  // The find and the market search belong to the strategy maker, which is loaded only when they run. Its engine
  // clients (a worker each) are ended by `dispose`.
  const load = () => import('../strategyMaker/benchmarkJobs').then((m) => m.createMakerRunner());
  let maker: ReturnType<typeof load> | null = null;
  const makerRunner = () => (maker ??= load());

  const at = (where: 'browser' | 'server') => async (kind: BenchmarkKind, signal: AbortSignal): Promise<unknown> => {
    if (signal.aborted) throw abortError();
    const i = benchmarkInputs();
    const setting = where;
    switch (kind) {
      case 'run': {
        if (where === 'browser') return follow({ promise: workerCall({ type: 'run', candles: i.candles, config: i.config }), cancel: () => {} }, signal);
        return follow(runJob(setting, BENCHMARK_SCOPE, { type: 'run', candles: i.candles, config: i.config }, undefined, { noFallback: true }), signal);
      }
      case 'optimize': {
        const req = { type: 'optimize' as const, candles: i.candles, config: i.config, optimize: i.optimize };
        if (where === 'browser') return follow(optimizerCall(req), signal);
        return follow(runOptimizerJob(setting, BENCHMARK_SCOPE, req, undefined, { noFallback: true }), signal);
      }
      case 'montecarlo': {
        const req = { type: 'montecarlo' as const, trades: i.trades, initialCapital: i.config.initialCapital, options: i.monteCarlo };
        if (where === 'browser') return follow({ promise: workerCall(req), cancel: () => {} }, signal);
        const job: JobRun = runJob(setting, BENCHMARK_SCOPE, req, undefined, { noFallback: true, strategyId: BENCHMARK_INPUTS.strategyId });
        return follow(job, signal);
      }
      case 'find':
      case 'sweep':
        return (await makerRunner()).run(kind, where, signal);
    }
  };

  return {
    runners: {
      browser: at('browser'),
      server: at('server'),
      serverVersion: () => fetchStatus().then((r) => r.server.version ?? null),
    },
    dispose() {
      void maker?.then((m) => m.dispose());
      maker = null;
    },
  };
}
