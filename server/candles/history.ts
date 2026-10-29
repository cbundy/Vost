/**
 * Read-through for `/api/history`: a recorded series is answered from the
 * candle store, fetching from the exchange only what coverage lacks, and the
 * reply has exactly the shape the exchange path gives (ascending, no
 * duplicates, the exchange's own 404). A series that is not recorded, or a
 * store that is off, takes the exchange path unchanged. The forming bar is
 * always fetched and never stored.
 */
import { TIMEFRAME_SECONDS, type Candle, type Timeframe } from '../../shared/market.ts';
import { NotFoundError } from '../providers/errors.ts';
import type { HistoryRequest } from '../providers/types.ts';
import type { CandleStore, Interval, Series } from './store.ts';

export interface ReadThroughDeps {
  store?: CandleStore;
  isRecorded?: (provider: string, symbol: string, timeframe: Timeframe) => boolean;
  /** One exchange history call (reported to the status page by the caller). */
  fetch: (req: HistoryRequest) => Promise<Candle[]>;
  now?: () => number;
  log?: (line: string) => void;
}

/** Store failures are logged once per kind, not once per request. */
const loggedKinds = new WeakMap<object, Set<string>>();

function merge(...lists: Candle[][]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const list of lists) for (const c of list) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export async function readThroughHistory(
  deps: ReadThroughDeps,
  provider: string,
  req: HistoryRequest,
): Promise<Candle[]> {
  const { store } = deps;
  if (!store || !store.on || !deps.isRecorded?.(provider, req.symbol, req.timeframe)) return deps.fetch(req);

  const log = deps.log ?? ((line: string) => console.log(line));
  const kinds = loggedKinds.get(store) ?? new Set<string>();
  loggedKinds.set(store, kinds);
  const storeFailed = (kind: string, err: unknown): void => {
    if (kinds.has(kind)) return;
    kinds.add(kind);
    log(`[candles] store ${kind} failed: ${(err as Error).message}`);
  };
  const series: Series = { provider, symbol: req.symbol, timeframe: req.timeframe };
  const nowSec = Math.floor((deps.now ?? Date.now)() / 1000);
  const lastClosed = nowSec - TIMEFRAME_SECONDS[req.timeframe];
  const label = `${provider} ${req.symbol} ${req.timeframe}`;

  try {
    return req.from !== undefined ? await spanMode(req, req.from) : await barsMode(req);
  } catch (err) {
    if (err instanceof StoreError) {
      storeFailed(err.kind, err.original);
      return deps.fetch(req);
    }
    throw err;
  }

  /** Runs a store call; a failure is a `StoreError` so the caller can tell it from an exchange error. */
  function guard<T>(kind: string, fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw new StoreError(kind, err);
    }
  }
  /** A write failure loses persistence only: the request still answers. */
  function tryWrite(candles: Candle[], from: number, to: number): void {
    try {
      deps.store!.upsert(series, candles, from, to);
    } catch (err) {
      storeFailed('write', err);
    }
  }

  async function spanMode(r: HistoryRequest, from: number): Promise<Candle[]> {
    const to = r.to ?? nowSec;
    const stored = guard('read', () => store!.range(series, from, to));
    const missing = guard('read', () => store!.covered(series, from, to));
    const fetched: Candle[][] = [];
    for (const gap of missing) {
      let got: Candle[];
      try {
        got = await deps.fetch({ ...r, from: gap.from, to: gap.to, bars: Math.max(1, Math.floor((gap.to - gap.from) / TIMEFRAME_SECONDS[r.timeframe]) + 1) });
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
        got = []; // the exchange has nothing in this gap
      }
      fetched.push(got);
      tryWrite(got, gap.from, gap.to);
    }
    const out = merge(stored, ...fetched).filter((c) => c.time >= from && c.time <= to);
    if (missing.length > 0) log(`[candles] ${label} span ${from}..${to}: fetched ${describe(missing)}, ${fetched.reduce((n, l) => n + l.length, 0)} bars`);
    // Nothing at all: ask the exchange for the whole span, so the 404 is its own.
    if (out.length === 0) return deps.fetch(r);
    return out;
  }

  async function barsMode(r: HistoryRequest): Promise<Candle[]> {
    const to = Math.min(r.to ?? nowSec, nowSec);
    const closedEnd = Math.min(to, lastClosed);
    // Bars after the last closed one are forming: always from the exchange.
    const forming = to > closedEnd ? await deps.fetch({ symbol: r.symbol, timeframe: r.timeframe, bars: 1, from: closedEnd + 1, to }).catch((err) => {
      if (err instanceof NotFoundError) return [] as Candle[];
      throw err;
    }) : [];
    const need = r.bars - forming.length;
    const rows = guard('read', () => store!.lastN(series, closedEnd, need));
    const unbroken = need <= 0 || (rows.length === need && guard('read', () => store!.covered(series, rows[0]!.time, closedEnd)).length === 0);
    if (unbroken) {
      return need <= 0 ? forming.slice(-r.bars) : merge(rows, forming);
    }
    const all = await deps.fetch({ ...r, to });
    const closed = all.filter((c) => c.time <= lastClosed);
    log(`[candles] ${label} bars ${r.bars} to ${to}: fetched ${all.length} bars (coverage too short)`);
    if (all.length > 0) tryWrite(closed, Math.min(all[0]!.time, closedEnd), closedEnd);
    return all;
  }
}

class StoreError extends Error {
  kind: string;
  original: unknown;
  constructor(kind: string, cause: unknown) {
    super(`store ${kind} failed`);
    this.kind = kind;
    this.original = cause;
  }
}

const describe = (gaps: Interval[]): string => gaps.map((g) => `${g.from}..${g.to}`).join(',');
