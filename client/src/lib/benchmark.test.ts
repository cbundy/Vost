import { beforeEach, describe, expect, it } from 'vitest';
import {
  autoChoice,
  autoPlace,
  BENCHMARK_KEY,
  BENCHMARK_KINDS,
  benchmarkInputs,
  formatMs,
  loadBenchmark,
  progressText,
  readBenchmark,
  runBenchmark,
  sanitizeJobSetting,
  type BenchmarkDoc,
  type BenchmarkKind,
  type BenchmarkRunners,
  type BenchmarkStep,
} from './benchmark';
import { loadJson, seedStorageForTest } from './storage';
import { ServerUnavailableError } from './serverJobs';

const machine = { userAgent: 'test-agent', cores: 8 };

/** Runners that take a set time on a fake clock and log the order they were called in. */
function fake(ms: (kind: BenchmarkKind, where: 'browser' | 'server') => number, opts: { serverFails?: (kind: BenchmarkKind) => Error | undefined; version?: string | null } = {}) {
  let t = 0;
  const calls: string[] = [];
  let running = 0;
  let overlap = false;
  const run = (where: 'browser' | 'server') => async (kind: BenchmarkKind): Promise<void> => {
    if (running++ > 0) overlap = true;
    calls.push(`${kind}:${where}`);
    await Promise.resolve();
    running--;
    const err = where === 'server' ? opts.serverFails?.(kind) : undefined;
    if (err) throw err;
    t += ms(kind, where);
  };
  const runners: BenchmarkRunners = { browser: run('browser'), server: run('server'), serverVersion: async () => (opts.version === undefined ? '1.2.3' : opts.version) };
  return { runners, calls, clock: { perf: () => t, epoch: () => 1700000000000 }, overlapped: () => overlap };
}

beforeEach(() => seedStorageForTest());

describe('runBenchmark', () => {
  it('times each type in the browser then on the server, one at a time, in order, and saves the document', async () => {
    const f = fake((k, w) => (w === 'browser' ? 100 : 40) + BENCHMARK_KINDS.indexOf(k));
    const steps: BenchmarkStep[] = [];
    const doc = await runBenchmark(f.runners, f.clock, (s) => steps.push(s), new AbortController().signal, machine);
    expect(f.calls).toEqual(BENCHMARK_KINDS.flatMap((k) => [`${k}:browser`, `${k}:server`]));
    expect(f.overlapped()).toBe(false);
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(progressText(steps[3])).toBe('Benchmark: Optimizer on the server, 4 of 10');
    expect(progressText(steps[0])).toBe('Benchmark: Backtest in the browser, 1 of 10');
    expect(doc).toEqual({
      at: 1700000000000,
      userAgent: 'test-agent',
      cores: 8,
      serverVersion: '1.2.3',
      jobs: {
        run: { browserMs: 100, serverMs: 40 },
        optimize: { browserMs: 101, serverMs: 41 },
        montecarlo: { browserMs: 102, serverMs: 42 },
        find: { browserMs: 103, serverMs: 43 },
        sweep: { browserMs: 104, serverMs: 44 },
      },
    });
    expect(loadJson(BENCHMARK_KEY, null)).toEqual(doc);
    expect(loadBenchmark()).toEqual(doc);
  });

  it('keeps the browser time and records the reason when the server cannot take a job', async () => {
    const f = fake(() => 50, { serverFails: (k) => (k === 'find' ? new ServerUnavailableError('the server cannot be reached') : undefined) });
    const doc = await runBenchmark(f.runners, f.clock, () => {}, new AbortController().signal, machine);
    expect(doc.jobs.find).toEqual({ browserMs: 50, serverMs: null, serverError: 'the server cannot be reached' });
    expect(doc.jobs.sweep).toEqual({ browserMs: 50, serverMs: 50 });
    expect(autoPlace('find', doc)).toBe('browser');
  });

  it('a server job that fails is recorded as unavailable too, and the run goes on', async () => {
    const f = fake(() => 50, { serverFails: (k) => (k === 'run' ? new Error('boom') : undefined) });
    const doc = await runBenchmark(f.runners, f.clock, () => {}, new AbortController().signal, machine);
    expect(doc.jobs.run).toMatchObject({ browserMs: 50, serverMs: null, serverError: 'boom' });
    expect(f.calls).toHaveLength(10);
  });

  it('saves a null server version when the status cannot be read', async () => {
    const f = fake(() => 1);
    f.runners.serverVersion = () => Promise.reject(new Error('down'));
    expect((await runBenchmark(f.runners, f.clock, () => {}, new AbortController().signal, machine)).serverVersion).toBeNull();
  });

  it('a cancelled run saves nothing and keeps the earlier result', async () => {
    const earlier: BenchmarkDoc = { at: 5, userAgent: 'old', cores: null, serverVersion: null, jobs: Object.fromEntries(BENCHMARK_KINDS.map((k) => [k, { browserMs: 1, serverMs: 2 }])) as BenchmarkDoc['jobs'] };
    seedStorageForTest({ [BENCHMARK_KEY]: earlier });
    const f = fake(() => 10);
    const ctl = new AbortController();
    const run = runBenchmark(f.runners, f.clock, (s) => s.step === 4 && ctl.abort(), ctl.signal, machine);
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.calls.length).toBeLessThan(10);
    expect(loadBenchmark()).toEqual(earlier);
  });

  it('a browser failure stops the run and saves nothing', async () => {
    const f = fake(() => 10);
    f.runners.browser = async () => {
      throw new Error('worker crashed');
    };
    await expect(runBenchmark(f.runners, f.clock, () => {}, new AbortController().signal, machine)).rejects.toThrow('worker crashed');
    expect(loadBenchmark()).toBeNull();
  });

  it('a second run replaces the first', async () => {
    await runBenchmark(fake(() => 10).runners, fake(() => 10).clock, () => {}, new AbortController().signal, machine);
    const f = fake(() => 20);
    await runBenchmark(f.runners, f.clock, () => {}, new AbortController().signal, machine);
    expect(loadBenchmark()?.jobs.run.browserMs).toBe(20);
  });
});

describe('readBenchmark', () => {
  const good = (): BenchmarkDoc => ({
    at: 1,
    userAgent: 'ua',
    cores: null,
    serverVersion: null,
    jobs: Object.fromEntries(BENCHMARK_KINDS.map((k) => [k, { browserMs: 10, serverMs: null, serverError: 'x' }])) as BenchmarkDoc['jobs'],
  });

  it('reads a good document back unchanged', () => {
    expect(readBenchmark(good())).toEqual(good());
  });

  it('turns every malformed document into no benchmark', () => {
    const bads: unknown[] = [null, 3, 'x', [], {}];
    const mutate = (f: (d: Record<string, unknown>) => void): unknown => {
      const d = JSON.parse(JSON.stringify(good())) as Record<string, unknown>;
      f(d);
      return d;
    };
    bads.push(
      mutate((d) => delete d.at),
      mutate((d) => (d.at = 'now')),
      mutate((d) => (d.at = Infinity)),
      mutate((d) => delete d.userAgent),
      mutate((d) => (d.cores = '8')),
      mutate((d) => (d.serverVersion = 3)),
      mutate((d) => delete d.jobs),
      mutate((d) => (d.jobs = [])),
      mutate((d) => delete (d.jobs as Record<string, unknown>).sweep),
      mutate((d) => ((d.jobs as Record<string, unknown>).run = null)),
      mutate((d) => (((d.jobs as Record<string, Record<string, unknown>>).run).browserMs = '5')),
      mutate((d) => (((d.jobs as Record<string, Record<string, unknown>>).run).serverMs = -1)),
      mutate((d) => (((d.jobs as Record<string, Record<string, unknown>>).run).serverMs = undefined)),
      mutate((d) => (((d.jobs as Record<string, Record<string, unknown>>).run).serverError = 4)),
    );
    for (const b of bads) expect(readBenchmark(b)).toBeNull();
  });

  it('loadBenchmark reads a stored malformed document as none', () => {
    seedStorageForTest({ [BENCHMARK_KEY]: { at: 'x' } });
    expect(loadBenchmark()).toBeNull();
  });
});

describe('autoPlace', () => {
  const doc = (jobs: Partial<Record<BenchmarkKind, [number | null, number | null]>>): BenchmarkDoc => ({
    at: 9,
    userAgent: 'ua',
    cores: 2,
    serverVersion: null,
    jobs: Object.fromEntries(BENCHMARK_KINDS.map((k) => [k, { browserMs: jobs[k]?.[0] ?? null, serverMs: jobs[k]?.[1] ?? null }])) as BenchmarkDoc['jobs'],
  });

  it('is the server when it was faster, the browser when it was slower or equal', () => {
    const d = doc({ run: [100, 50], optimize: [100, 100], montecarlo: [100, 150] });
    expect(autoPlace('run', d)).toBe('server');
    expect(autoPlace('optimize', d)).toBe('browser');
    expect(autoPlace('montecarlo', d)).toBe('browser');
  });

  it('is the browser when a type is unmeasured, the server time is null, or there is no document', () => {
    const d = doc({ run: [100, null], optimize: [null, 100] });
    expect(autoPlace('run', d)).toBe('browser');
    expect(autoPlace('optimize', d)).toBe('browser');
    expect(autoPlace('sweep', d)).toBe('browser');
    expect(autoPlace('run', null)).toBe('browser');
    expect(autoChoice('run', d).measured).toBe(false);
    expect(autoChoice('run', null)).toEqual({ where: 'browser', measured: false, benchmark: null });
  });

  it('Retrain uses the find measurement', () => {
    const d = doc({ find: [100, 10], sweep: [10, 100] });
    expect(autoPlace('train', d)).toBe('server');
    expect(autoPlace('train', doc({ find: [10, 100], run: [100, 10] }))).toBe('browser');
  });

  it('reports the figures it compared', () => {
    expect(autoChoice('find', doc({ find: [100, 10] }))).toEqual({ where: 'server', measured: true, benchmark: { browserMs: 100, serverMs: 10, at: 9 } });
  });
});

describe('the setting and the standard inputs', () => {
  it('reads any other value as browser', () => {
    expect(sanitizeJobSetting('auto')).toBe('auto');
    expect(sanitizeJobSetting('server')).toBe('server');
    for (const v of ['Auto', 'x', 1, null, undefined, true, {}]) expect(sanitizeJobSetting(v)).toBe('browser');
  });

  it('builds the same inputs every time, with enough marked trades for the find', () => {
    const a = benchmarkInputs();
    expect(a).toBe(benchmarkInputs());
    expect(a.candles.length).toBeGreaterThan(1000);
    expect(a.trades.length).toBeGreaterThanOrEqual(30);
    expect(a.candles[0].time).toBe(benchmarkInputs().candles[0].time);
  });

  it('formats times as ms or s', () => {
    expect(formatMs(12.4)).toBe('12 ms');
    expect(formatMs(999)).toBe('999 ms');
    expect(formatMs(1234)).toBe('1.2 s');
    expect(formatMs(12345)).toBe('12 s');
  });
});
