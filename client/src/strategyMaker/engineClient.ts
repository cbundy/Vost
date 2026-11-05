/**
 * The page's side of the worker protocol: a lazily created worker, ids mapped to promises, cancel with a
 * one-second terminate fallback, and the same engine run on the page when there is no worker or it crashes.
 */
import type { Candle } from '../../../shared/market.ts';
import type { SeriesInput } from './engine';
import { createHost } from './engineHost';
import type { Reply, Request, TradesCandidate } from './protocol';
import type { EngineOutcome, FindInputs, FindStage, FoundTrade } from './run';

export const CANCEL_GRACE_MS = 1000;

export interface FindOptions {
  signal?: AbortSignal;
  /** `onPage` is true while the run is on the page's own thread. */
  onProgress?: (pct: number, stage: FindStage, onPage: boolean) => void;
}

export interface EngineClient {
  find(series: SeriesInput[], inputs: FindInputs, opts?: FindOptions): Promise<EngineOutcome>;
  trades(candles: Candle[], candidate: TradesCandidate, inputs: Pick<FindInputs, 'direction' | 'risk'>): Promise<FoundTrade[]>;
  /** Stops any run and ends the worker. */
  dispose(): void;
}

/** What the client needs of a Worker; a stub implements just this. */
export interface WorkerLike {
  postMessage(msg: Request): void;
  terminate(): void;
  onmessage: ((ev: { data: Reply }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface ClientOptions {
  /** Makes the worker; null or a throw means there is none (the page runs the engine itself). */
  makeWorker?: () => WorkerLike | null;
  cancelGraceMs?: number;
}

const defaultMakeWorker = (): WorkerLike | null =>
  typeof Worker === 'undefined' ? null : (new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);

const abortError = (): Error => new DOMException('The run was cancelled', 'AbortError');

interface Pending {
  request: Request;
  resolve: (r: Reply) => void;
  reject: (e: Error) => void;
  onProgress?: FindOptions['onProgress'];
  last: number;
}

interface Channel {
  post(msg: Request): void;
  close(): void;
  onPage: boolean;
}

export function createEngineClient(opts: ClientOptions = {}): EngineClient {
  const makeWorker = opts.makeWorker ?? defaultMakeWorker;
  const grace = opts.cancelGraceMs ?? CANCEL_GRACE_MS;
  let channel: Channel | null = null;
  let broken = false;
  let seq = 0;
  const pending = new Map<string, Pending>();
  /** Cancels the worker has not answered yet. */
  const unanswered = new Map<string, ReturnType<typeof setTimeout>>();
  let current: string | null = null;

  const answer = (id: string): void => {
    const t = unanswered.get(id);
    if (t !== undefined) clearTimeout(t);
    unanswered.delete(id);
  };

  const deliver = (reply: Reply): void => {
    if (reply.type === 'error' && reply.cancelled) return answer(reply.id);
    const p = pending.get(reply.id);
    if (!p) return;
    if (reply.type === 'progress') {
      p.last = Math.max(p.last, reply.pct);
      p.onProgress?.(p.last, reply.stage, channel?.onPage ?? false);
      return;
    }
    pending.delete(reply.id);
    if (current === reply.id) current = null;
    if (reply.type === 'error') p.reject(new Error(reply.message));
    else p.resolve(reply);
  };

  const openChannel = (): Channel => {
    if (channel) return channel;
    let worker: WorkerLike | null = null;
    if (!broken) {
      try {
        worker = makeWorker();
      } catch {
        worker = null;
      }
    }
    if (worker) {
      const w = worker;
      const mine: Channel = {
        onPage: false,
        post: (m) => w.postMessage(m),
        close: () => {
          w.onmessage = null;
          w.onerror = null;
          w.terminate();
        },
      };
      w.onmessage = (ev) => {
        if (channel === mine) deliver(ev.data);
      };
      w.onerror = () => {
        if (channel !== mine) return;
        broken = true;
        mine.close();
        channel = null;
        // What was running starts again on the page.
        const again = [...pending.values()].map((p) => p.request);
        for (const r of again) openChannel().post(r);
      };
      channel = mine;
    } else {
      const host = createHost((reply) => queueMicrotask(() => deliver(reply)));
      channel = { onPage: true, post: (m) => host.receive(m), close: () => undefined };
    }
    return channel;
  };

  const cancel = (id: string): void => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (current === id) current = null;
    p.reject(abortError());
    if (!channel) return;
    const ch = channel;
    ch.post({ v: 1, id, type: 'cancel' });
    if (ch.onPage) return;
    // A worker that is deep in one long step cannot hear the cancel: after the grace it is ended and replaced.
    unanswered.set(
      id,
      setTimeout(() => {
        unanswered.delete(id);
        if (channel !== ch) return;
        ch.close();
        channel = null;
        for (const [pid, q] of pending) {
          pending.delete(pid);
          q.reject(new Error('The worker was restarted'));
        }
      }, grace),
    );
  };

  const request = <T extends Reply>(make: (id: string) => Request, extra: Partial<Pending> = {}): { id: string; done: Promise<T> } => {
    const id = String(++seq);
    const msg = make(id);
    const done = new Promise<T>((resolve, reject) => {
      pending.set(id, { request: msg, resolve: resolve as (r: Reply) => void, reject, last: 0, ...extra });
    });
    openChannel().post(msg);
    return { id, done };
  };

  return {
    find(series, inputs, o = {}) {
      if (o.signal?.aborted) return Promise.reject(abortError());
      // A new find stops the one running.
      if (current) cancel(current);
      const { id, done } = request<Extract<Reply, { type: 'result' }>>((id) => ({ v: 1, id, type: 'find', series, inputs }), { onProgress: o.onProgress });
      current = id;
      o.signal?.addEventListener('abort', () => cancel(id), { once: true });
      return done.then((r) => r.outcome);
    },
    trades(candles, candidate, inputs) {
      return request<Extract<Reply, { type: 'trades' }>>((id) => ({ v: 1, id, type: 'trades', candles, candidate, inputs })).done.then((r) => r.trades);
    },
    dispose() {
      if (current) cancel(current);
      for (const t of unanswered.values()) clearTimeout(t);
      unanswered.clear();
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(abortError());
      }
      channel?.close();
      channel = null;
    },
  };
}
