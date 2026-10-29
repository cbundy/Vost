/**
 * Live bars for a built timeframe. The folder listens to the live klines of the
 * lower (base) timeframe and keeps the base bars of the bucket in progress; each
 * update emits the whole higher bar, so the last bar moves as on a native
 * timeframe. A bucket that starts mid-way (a connect, a reconnect) is seeded from
 * the base history, so the live bar never looks smaller than the real one. It has
 * no socket knowledge: the relay feeds it the base feed's status and klines.
 */
import { TIMEFRAME_SECONDS, type Candle, type LiveKlineEvent, type LiveStatusEvent, type Timeframe } from '../../shared/market.ts';
import { bucketSecondsMax, bucketStart, buildBars, UTC_CALENDAR } from '../../shared/timeframes.ts';
import type { HistoryRequest } from '../providers/types.ts';
import { SEED_RETRY_MS } from './coinbaseCandles.ts';
import type { Timers } from './socket.ts';

export interface BuiltFolderDeps {
  symbol: string;
  target: Timeframe;
  base: Timeframe;
  /** Base bars for a range request (the read-through history of the server). */
  history: (req: HistoryRequest) => Promise<Candle[]>;
  timers: Timers;
  /** Clock in ms. */
  now: () => number;
  log: (severity: 'info' | 'warning', text: string) => void;
  emit: (ev: LiveKlineEvent) => void;
}

export interface BuiltFolder {
  onBaseStatus(ev: LiveStatusEvent): void;
  onBaseKline(ev: LiveKlineEvent): void;
  /** Stops timers and drops any seed answer still on its way. */
  dispose(): void;
}

const finite = (c: Candle): boolean => [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite);

export function createBuiltFolder(deps: BuiltFolderDeps): BuiltFolder {
  const { target, base, timers } = deps;
  const baseSeconds = TIMEFRAME_SECONDS[base];
  const bucketOf = (t: number): number => bucketStart(t, target, UTC_CALENDAR);

  /** The bucket in progress; null before the first one. Only ever moves forward. */
  let bucket: number | null = null;
  /** The base bars of the bucket by their time. */
  let bars = new Map<number, Candle>();
  /** Times set by a live kline: a seeded bar never overwrites these. */
  let liveTimes = new Set<number>();
  /** 'seeding': nothing is emitted. 'live': emitting. 'dropped': the bucket ended before its seed settled. */
  let phase: 'seeding' | 'live' | 'dropped' = 'dropped';
  let generation = 0;
  let retryTimer: unknown;
  let lastStatus: LiveStatusEvent['status'] | null = null;

  const clearRetry = (): void => {
    if (retryTimer !== undefined) timers.clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const built = (): Candle | null => {
    const rows = [...bars.values()].sort((a, b) => a.time - b.time);
    if (rows.length === 0 || bucket === null) return null;
    return buildBars(rows, target, UTC_CALENDAR).find((c) => c.time === bucket) ?? null;
  };

  const publish = (closed: boolean): void => {
    const candle = built();
    if (candle) deps.emit({ candle, closed });
  };

  const startSeed = (): void => {
    if (bucket === null) return;
    generation++;
    clearRetry();
    phase = 'seeding';
    const mine = generation;
    const b = bucket;
    const seed = async (): Promise<void> => {
      if (generation !== mine) return;
      let rows: Candle[];
      try {
        const to = Math.floor(deps.now() / 1000);
        rows = await deps.history({
          symbol: deps.symbol,
          timeframe: base,
          bars: Math.ceil(bucketSecondsMax(target) / baseSeconds) + 1,
          from: b,
          to,
        });
      } catch (err) {
        if (generation !== mine) return;
        const why = err instanceof Error ? err.message : String(err);
        if (deps.now() / 1000 >= b + bucketSecondsMax(target)) {
          phase = 'dropped'; // the bucket is over: the next one starts from live klines
          bars = new Map();
          liveTimes = new Set();
          return;
        }
        deps.log('warning', `Could not seed the live ${target} bar from ${base} history (${why}); retrying in ${SEED_RETRY_MS / 1000} s.`);
        retryTimer = timers.setTimeout(() => {
          retryTimer = undefined;
          void seed();
        }, SEED_RETRY_MS);
        return;
      }
      if (generation !== mine) return;
      for (const r of rows) {
        if (finite(r) && bucketOf(r.time) === b && !liveTimes.has(r.time)) bars.set(r.time, { ...r });
      }
      phase = 'live';
      publish(false);
    };
    void seed();
  };

  return {
    onBaseStatus(ev) {
      const previous = lastStatus;
      lastStatus = ev.status;
      if (ev.status === previous) return;
      // Any change ends the seed of the old connection; a new `live` starts a new one.
      generation++;
      clearRetry();
      if (ev.status !== 'live') return;
      const b = bucketOf(deps.now() / 1000);
      if (bucket !== null && b < bucket) return; // a clock that went back: keep the newer bucket
      bucket = b;
      bars = new Map();
      liveTimes = new Set();
      startSeed();
    },

    onBaseKline({ candle }) {
      if (!finite(candle)) return;
      const kb = bucketOf(candle.time);
      if (bucket !== null && kb < bucket) return; // a late kline of a closed bucket
      if (bucket !== null && kb === bucket) {
        if (phase === 'dropped') return;
        bars.set(candle.time, { ...candle });
        liveTimes.add(candle.time);
        if (phase === 'live') publish(false);
        return;
      }
      // A later bucket (or the first): close the one before once, then start the new one.
      if (bucket !== null && phase === 'live') publish(true);
      generation++; // a seed of the old bucket must not land in the new one
      clearRetry();
      bucket = kb;
      bars = new Map([[candle.time, { ...candle }]]);
      liveTimes = new Set([candle.time]);
      if (candle.time === kb) {
        phase = 'live';
        publish(false);
      } else {
        startSeed();
      }
    },

    dispose() {
      generation++;
      clearRetry();
    },
  };
}
