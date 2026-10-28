/**
 * Watches the prices alerts need. Live-capable providers get one relay
 * subscription per (provider, symbol, 1m); the others are polled through the
 * adapter's `history` at the provider's smallest timeframe, one request per
 * (provider, symbol) per round. It only reports prices: it never changes an
 * alert itself, and a feed error never reports one.
 */
import type { Alert } from '../../shared/alerts.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import type { Timeframe } from '../../shared/market.ts';
import type { Relay } from '../live/relay.ts';
import { realTimers, type Timers } from '../live/socket.ts';
import type { AdapterContext, ProviderAdapter } from '../providers/types.ts';

export const MIN_POLL_SECONDS = 10;
export const DEFAULT_POLL_SECONDS = 60;

export function clampPollSeconds(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_POLL_SECONDS;
  return Math.max(MIN_POLL_SECONDS, n);
}

export interface EvaluatorDeps {
  relay: Relay;
  adapters: ReadonlyMap<string, ProviderAdapter>;
  ctx: () => AdapterContext;
  timers?: Timers;
  pollSeconds?: number;
  log: (line: string) => void;
  /** The alerts as they are now (only active ones need prices). */
  alerts: () => Alert[];
  /** A price was seen for (provider, symbol). */
  onPrice: (provider: string, symbol: string, price: number) => void;
}

export interface Evaluator {
  /** Makes the subscriptions and polls match the active alerts. */
  sync(): void;
  stop(): void;
}

const keyOf = (provider: string, symbol: string): string => `${provider}|${symbol}`;

export function createEvaluator(deps: EvaluatorDeps): Evaluator {
  const timers = deps.timers ?? realTimers;
  const pollMs = clampPollSeconds(deps.pollSeconds) * 1000;
  const live = new Map<string, { unsubscribe(): void }>();
  const polled = new Map<string, { provider: string; symbol: string; busy: boolean }>();
  /** Last error text logged per feed, so a repeating failure is logged once. */
  const failing = new Map<string, string>();
  let pollTimer: unknown = null;
  let stopped = false;

  const fail = (key: string, provider: string, symbol: string, text: string): void => {
    if (failing.get(key) === text) return;
    failing.set(key, text);
    deps.log(`[alerts] ${provider} ${symbol} ${text}`);
  };
  const recover = (key: string, provider: string, symbol: string): void => {
    if (failing.delete(key)) deps.log(`[alerts] ${provider} ${symbol} recovered`);
  };

  const pollOne = async (key: string): Promise<void> => {
    const target = polled.get(key);
    if (!target || target.busy || stopped) return;
    const adapter = deps.adapters.get(target.provider);
    const timeframe = catalogEntry(target.provider)?.timeframes[0] as Timeframe | undefined;
    if (!adapter || !timeframe) return;
    target.busy = true;
    try {
      const candles = await adapter.history(deps.ctx(), { symbol: target.symbol, timeframe, bars: 3 });
      const price = candles[candles.length - 1]?.close;
      if (typeof price !== 'number' || !Number.isFinite(price)) throw new Error('no price in the answer');
      recover(key, target.provider, target.symbol);
      if (!stopped && polled.get(key) === target) deps.onPrice(target.provider, target.symbol, price);
    } catch (err) {
      fail(key, target.provider, target.symbol, err instanceof Error ? err.message : String(err));
    } finally {
      target.busy = false;
    }
  };

  const round = (): void => {
    for (const key of [...polled.keys()]) void pollOne(key);
  };

  return {
    sync() {
      if (stopped) return;
      const wantLive = new Map<string, Alert>();
      const wantPoll = new Map<string, Alert>();
      for (const a of deps.alerts()) {
        if (a.status !== 'active') continue;
        (catalogEntry(a.provider)?.supportsLive ? wantLive : wantPoll).set(keyOf(a.provider, a.symbol), a);
      }

      for (const [key, sub] of [...live]) {
        if (wantLive.has(key)) continue;
        sub.unsubscribe();
        live.delete(key);
        failing.delete(key);
      }
      for (const [key, a] of wantLive) {
        if (live.has(key)) continue;
        const { provider, symbol } = a;
        // Reserve the slot first: the relay may report synchronously.
        const slot = { unsubscribe: () => undefined as void };
        live.set(key, slot);
        const result = deps.relay.subscribe(provider, symbol, '1m', {
          onStatus: (ev) => {
            if (ev.status === 'error' || ev.fatal) fail(key, provider, symbol, ev.detail ?? 'feed error');
            else if (ev.status === 'live') recover(key, provider, symbol);
          },
          onKline: (ev) => deps.onPrice(provider, symbol, ev.candle.close),
          onLog: () => undefined,
          onEnd: () => undefined,
        });
        if ('error' in result) {
          fail(key, provider, symbol, result.error);
          live.delete(key);
        } else if (live.get(key) === slot) {
          slot.unsubscribe = result.unsubscribe;
        } else {
          result.unsubscribe(); // the alert fired or was removed while subscribing
        }
      }

      for (const key of [...polled.keys()]) {
        if (!wantPoll.has(key)) {
          polled.delete(key);
          failing.delete(key);
        }
      }
      const fresh: string[] = [];
      for (const [key, a] of wantPoll) {
        if (polled.has(key)) continue;
        polled.set(key, { provider: a.provider, symbol: a.symbol, busy: false });
        fresh.push(key);
      }
      if (polled.size > 0 && pollTimer === null) pollTimer = timers.setInterval(round, pollMs);
      if (polled.size === 0 && pollTimer !== null) {
        timers.clearInterval(pollTimer);
        pollTimer = null;
      }
      // A new target gets its first price now, not a round later.
      for (const key of fresh) void pollOne(key);
    },
    stop() {
      stopped = true;
      if (pollTimer !== null) timers.clearInterval(pollTimer);
      pollTimer = null;
      for (const sub of live.values()) sub.unsubscribe();
      live.clear();
      polled.clear();
    },
  };
}
