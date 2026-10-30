/** Test data for `request.security`: a deterministic 15-minute history and a fake `fetchHistory` over it. */
import { buildBars } from '../../../../shared/timeframes';
import type { HistoryRequest } from '../providers';
import type { Candle } from '../../types';
import { createMarketFeed, type MarketFeed } from './marketFeed';

export const START = Date.UTC(2024, 0, 1) / 1000;

/** A pseudo-random walk of 15-minute candles from `START`. */
export function candles15(count: number): Candle[] {
  let x = 1;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  let price = 100;
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
  calls: HistoryRequest[];
  /** What the next requests do: throw this error. */
  failWith?: string;
}

/**
 * A feed over a fake server that holds `base` candles and builds any interval from them, the unfinished newest bucket
 * included (as a real server would). `finalClose` replaces the close of the newest daily bar, a future value a run must not see.
 */
export function fakeServer(base: Candle[], opts: { finalClose?: number } = {}): FakeServer {
  const server: FakeServer = { calls: [], feed: null as unknown as MarketFeed };
  server.feed = createMarketFeed(() => async (req) => {
    server.calls.push(req);
    if (server.failWith) throw new Error(server.failWith);
    let bars = buildBars(base, req.timeframe);
    if (opts.finalClose !== undefined && req.timeframe === '1d' && bars.length) {
      bars = bars.map((b, i) => (i === bars.length - 1 ? { ...b, close: opts.finalClose! } : b));
    }
    return bars.filter((b) => b.time >= (req.from ?? -Infinity) && b.time <= (req.to ?? Infinity));
  });
  return server;
}

export const hourlyOf = (base: Candle[]): Candle[] => buildBars(base, '1h');
