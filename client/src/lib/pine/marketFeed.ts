/**
 * The bars `request.security` reads for the chart's own symbol at another timeframe. One feed per JS realm (each
 * worker, and the main thread when it runs Pine itself) keeps the bars it fetched, so the many runs of an optimizer
 * grid make one fetch, and a later run with a later end fetches only what it does not hold yet.
 *
 * The feed hands out finished bars only: a bar whose full interval ends after the run's end is never returned, because
 * the provider's copy of it carries a close the run must not see. `market.ts` rebuilds that bar from the run's own candles.
 */
import { MAX_BARS, intervalSeconds, parseInterval, rangeBarCount, type Interval } from '../../../../shared/market';
import type { Candle } from '../../types';
import { getProvider, type HistoryRequest } from '../providers';

export interface FeedRequest {
  providerId: string;
  symbol: string;
  interval: Interval;
  /** `built` when the chart's Build setting is on. */
  source?: 'built';
  /** Bars opening in `[fromMs, toMs]` are wanted. */
  fromMs: number;
  toMs: number;
}

export interface MarketFeed {
  /** Ascending bars of the request's range that are finished at `toMs` (open plus the full interval is at most `toMs + 1`). Throws on a failed fetch or a span above `MAX_BARS`. */
  bars(req: FeedRequest): Promise<Candle[]>;
}

/** End (exclusive, ms) of the bar of `interval` opening at `openMs`; a month is the calendar month. */
export function intervalEndMs(openMs: number, interval: Interval): number {
  const p = parseInterval(interval);
  if (p?.unit === 'M') {
    const d = new Date(openMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + p.n, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  }
  return openMs + intervalSeconds(interval) * 1000;
}

type FetchHistory = (req: HistoryRequest) => Promise<Candle[]>;

interface Entry {
  /** Finished bars, ascending by open. */
  bars: Candle[];
  /** Every bar opening in `[lo, hi)` (ms) is in `bars` (when the provider has it). Empty while `lo >= hi`. */
  lo: number;
  hi: number;
  /** `hi` is the open of a bar the provider showed unfinished: the bars before it are complete, and the next fetch is due when that bar ends. */
  sure: boolean;
  /** Serialises the fetches of one key, so concurrent runs share one fetch. */
  chain: Promise<unknown>;
}

/**
 * A feed over `fetchHistory`. `now` tells how close a run's end is to the wall clock: within one interval of it, the
 * newest finished bar may not be published yet, so the tail is asked for again on the next run.
 */
export function createMarketFeed(fetchHistory: (providerId: string) => FetchHistory, now: () => number = Date.now): MarketFeed {
  const entries = new Map<string, Entry>();

  async function fill(e: Entry, req: FeedRequest, fromMs: number, toMs: number): Promise<void> {
    const fromSec = Math.floor(fromMs / 1000);
    const toSec = Math.floor(toMs / 1000);
    const count = rangeBarCount(req.interval, fromSec, toSec);
    if (count > MAX_BARS) throw new Error(`the ${req.interval} bars needed (${count}) are more than the ${MAX_BARS} one request may ask for`);
    const got = await fetchHistory(req.providerId)({
      symbol: req.symbol, timeframe: req.interval, bars: Math.max(1, count), from: fromSec, to: toSec,
      ...(req.source && { source: req.source }),
    });
    const finished = got.filter((c) => c.time * 1000 >= fromMs && c.time * 1000 <= toMs && intervalEndMs(c.time * 1000, req.interval) <= toMs + 1);
    const known = new Set(e.bars.map((c) => c.time));
    e.bars = [...e.bars, ...finished.filter((c) => !known.has(c.time))].sort((a, b) => a.time - b.time);
    const len = intervalEndMs(toMs, req.interval) - toMs;
    const lastEnd = finished.length ? intervalEndMs(finished[finished.length - 1].time * 1000, req.interval) : fromMs;
    // A bar still forming at `toMs` proves the provider is up to date up to its open. Without one, near the wall clock
    // the newest finished bar may not be published yet, so claim only what was seen.
    const forming = got.find((c) => c.time * 1000 >= fromMs && c.time * 1000 <= toMs && intervalEndMs(c.time * 1000, req.interval) > toMs + 1);
    const reach = forming ? forming.time * 1000 : toMs + 1 > now() - len ? Math.max(lastEnd, fromMs) : toMs + 1;
    if (e.lo >= e.hi) { e.lo = fromMs; e.hi = reach; e.sure = Boolean(forming); return; }
    e.lo = Math.min(e.lo, fromMs);
    if (reach >= e.hi) { e.hi = reach; e.sure = Boolean(forming); }
  }

  return {
    async bars(req) {
      const key = `${req.providerId}|${req.symbol}|${req.interval}|${req.source ?? ''}`;
      let e = entries.get(key);
      if (!e) {
        e = { bars: [], lo: 0, hi: 0, sure: false, chain: Promise.resolve() };
        entries.set(key, e);
      }
      const entry = e;
      const run = entry.chain.then(async () => {
        if (entry.lo >= entry.hi) await fill(entry, req, req.fromMs, req.toMs);
        else {
          // A gap between the held range and the request is fetched as part of the request, so the held range stays contiguous.
          if (req.fromMs < entry.lo) await fill(entry, req, req.fromMs, entry.lo - 1);
          const due = entry.sure ? intervalEndMs(entry.hi, req.interval) <= req.toMs + 1 : req.toMs + 1 > entry.hi;
          if (due) await fill(entry, req, entry.hi, req.toMs);
        }
        return entry.bars.filter((c) => c.time * 1000 >= req.fromMs && c.time * 1000 <= req.toMs && intervalEndMs(c.time * 1000, req.interval) <= req.toMs + 1);
      });
      entry.chain = run.catch(() => undefined);
      return run;
    },
  };
}

let realmFeed: MarketFeed | null = null;

/** The one feed of this JS realm, over the client's provider registry. */
export function defaultMarketFeed(): MarketFeed {
  return (realmFeed ??= createMarketFeed((id) => (req) => getProvider(id).fetchHistory(req)));
}

/** Test hook: replaces the realm's feed (null restores a fresh default). */
export function setDefaultMarketFeed(feed: MarketFeed | null): void {
  realmFeed = feed;
}
