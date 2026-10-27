/**
 * Runs the probes: a first round shortly after start, then one round every
 * interval, each probe starting a fixed gap after the previous one. Symbol
 * probes run only every 10th round; a manual refresh runs everything but never
 * more than once per 15 s. Timers are injected and `stop()` clears them all.
 */
import { statusKeys, type StatusCheck, type StatusFeed, type StatusResponse } from '../../shared/status.ts';
import type { FeedStats } from '../live/relay.ts';
import { realTimers, type Timers } from '../live/socket.ts';
import { runProbe, type ProbeEnv } from './probes.ts';
import { createRegistry, type CheckResult, type Registry } from './registry.ts';

/** Delay before the first background round. */
export const FIRST_ROUND_DELAY_MS = 3000;
/** Gap between the starts of two probes of one round. */
export const STAGGER_MS = 250;
/** Symbol probes run on every Nth background round. */
export const SYMBOLS_EVERY = 10;
/** A refresh within this long of the last started round reuses it. */
export const REFRESH_REUSE_MS = 15_000;

export interface SchedulerDeps {
  registry: Registry;
  /** Seconds between rounds; 0 turns the background rounds off. */
  intervalSeconds: number;
  timers?: Timers;
  now?: () => number;
  /** The relay's feed stats: a provider with an open feed is not probed for `live`. */
  relayStats?: () => FeedStats[];
  probe?: (provider: string, feed: StatusFeed) => Promise<CheckResult>;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Runs a full round and resolves when it finished; `refreshed` is false when it joined or reused one. */
  refresh(): Promise<{ refreshed: boolean }>;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const timers = deps.timers ?? realTimers;
  const now = deps.now ?? Date.now;
  const relayStats = deps.relayStats ?? (() => []);
  const probe = deps.probe ?? ((provider, feed) => runProbe(provider, feed));
  const keys = statusKeys();
  let rounds = 0;
  let running: Promise<void> | null = null;
  let lastStartedAt: number | null = null;
  let cancelRound: (() => void) | null = null;
  let stopped = false;
  let firstTimer: unknown;
  let intervalTimer: unknown;
  const startTimers = new Set<unknown>();

  const probeOne = async (provider: string, feed: StatusFeed): Promise<void> => {
    if (feed === 'live' && relayStats().some((s) => s.provider === provider)) return; // real state wins
    const result = await probe(provider, feed).catch((err): CheckResult => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    deps.registry.record(provider, feed, result, 'probe');
  };

  const startRound = (full: boolean): Promise<void> => {
    const withSymbols = full || rounds % SYMBOLS_EVERY === 0;
    rounds++;
    lastStartedAt = now();
    const tasks = keys.filter((k) => k.feed !== 'symbols' || withSymbols);
    const round = new Promise<void>((resolve) => {
      let left = tasks.length;
      const settled = (): void => {
        if (--left === 0) resolve();
      };
      cancelRound = resolve;
      tasks.forEach((task, i) => {
        const go = (): void => void probeOne(task.provider, task.feed).finally(settled);
        if (i === 0) return go();
        const handle = timers.setTimeout(() => {
          startTimers.delete(handle);
          go();
        }, i * STAGGER_MS);
        startTimers.add(handle);
      });
    }).finally(() => {
      if (running === round) {
        running = null;
        cancelRound = null;
      }
    });
    running = round;
    return round;
  };

  return {
    start() {
      if (stopped || deps.intervalSeconds <= 0 || firstTimer !== undefined) return;
      firstTimer = timers.setTimeout(() => {
        if (!running) void startRound(false);
        intervalTimer = timers.setInterval(() => {
          if (!running) void startRound(false);
        }, deps.intervalSeconds * 1000);
      }, FIRST_ROUND_DELAY_MS);
    },
    stop() {
      stopped = true;
      if (firstTimer !== undefined) timers.clearTimeout(firstTimer);
      if (intervalTimer !== undefined) timers.clearInterval(intervalTimer);
      firstTimer = intervalTimer = undefined;
      for (const h of startTimers) timers.clearTimeout(h);
      startTimers.clear();
      cancelRound?.();
    },
    async refresh() {
      if (running) {
        await running;
        return { refreshed: false };
      }
      if (lastStartedAt !== null && now() - lastStartedAt < REFRESH_REUSE_MS) return { refreshed: false };
      await startRound(true);
      return { refreshed: true };
    },
  };
}

export interface StatusService {
  registry: Registry;
  scheduler: Scheduler;
  /** The `/api/status` body; `refreshed` is added by the route. */
  response(): StatusResponse;
}

export interface StatusServiceOptions {
  version: string;
  intervalSeconds: number;
  relayStats?: () => FeedStats[];
  probeEnv?: ProbeEnv;
  timers?: Timers;
  now?: () => number;
  uptimeSeconds?: () => number;
  log?: (line: string) => void;
  probe?: SchedulerDeps['probe'];
}

/** The registry and scheduler wired together; `server/main.ts` creates one. */
export function createStatusService(opts: StatusServiceOptions): StatusService {
  const registry = createRegistry({ now: opts.now, log: opts.log });
  const relayStats = opts.relayStats ?? (() => []);
  const scheduler = createScheduler({
    registry,
    intervalSeconds: opts.intervalSeconds,
    timers: opts.timers,
    now: opts.now,
    relayStats,
    probe: opts.probe ?? ((provider, feed) => runProbe(provider, feed, { timers: opts.timers, ...opts.probeEnv })),
  });
  return {
    registry,
    scheduler,
    response() {
      const checks: StatusCheck[] = registry.snapshot(relayStats());
      return {
        server: { state: 'ok', version: opts.version, uptimeSeconds: opts.uptimeSeconds?.() ?? Math.round(process.uptime()) },
        intervalSeconds: Math.max(0, opts.intervalSeconds),
        checks,
      };
    },
  };
}
