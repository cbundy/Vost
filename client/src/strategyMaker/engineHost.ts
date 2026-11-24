/** The engine's side of the protocol: used by the worker, and by the page itself when it has no worker. */
import type { Reply, Request } from './protocol';
import type { FindStage } from './run';
import { fetchHistoryApi } from '../lib/providers/api';
import { MAX_BARS } from '../../../shared/market.ts';
import type { PineEnv } from '../lib/pine/runtime';
import { runSweep } from './sweep/sweep';
import { withDemo } from './sweep/demoLoad';
import type { SweepLoad } from './sweep/types';
import { runEngine, runTrain, tradesOf } from './run';

export interface Host {
  receive(msg: Request): void;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

/** The default loader of a sweep: the server's history route, as many bars as one request may ask. */
export const apiLoad: SweepLoad = withDemo((market, timeframe, signal) =>
  fetchHistoryApi(market.provider, { symbol: market.symbol, timeframe, bars: MAX_BARS }, signal),
);

/** `env` is where the host runs TradingView indicators' libraries and other markets from; absent, the browser's defaults. */
export function createHost(post: (reply: Reply) => void, load: SweepLoad = apiLoad, env?: PineEnv): Host {
  const runs = new Map<string, AbortController>();
  return {
    receive(msg) {
      if (!msg || msg.v !== 1) return;
      if (msg.type === 'cancel') {
        runs.get(msg.id)?.abort();
        runs.delete(msg.id);
        post({ v: 1, id: msg.id, type: 'error', message: 'Cancelled', cancelled: true });
        return;
      }
      if (msg.type === 'trades') {
        try {
          post({ v: 1, id: msg.id, type: 'trades', trades: tradesOf(msg.candles, msg.candidate.strategyId, msg.candidate.params, msg.inputs) });
        } catch (e) {
          post({ v: 1, id: msg.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
        return;
      }
      // One run at a time: a new find stops the one before it.
      for (const [, ctl] of runs) ctl.abort();
      runs.clear();
      const ctl = new AbortController();
      runs.set(msg.id, ctl);
      if (msg.type === 'sweep') {
        const id = msg.id;
        runSweep(msg.input, load, (progress) => {
          if (!ctl.signal.aborted) post({ v: 1, id, type: 'sweep-progress', progress });
        }, ctl.signal, env)
          .then((result) => {
            if (ctl.signal.aborted) return;
            runs.delete(id);
            post({ v: 1, id, type: 'sweep-result', result });
          })
          .catch((e: unknown) => {
            if (ctl.signal.aborted || isAbort(e)) return;
            runs.delete(id);
            post({ v: 1, id, type: 'error', message: errText(e) });
          });
        return;
      }
      const progress = (pct: number, stage: FindStage): void => {
        if (!ctl.signal.aborted) post({ v: 1, id: msg.id, type: 'progress', pct, stage });
      };
      (msg.type === 'train' ? runTrain(msg.series, ctl.signal, progress) : runEngine(msg.series, msg.inputs, ctl.signal, progress, msg.model))
        .then((outcome) => {
          if (ctl.signal.aborted) return;
          runs.delete(msg.id);
          post({ v: 1, id: msg.id, type: 'result', outcome });
        })
        .catch((e: unknown) => {
          if (ctl.signal.aborted || isAbort(e)) return;
          runs.delete(msg.id);
          post({ v: 1, id: msg.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
        });
    },
  };
}
