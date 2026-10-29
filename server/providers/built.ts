/**
 * History for a built timeframe: a timeframe the provider lacks but can make
 * from a lower native one (`shared/timeframes.ts`). The base bars come from
 * `fetchBase` (the API's `history()` helper, so a recorded base series is read
 * from the candle store), newest chunk first, and are aggregated here.
 *
 * No partial bar passes as complete: the oldest bucket present in the base data
 * is dropped, so every built bar except the newest (the forming bar, as with
 * native bars) covers its whole bucket.
 */
import { MAX_BARS, TIMEFRAME_SECONDS, type Candle, type Timeframe } from '../../shared/market.ts';
import { UTC_CALENDAR, baseTimeframe, bucketSecondsMax, buildBars, type Calendar } from '../../shared/timeframes.ts';
import { NotFoundError } from './errors.ts';
import { cropToSpan } from './range.ts';
import type { HistoryRequest } from './types.ts';

/** Most base bars one built request reads, however many bars it asks for. */
export const MAX_BUILT_BASE_BARS = 100_000;

const DAY = 86400;

export interface BuiltDeps {
  /** One base-timeframe history call; the adapter may report its calendar through `onCalendar`. */
  fetchBase(req: HistoryRequest, onCalendar: (calendar: Calendar) => void): Promise<Candle[]>;
  now?: () => number;
}

function merge(chunks: Candle[][]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const chunk of chunks) for (const c of chunk) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** The provider's own wording for "nothing found", with the base timeframe it asked for renamed to the built one. */
function renamed(err: NotFoundError, base: Timeframe, target: Timeframe): NotFoundError {
  return new NotFoundError(err.message.replace(new RegExp(`\\b${base}\\b`, 'g'), target));
}

export async function builtHistory(deps: BuiltDeps, native: readonly Timeframe[], req: HistoryRequest): Promise<Candle[]> {
  const target = req.timeframe;
  const base = baseTimeframe(native, target);
  if (!base) throw new Error(`${target} cannot be built from ${native.join(', ')}`);
  const baseSeconds = TIMEFRAME_SECONDS[base];
  const nowSec = Math.floor((deps.now ?? Date.now)() / 1000);
  let calendar: Calendar = UTC_CALENDAR;
  const onCalendar = (c: Calendar): void => {
    calendar = c;
  };

  const chunks: Candle[][] = [];
  const fetchChunk = async (chunkReq: Omit<HistoryRequest, 'timeframe'>, first: boolean): Promise<Candle[]> => {
    try {
      return await deps.fetchBase({ ...chunkReq, timeframe: base }, onCalendar);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      if (first) throw renamed(err, base, target);
      return []; // an empty chunk ends the read: the series starts later
    }
  };

  if (req.from !== undefined) {
    // Range mode: windows of at most MAX_BARS base bars, newest first, down to one target bucket (plus a day for the
    // calendar's offset) before `from`, so the bucket holding `from` is never the oldest one present.
    const start = req.from - bucketSecondsMax(target) - DAY - 1;
    let hi = Math.min(req.to ?? nowSec, nowSec);
    for (let first = true; hi >= start; first = false) {
      const lo = Math.max(start, hi - MAX_BARS * baseSeconds + 1);
      const chunk = await fetchChunk({ symbol: req.symbol, bars: MAX_BARS, from: lo, to: hi }, first);
      if (chunk.length === 0) break;
      chunks.push(chunk);
      hi = lo - 1;
    }
  } else {
    // Bars mode: one extra bucket (the oldest is dropped), as many base bars as the buckets are long, up to the cap.
    const ratio = Math.ceil(bucketSecondsMax(target) / baseSeconds);
    const cap = Math.min(MAX_BUILT_BASE_BARS, (req.bars + 1) * ratio);
    let cursor = req.to;
    let total = 0;
    for (let first = true; total < cap; first = false) {
      const asked = Math.min(MAX_BARS, cap - total);
      const raw = await fetchChunk({ symbol: req.symbol, bars: asked, ...(cursor === undefined ? {} : { to: cursor }) }, first);
      const chunk = cursor === undefined ? raw : raw.filter((c) => c.time <= cursor!);
      if (chunk.length === 0) break;
      chunks.push(chunk);
      total += chunk.length;
      cursor = chunk[0].time - 1;
      if (buildBars(merge(chunks), target, calendar).length > req.bars) break;
    }
  }

  // The oldest bucket present may be partial: drop it.
  let built = buildBars(merge(chunks), target, calendar).slice(1);
  built = req.from !== undefined ? cropToSpan(built, req.from, req.to) : built.slice(-req.bars);
  if (built.length === 0) {
    throw new NotFoundError(`No ${target} bars for ${req.symbol}: not enough ${base} data to build a complete bar.`);
  }
  return built;
}
