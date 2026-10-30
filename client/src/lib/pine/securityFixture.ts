/** Test data for `request.security`: a deterministic 15-minute history and a fake `fetchHistory` over it. */
import { buildBars } from '../../../../shared/timeframes';
import type { HistoryRequest } from '../providers';
import type { Candle } from '../../types';
import { ApiHttpError } from '../providers/api';
import { createMarketFeed, type MarketFeed } from './marketFeed';

export const START = Date.UTC(2024, 0, 1) / 1000;

/** A pseudo-random walk of 15-minute candles from `START`. */
export function candles15(count: number, seed = 1, start = 100): Candle[] {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  let price = start;
  return Array.from({ length: count }, (_, i) => {
    const open = price;
    price = Math.max(1, price + (rnd() - 0.5) * 2);
    const high = Math.max(open, price) + rnd() * 0.3;
    const low = Math.min(open, price) - rnd() * 0.3;
    return { time: START + i * 900, open, high, low, close: price, volume: 10 + Math.floor(rnd() * 5) };
  });
}

export interface FakeServer {
  feed: MarketFeed;
  calls: Array<HistoryRequest & { providerId?: string }>;
  /** What the next requests do: throw this error. */
  failWith?: string;
}

/**
 * A feed over a fake server that holds `base` candles and builds any interval from them, the unfinished newest bucket
 * included (as a real server would). `finalClose` replaces the close of the newest daily bar, a future value a run must not see.
 */
export function fakeServer(base: Candle[], opts: { finalClose?: number; markets?: Record<string, Candle[]> } = {}): FakeServer {
  const server: FakeServer = { calls: [], feed: null as unknown as MarketFeed };
  server.feed = createMarketFeed((providerId) => async (req) => {
    server.calls.push({ ...req, providerId });
    if (server.failWith) throw new Error(server.failWith);
    // With `markets` (`provider|SYMBOL` -> 15-minute candles) the server has only those, and a 404 for any other symbol.
    const held = opts.markets ? opts.markets[`${providerId}|${req.symbol}`] : base;
    if (!held) throw new ApiHttpError(`Unknown symbol ${req.symbol}`, 404);
    let bars = buildBars(held, req.timeframe);
    if (opts.finalClose !== undefined && req.timeframe === '1d' && bars.length) {
      bars = bars.map((b, i) => (i === bars.length - 1 ? { ...b, close: opts.finalClose! } : b));
    }
    return bars.filter((b) => b.time >= (req.from ?? -Infinity) && b.time <= (req.to ?? Infinity));
  });
  return server;
}

export const hourlyOf = (base: Candle[]): Candle[] => buildBars(base, '1h');
