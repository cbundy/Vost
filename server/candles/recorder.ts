/**
 * The recorder: keeps the configured markets recorded at all times. Each
 * series holds one server-side relay subscriber that writes every closed
 * candle to the store, and its holes (what the store's coverage lacks inside
 * the depth window) are filled from the exchange's REST history through one
 * paced queue per provider: one call in flight, a minimum gap between calls,
 * newest holes first, every series getting a chunk before any gets a second.
 * Holes are queued again after a feed drop and every 15 minutes, when old
 * candles are trimmed too. Nothing here throws into the server.
 */
import { TIMEFRAME_SECONDS, type Candle } from '../../shared/market.ts';
import type { RecorderSeriesStatus, RecorderStatus } from '../../shared/status.ts';
import { realTimers, type Timers } from '../live/socket.ts';
import type { Relay } from '../live/relay.ts';
import { NotFoundError, UpstreamError } from '../providers/errors.ts';
import type { SymbolCache } from '../providers/symbolCache.ts';
import type { ProviderAdapter } from '../providers/types.ts';
import type { FetchFn } from '../providers/upstream.ts';
import type { RecordConfig } from './recordConfig.ts';
import type { CandleStore, Series } from './store.ts';

export interface Pacing {
  /** Minimum ms between two calls to the provider. */
  gapMs: number;
  /** Most bars one call asks for. */
  page: number;
}

/** Per-provider pacing; any other provider gets `DEFAULT_PACING`. */
export const PACING: Record<string, Pacing> = {
  binance: { gapMs: 250, page: 1000 },
  coinbase: { gapMs: 250, page: 300 },
  hyperliquid: { gapMs: 1000, page: 5000 },
};
export const DEFAULT_PACING: Pacing = { gapMs: 1000, page: 300 };
export const SWEEP_MS = 15 * 60_000;
export const BACKOFF_START_MS = 60_000;
export const BACKOFF_MAX_MS = 15 * 60_000;

export interface RecorderDeps {
  config: RecordConfig;
  store: CandleStore;
  relay: Relay;
  adapters: ReadonlyMap<string, ProviderAdapter>;
  /** The adapter context of user traffic (its fetch, so test-upstream rewriting applies). */
  ctx: () => { fetch?: FetchFn; symbols: SymbolCache };
  timers?: Timers;
  now?: () => number;
  log?: (line: string) => void;
  pacing?: Record<string, Pacing>;
  /** Ms between sweeps (default 15 minutes). */
  sweepMs?: number;
}

export interface Recorder {
  start(): void;
  stop(): void;
  stats(): RecorderStatus;
}

type Cause = 'start' | 'reconnect' | 'sweep';

interface Entry {
  series: Series;
  status: string;
  /** Unix ms when the feed last went live; null while it is down. */
  liveSince: number | null;
  wasDown: boolean;
  dirty: boolean;
  /** Chunks fetched since the series last became dirty. */
  chunks: number;
  cause: Cause;
  refills: number;
  lastRefillAt: number | null;
  lastError: string | null;
  unsubscribe?: () => void;
}

interface Queue {
  provider: string;
  entries: Entry[];
  pacing: Pacing;
  busy: boolean;
  timer: unknown;
  /** Earliest ms of the next call (the pacing gap). */
  nextAt: number;
  pausedUntil: number;
  backoffMs: number;
  rr: number;
  pruned: boolean;
  abort?: AbortController;
}

export function createRecorder(deps: RecorderDeps): Recorder {
  const { config, store, relay } = deps;
  const timers = deps.timers ?? realTimers;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const on = config.on && store.on && config.series.length > 0;
  let stopped = false;
  let started = false;
  let sweepTimer: unknown;

  const entries: Entry[] = on
    ? config.series.map((series) => ({ series, status: 'connecting', liveSince: null, wasDown: false, dirty: false, chunks: 0, cause: 'start', refills: 0, lastRefillAt: null, lastError: null }))
    : [];
  const queues = new Map<string, Queue>();
  for (const e of entries) {
    let q = queues.get(e.series.provider);
    if (!q) {
      q = { provider: e.series.provider, entries: [], pacing: deps.pacing?.[e.series.provider] ?? PACING[e.series.provider] ?? DEFAULT_PACING, busy: false, timer: undefined, nextAt: 0, pausedUntil: 0, backoffMs: 0, rr: 0, pruned: false };
      queues.set(q.provider, q);
    }
    q.entries.push(e);
  }

  const label = (s: Series): string => `${s.provider} ${s.symbol} ${s.timeframe}`;
  /** Time of the newest closed bar. */
  const lastBarOf = (s: Series): number => {
    const step = TIMEFRAME_SECONDS[s.timeframe];
    return Math.floor(now() / 1000 / step) * step - step;
  };
  const depthStartOf = (s: Series): number => lastBarOf(s) - (config.depthBars - 1) * TIMEFRAME_SECONDS[s.timeframe];
  const iso = (t: number): string => new Date(t * 1000).toISOString().slice(0, 16) + 'Z';

  const markDirty = (e: Entry, cause: Cause): void => {
    if (stopped) return;
    if (!e.dirty) {
      e.dirty = true;
      e.chunks = 0;
      e.cause = cause;
    }
    pump(queues.get(e.series.provider)!);
  };

  /** The next chunk to fetch: the newest hole of the series that has had the fewest chunks this round. */
  function pick(q: Queue): { entry: Entry; from: number; to: number; depthStart: number } | null {
    const n = q.entries.length;
    const order = q.entries
      .map((entry, i) => ({ entry, rank: (i - q.rr + n) % n }))
      .filter((c) => c.entry.dirty)
      .sort((a, b) => a.entry.chunks - b.entry.chunks || a.rank - b.rank);
    for (const { entry } of order) {
      const s = entry.series;
      const depthStart = depthStartOf(s);
      let holes;
      try {
        holes = store.covered(s, depthStart, lastBarOf(s));
      } catch (err) {
        entry.lastError = `store: ${(err as Error).message}`;
        entry.dirty = false;
        continue;
      }
      const hole = holes[holes.length - 1];
      if (!hole) {
        entry.dirty = false;
        continue;
      }
      q.rr = (q.entries.indexOf(entry) + 1) % n;
      const step = TIMEFRAME_SECONDS[s.timeframe];
      return { entry, to: hole.to, from: Math.max(hole.from, hole.to - (q.pacing.page - 1) * step), depthStart };
    }
    return null;
  }

  function pump(q: Queue): void {
    if (stopped || !started || q.busy || q.timer !== undefined) return;
    const wait = Math.max(q.nextAt, q.pausedUntil) - now();
    if (wait > 0) {
      q.timer = timers.setTimeout(() => {
        q.timer = undefined;
        pump(q);
      }, wait);
      return;
    }
    const job = pick(q);
    if (!job) {
      if (!q.pruned) {
        q.pruned = true;
        for (const e of q.entries) prune(e);
      }
      return;
    }
    void run(q, job);
  }

  async function run(q: Queue, job: NonNullable<ReturnType<typeof pick>>): Promise<void> {
    const { entry, from, to, depthStart } = job;
    const s = entry.series;
    const adapter = deps.adapters.get(s.provider);
    q.busy = true;
    const abort = new AbortController();
    q.abort = abort;
    try {
      if (!adapter) throw new Error(`no adapter for ${s.provider}`);
      let candles: Candle[];
      try {
        candles = await adapter.history({ ...deps.ctx(), signal: abort.signal }, { symbol: s.symbol, timeframe: s.timeframe, bars: q.pacing.page, from, to });
      } catch (err) {
        if (err instanceof NotFoundError) candles = []; // nothing at the exchange for this span
        else throw err;
      }
      if (stopped) return;
      const inRange = candles.filter((c) => c.time >= from && c.time <= to);
      // An empty span older than every stored bar is the start of the exchange's history: the rest of the window is empty too.
      const coverFrom = inRange.length === 0 && store.lastN(s, to, 1).length === 0 ? Math.min(from, depthStart) : from;
      store.upsert(s, inRange, coverFrom, to);
      q.backoffMs = 0;
      entry.chunks++;
      entry.refills++;
      entry.lastRefillAt = now();
      entry.lastError = null;
      log(`[recorder] ${label(s)} filled ${iso(coverFrom)}..${iso(to)}: ${inRange.length} candles (cause: ${entry.cause})`);
    } catch (err) {
      if (stopped) return;
      const message = err instanceof Error ? err.message : String(err);
      entry.lastError = message;
      if (err instanceof UpstreamError && (err.status === 429 || err.status === 418)) {
        q.backoffMs = q.backoffMs === 0 ? BACKOFF_START_MS : Math.min(q.backoffMs * 2, BACKOFF_MAX_MS);
        q.pausedUntil = now() + q.backoffMs;
        log(`[recorder] ${s.provider} rate limited (HTTP ${err.status}): paused ${Math.round(q.backoffMs / 1000)} s`);
      } else {
        entry.dirty = false; // tried again at the next sweep
        log(`[recorder] ${label(s)} fill failed: ${message}`);
      }
    } finally {
      q.busy = false;
      q.abort = undefined;
      if (!stopped) {
        q.nextAt = now() + q.pacing.gapMs;
        pump(q);
      }
    }
  }

  function prune(e: Entry): void {
    if (stopped) return;
    try {
      store.prune(e.series, depthStartOf(e.series));
    } catch (err) {
      e.lastError = `store: ${(err as Error).message}`;
    }
  }

  function subscribe(e: Entry): void {
    const s = e.series;
    const result = relay.subscribe(s.provider, s.symbol, s.timeframe, {
      onStatus: (ev) => {
        if (stopped) return;
        const prev = e.status;
        e.status = ev.status;
        if (ev.status === 'live') {
          if (prev !== 'live') e.liveSince = now();
          if (e.wasDown) {
            e.wasDown = false;
            markDirty(e, 'reconnect');
          }
        } else {
          e.liveSince = null;
          if (ev.status === 'reconnecting' || ev.status === 'error') e.wasDown = true;
        }
      },
      onKline: ({ candle, closed }) => {
        if (stopped || !closed) return;
        // A bar that opened before the feed went live may have been joined mid-way: its row is kept, REST confirms its coverage.
        const whole = e.liveSince !== null && candle.time * 1000 >= e.liveSince;
        try {
          if (whole) store.upsert(s, [candle], candle.time, candle.time);
          else {
            store.upsert(s, [candle]);
            markDirty(e, 'reconnect');
          }
        } catch (err) {
          e.lastError = `store: ${(err as Error).message}`;
        }
      },
      onLog: () => undefined,
      onEnd: () => undefined,
    });
    if ('error' in result) {
      e.status = 'error';
      e.lastError = result.error;
      log(`[recorder] ${label(s)} not live: ${result.error}`);
    } else {
      e.unsubscribe = result.unsubscribe;
    }
  }

  return {
    start() {
      if (!on || started || stopped) return;
      started = true;
      try {
        const listed = new Set(entries.map((e) => label(e.series)));
        const extra = store.listSeries().filter((s) => !listed.has(label(s)));
        if (extra.length > 0) log(`[recorder] not recorded any more: ${extra.map(label).join(', ')}`);
      } catch {
        /* the store is only a hint here */
      }
      for (const e of entries) subscribe(e);
      for (const e of entries) markDirty(e, 'start');
      sweepTimer = timers.setInterval(() => {
        for (const e of entries) {
          prune(e);
          markDirty(e, 'sweep');
        }
      }, deps.sweepMs ?? SWEEP_MS);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (sweepTimer !== undefined) timers.clearInterval(sweepTimer);
      sweepTimer = undefined;
      for (const q of queues.values()) {
        if (q.timer !== undefined) timers.clearTimeout(q.timer);
        q.timer = undefined;
        q.abort?.abort();
      }
      for (const e of entries) {
        e.unsubscribe?.();
        e.unsubscribe = undefined;
      }
    },
    stats() {
      const series: RecorderSeriesStatus[] = entries.map((e) => {
        const s = e.series;
        const step = TIMEFRAME_SECONDS[s.timeframe];
        let missingBars = 0;
        let lastCandleTime: number | null = null;
        try {
          for (const h of store.covered(s, depthStartOf(s), lastBarOf(s))) missingBars += Math.max(0, Math.floor(h.to / step) - Math.ceil(h.from / step) + 1);
          lastCandleTime = store.lastN(s, lastBarOf(s), 1)[0]?.time ?? null;
        } catch {
          /* a failing store shows as unknown figures */
        }
        return { provider: s.provider, symbol: s.symbol, timeframe: s.timeframe, live: e.status, lastCandleTime, missingBars, refills: e.refills, lastRefillAt: e.lastRefillAt, lastError: e.lastError };
      });
      return { on, depthBars: config.depthBars, series };
    },
  };
}
