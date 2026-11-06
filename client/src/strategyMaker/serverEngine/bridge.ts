/**
 * The engine's side of the server's worker-thread protocol, free of `worker_threads` so tests drive it with a
 * `MessageChannel`. Every message is an envelope `{ proto, ... }`:
 *
 *   parent -> worker  { proto: 'backtest', msg: WorkerRequest }   the browser backtest worker's request
 *                     { proto: 'maker', msg: Request }             the strategy maker's request (`v: 1`)
 *                     { proto: 'answer', rid, ok, value | error }  the answer to an ask
 *   worker -> parent  { proto: 'backtest', msg: WorkerResponse }
 *                     { proto: 'maker', msg: Reply }
 *                     { proto: 'ask', rid, kind, ... }             a lookup the parent must answer (the worker makes no HTTP call)
 *
 * Asks: `history` (`provider`, `req`: a HistoryRequest) is answered with candles, `library` (`path`) with the
 * library source or null. Each ask has its own correlation id `rid`; a failure comes back as `ok: false`.
 */
import { MAX_BARS } from '../../../../shared/market.ts';
import { createBacktestHandler, type WorkerRequest, type WorkerResponse } from '../../lib/workers/backtestHandler';
import { createHost } from '../engineHost';
import type { Reply, Request } from '../protocol';
import type { HistoryRequest } from '../../lib/providers';
import { createMarketFeed, type MarketFeed } from '../../lib/pine/marketFeed';
import type { SweepLoad } from '../sweep/types';
import type { Candle } from '../../types';

export type ToEngine =
  | { proto: 'backtest'; msg: WorkerRequest }
  | { proto: 'maker'; msg: Request }
  | { proto: 'answer'; rid: number; ok: true; value: unknown }
  | { proto: 'answer'; rid: number; ok: false; error: string };

export type FromEngine =
  | { proto: 'backtest'; msg: WorkerResponse }
  | { proto: 'maker'; msg: Reply }
  | { proto: 'ask'; rid: number; kind: 'history'; provider: string; req: HistoryRequest }
  | { proto: 'ask'; rid: number; kind: 'library'; path: string };

/** The part of a MessagePort the bridge uses. */
export interface BridgePort {
  postMessage(msg: unknown): void;
  on(event: 'message', listener: (msg: unknown) => void): unknown;
}

export function attachBridge(port: BridgePort): void {
  const send = (m: FromEngine): void => port.postMessage(m);
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let next = 1;

  const ask = (build: (rid: number) => FromEngine): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const rid = next++;
      pending.set(rid, { resolve, reject });
      send(build(rid));
    });

  const history = (provider: string, req: HistoryRequest): Promise<Candle[]> =>
    ask((rid) => ({ proto: 'ask', rid, kind: 'history', provider, req })) as Promise<Candle[]>;

  const load: SweepLoad = (market, timeframe) => history(market.provider, { symbol: market.symbol, timeframe, bars: MAX_BARS });
  const feed: MarketFeed = createMarketFeed((id) => (req) => history(id, req));
  const resolver = (path: string): Promise<string | null> =>
    ask((rid) => ({ proto: 'ask', rid, kind: 'library', path })) as Promise<string | null>;

  const backtest = createBacktestHandler((msg) => send({ proto: 'backtest', msg }), { resolver, feed });
  const maker = createHost((msg) => send({ proto: 'maker', msg }), load);

  port.on('message', (raw) => {
    const m = raw as ToEngine;
    if (!m || typeof m !== 'object') return;
    if (m.proto === 'backtest') backtest(m.msg);
    else if (m.proto === 'maker') maker.receive(m.msg);
    else if (m.proto === 'answer') {
      const p = pending.get(m.rid);
      if (!p) return;
      pending.delete(m.rid);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error));
    }
  });
}
