/**
 * The benchmark of Settings > Heavy jobs: five standard jobs, each timed once in the browser and once on the
 * server, saved as the settings document `benchmark.v1`. "Auto" reads that document to send each type of job
 * to whichever place was faster (`autoPlace`).
 *
 * This module holds the standard inputs, the run itself (with injectable runners and clock, so tests need
 * neither a worker nor a server), the document's reader and writer, and `autoPlace`. The runners that really
 * run the jobs are in `benchmarkRunners.ts`.
 */
import type { MonteCarloOptions } from './backtest/monteCarlo';
import type { OptimizeConfig } from './backtest/optimizer';
import { runFullBacktest } from './backtest/runner';
import { defaultBacktestConfig, type BacktestConfig, type Trade } from './backtest/types';
import { generateDemoCandles } from './providers/demo';
import { loadJson, saveJson } from './storage';
import type { Candle } from '../types';

export type JobSetting = 'browser' | 'server' | 'auto';
export type BenchmarkKind = 'run' | 'optimize' | 'montecarlo' | 'find' | 'sweep';
export const BENCHMARK_KINDS: readonly BenchmarkKind[] = ['run', 'optimize', 'montecarlo', 'find', 'sweep'];
export const BENCHMARK_KEY = 'benchmark.v1';
/** The scope of the server jobs the benchmark starts. */
export const BENCHMARK_SCOPE = 'benchmark';

export const BENCHMARK_LABEL: Record<BenchmarkKind, string> = {
  run: 'Backtest',
  optimize: 'Optimizer',
  montecarlo: 'Monte Carlo',
  find: 'Find',
  sweep: 'Market search',
};

/**
 * The standard inputs. They never change from one run to the next, so two benchmarks compare. The sizes are
 * picked so the browser side of each job takes about 0.3 to 5 s on a typical laptop (measured: the optimizer
 * about 1.2 s, the find 0.6 s and the market search 2.4 s on one core of a dev machine; the backtest and the
 * Monte Carlo run are short at the largest size the app takes, 20000 bars and 10000 iterations, and their
 * browser time is mostly the worker's start and the copy of the candles). Change a size and the old saved
 * benchmarks stop being comparable with new ones.
 */
export const BENCHMARK_INPUTS = {
  /** The demo candles every job (except the market search) runs on. */
  candles: { bars: 20000, timeframe: '1h', seed: 20240601, end: 1_717_200_000 },
  /** The strategy of the backtest, optimizer and Monte Carlo jobs. */
  strategyId: 'sma_cross',
  params: { fast: 10, slow: 30, direction: 1 },
  /** The optimizer's grid: 15 x 21 = 315 backtests. */
  optimize: { fast: { from: 4, to: 18, step: 1 }, slow: { from: 20, to: 60, step: 2 } },
  montecarlo: { iterations: 10000, method: 'shuffle', seed: 1 } as MonteCarloOptions,
  /** The find: trades marked on the demo candles at the benchmark backtest's own entries and exits. */
  find: { families: ['sma_cross', 'ema_cross'], feeBps: 10, slippageBps: 5 },
  /** The market search: one demo market, one timeframe and one family, a 3 x 3 exit grid. */
  sweep: {
    market: { provider: 'demo', symbol: 'DEMO' },
    timeframe: '1d',
    family: 'sma_cross',
    initialCapital: 10000,
    riskPct: 2,
    feeBps: 10,
    slippageBps: 5,
    stopMults: [1, 2, 3],
    tpMults: [1, 2, 3],
  },
} as const;

export interface BenchmarkInputs {
  candles: Candle[];
  config: BacktestConfig;
  optimize: OptimizeConfig;
  trades: Trade[];
  monteCarlo: MonteCarloOptions;
}

let built: BenchmarkInputs | null = null;

/** The standard inputs, built once (the Monte Carlo and find inputs come from running the benchmark backtest). The find and the market search take theirs from here too, in `strategyMaker/benchmarkJobs.ts`. */
export function benchmarkInputs(): BenchmarkInputs {
  if (built) return built;
  const c = BENCHMARK_INPUTS;
  const candles = generateDemoCandles({ bars: c.candles.bars, timeframe: c.candles.timeframe, seed: c.candles.seed, end: c.candles.end });
  const config: BacktestConfig = { ...defaultBacktestConfig(), strategyId: c.strategyId, params: { ...c.params } };
  const trades = runFullBacktest(candles, config).trades;
  built = {
    candles,
    config,
    optimize: {
      sweeps: [
        { key: 'fast', ...c.optimize.fast },
        { key: 'slow', ...c.optimize.slow },
      ],
      metric: 'totalReturnPct',
    },
    trades,
    monteCarlo: { ...c.montecarlo },
  };
  return built;
}

/* ---------------------------------------------------------------- the saved result */

export interface BenchmarkJobResult {
  /** null when the browser run did not finish (only in a document read from an older run; a browser failure cancels the whole run). */
  browserMs: number | null;
  /** null when the server could not run the job; `serverError` says why. */
  serverMs: number | null;
  serverError?: string;
}

export interface BenchmarkDoc {
  /** When the run finished, ms since the epoch. */
  at: number;
  userAgent: string;
  cores: number | null;
  serverVersion: string | null;
  jobs: Record<BenchmarkKind, BenchmarkJobResult>;
}

const isMs = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

/** Reads a stored document, checking every field; anything malformed is "no benchmark" (null). */
export function readBenchmark(raw: unknown): BenchmarkDoc | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.at !== 'number' || !Number.isFinite(d.at)) return null;
  if (typeof d.userAgent !== 'string') return null;
  if (d.cores !== null && !(typeof d.cores === 'number' && Number.isFinite(d.cores))) return null;
  if (d.serverVersion !== null && typeof d.serverVersion !== 'string') return null;
  if (typeof d.jobs !== 'object' || d.jobs === null || Array.isArray(d.jobs)) return null;
  const jobs = {} as Record<BenchmarkKind, BenchmarkJobResult>;
  for (const kind of BENCHMARK_KINDS) {
    const j = (d.jobs as Record<string, unknown>)[kind];
    if (typeof j !== 'object' || j === null || Array.isArray(j)) return null;
    const r = j as Record<string, unknown>;
    if (!isMs(r.browserMs) || !isMs(r.serverMs)) return null;
    if (r.serverError !== undefined && typeof r.serverError !== 'string') return null;
    jobs[kind] = { browserMs: r.browserMs, serverMs: r.serverMs, ...(r.serverError !== undefined ? { serverError: r.serverError } : {}) };
  }
  return { at: d.at, userAgent: d.userAgent, cores: d.cores as number | null, serverVersion: d.serverVersion as string | null, jobs };
}

export const loadBenchmark = (): BenchmarkDoc | null => readBenchmark(loadJson<unknown>(BENCHMARK_KEY, null));
export const saveBenchmark = (doc: BenchmarkDoc): void => void saveJson(BENCHMARK_KEY, doc);

/* ---------------------------------------------------------------- Auto */

/** The job kinds Auto settles: the benchmark's five, and Retrain (`train`), which uses the find's measurement. */
export type AutoKind = BenchmarkKind | 'train';

export interface AutoChoice {
  where: 'browser' | 'server';
  /** False when there was no usable measurement for the type (Auto fell back to the browser for want of one). */
  measured: boolean;
  /** The figures Auto compared; null when not measured. */
  benchmark: { browserMs: number | null; serverMs: number | null; at: number } | null;
}

/** Where Auto sends a job of this type: the server when the benchmark has both times and the server was faster. */
export function autoChoice(kind: AutoKind, doc: BenchmarkDoc | null): AutoChoice {
  const job = doc?.jobs[kind === 'train' ? 'find' : kind];
  if (!doc || !job) return { where: 'browser', measured: false, benchmark: null };
  const benchmark = { browserMs: job.browserMs, serverMs: job.serverMs, at: doc.at };
  if (job.browserMs === null || job.serverMs === null) return { where: 'browser', measured: false, benchmark };
  return { where: job.serverMs < job.browserMs ? 'server' : 'browser', measured: true, benchmark };
}

export const autoPlace = (kind: AutoKind, doc: BenchmarkDoc | null): 'browser' | 'server' => autoChoice(kind, doc).where;

/** The note a finish message carries when Auto had nothing to choose by. */
export const AUTO_UNMEASURED = '(Auto: run the benchmark to let Auto choose)';

/** Reads the stored `jobPlace` setting; anything but a known value is the browser. */
export const sanitizeJobSetting = (v: unknown): JobSetting => (v === 'server' || v === 'auto' ? v : 'browser');

/* ---------------------------------------------------------------- the run */

export interface BenchmarkRunners {
  /** Runs one standard job in the browser and resolves when its result is in. */
  browser(kind: BenchmarkKind, signal: AbortSignal): Promise<unknown>;
  /** Runs it on the server, end to end; rejects with `ServerUnavailableError` when the server cannot take it. */
  server(kind: BenchmarkKind, signal: AbortSignal): Promise<unknown>;
  /** The server's version, or null when it cannot be read. */
  serverVersion(): Promise<string | null>;
}

export interface BenchmarkClock {
  /** A monotonic clock in ms (`performance.now`). */
  perf(): number;
  /** Wall-clock ms since the epoch (`Date.now`). */
  epoch(): number;
}

export interface BenchmarkStep {
  kind: BenchmarkKind;
  where: 'browser' | 'server';
  /** 1-based */
  step: number;
  total: number;
}

export const progressText = (s: BenchmarkStep): string => `Benchmark: ${BENCHMARK_LABEL[s.kind]} ${s.where === 'server' ? 'on the server' : 'in the browser'}, ${s.step} of ${s.total}`;

export interface BenchmarkMachine {
  userAgent: string;
  cores: number | null;
}

const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';
const abortError = (): Error => new DOMException('The benchmark was cancelled', 'AbortError');
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Runs the five jobs one at a time, in order, browser first and then server for each type, and saves the
 * result (replacing an earlier one). A cancelled run (the signal) rejects with an AbortError and saves nothing,
 * and so does a job that fails in the browser. A job the server cannot take keeps its browser time and gets
 * `serverMs: null` with the reason; so does a job the server runs and fails.
 */
export async function runBenchmark(
  runners: BenchmarkRunners,
  clock: BenchmarkClock,
  onProgress: (s: BenchmarkStep) => void,
  signal: AbortSignal,
  machine: BenchmarkMachine,
): Promise<BenchmarkDoc> {
  const total = BENCHMARK_KINDS.length * 2;
  const jobs = {} as Record<BenchmarkKind, BenchmarkJobResult>;
  let step = 0;
  const time = async (kind: BenchmarkKind, where: 'browser' | 'server'): Promise<number> => {
    if (signal.aborted) throw abortError();
    onProgress({ kind, where, step: ++step, total });
    const t0 = clock.perf();
    await runners[where](kind, signal);
    const ms = clock.perf() - t0;
    if (signal.aborted) throw abortError();
    return ms;
  };
  for (const kind of BENCHMARK_KINDS) {
    const browserMs = await time(kind, 'browser');
    try {
      jobs[kind] = { browserMs, serverMs: await time(kind, 'server') };
    } catch (err) {
      if (isAbort(err) || signal.aborted) throw abortError();
      jobs[kind] = { browserMs, serverMs: null, serverError: errText(err) };
    }
  }
  if (signal.aborted) throw abortError();
  const serverVersion = await runners.serverVersion().catch(() => null);
  if (signal.aborted) throw abortError();
  const doc: BenchmarkDoc = { at: clock.epoch(), userAgent: machine.userAgent, cores: machine.cores, serverVersion, jobs };
  saveBenchmark(doc);
  return doc;
}

/** ms as "840 ms" under a second and "1.2 s" from there. */
export const formatMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
