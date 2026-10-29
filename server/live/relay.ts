/**
 * The live relay: one upstream socket per (provider, symbol, timeframe),
 * shared by every subscriber (an open browser tab each). A new subscriber
 * gets the current status and the last kline at once; the socket closes when
 * the last subscriber leaves.
 */
import { canonicalInterval, type Candle, type Interval, type LiveKlineEvent, type LiveLogEvent, type LiveStatusEvent, type Timeframe } from '../../shared/market.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import { sourceBase, type Source } from '../../shared/timeframes.ts';
import type { HistoryRequest } from '../providers/types.ts';
import type { FetchFn } from '../providers/upstream.ts';
import { createBuiltFolder, type BuiltFolder } from './builtFeed.ts';
import { liveFeed } from './feeds.ts';
import { openUpstream, realTimers, type Timers, type UpstreamSocket, type WebSocketCtor } from './socket.ts';

export interface Subscriber {
  onStatus(ev: LiveStatusEvent): void;
  onKline(ev: LiveKlineEvent): void;
  onLog(ev: LiveLogEvent): void;
  /** The relay shut down: the subscriber's stream should end. */
  onEnd(): void;
}

export interface FeedStats {
  provider: string;
  symbol: string;
  timeframe: string;
  subscribers: number;
  status: LiveStatusEvent['status'];
  /** Failed upstream attempts since the feed was opened. */
  reconnects: number;
  lastError: string | null;
}

export type SubscribeResult = { unsubscribe(): void } | { error: string };

export interface Relay {
  /** Never throws: input the server cannot serve comes back as `{ error }`. */
  subscribe(provider: string, symbol: string, timeframe: string, sub: Subscriber, opts?: { source?: Source }): SubscribeResult;
  stats(): FeedStats[];
  /** Closes every upstream socket and ends every subscriber. */
  closeAll(): void;
}

export interface RelayDeps {
  WebSocket?: WebSocketCtor;
  timers?: Timers;
  /** Used by feeds that seed from REST (Coinbase). */
  fetch?: FetchFn;
  /** Server log line sink; defaults to `console.log`. */
  log?: (line: string) => void;
  /** Base history that seeds a built timeframe's live bar; without it a built timeframe is refused. */
  history?: (provider: string, req: HistoryRequest) => Promise<Candle[]>;
  /** Clock in ms; defaults to `Date.now`. */
  now?: () => number;
}

/** A live bar of a built timeframe: it subscribes to the base entry and folds its klines. */
interface BuiltEntry {
  subs: Set<Subscriber>;
  status: LiveStatusEvent;
  lastKline: LiveKlineEvent | null;
  folder: BuiltFolder;
  baseSub: { unsubscribe(): void } | null;
}

interface Entry {
  provider: string;
  symbol: string;
  timeframe: string;
  subs: Set<Subscriber>;
  socket: UpstreamSocket | null;
  status: LiveStatusEvent;
  lastKline: LiveKlineEvent | null;
  reconnects: number;
  lastError: string | null;
}

/** Safe fan-out: one broken subscriber must not stop the others or the feed. */
function each(entry: Entry, fn: (sub: Subscriber) => void): void {
  for (const sub of [...entry.subs]) {
    try {
      fn(sub);
    } catch {
      /* the subscriber's own close handler removes it */
    }
  }
}

export function createRelay(deps: RelayDeps = {}): Relay {
  const entries = new Map<string, Entry>();
  const builtEntries = new Map<string, BuiltEntry>();
  const serverLog = deps.log ?? ((line: string) => console.log(line));

  const release = (key: string, entry: Entry): void => {
    entry.socket?.close();
    entry.socket = null;
    entries.delete(key);
  };

  const subscribeBuilt = (provider: string, symbol: string, timeframe: Interval, base: Timeframe, sub: Subscriber, subscribeBase: Relay['subscribe']): SubscribeResult => {
    const key = `${provider}|${symbol}|${timeframe}<${base}`;
    let entry = builtEntries.get(key);
    if (!entry) {
      const created: BuiltEntry = { subs: new Set([sub]), status: { status: 'connecting' }, lastKline: null, folder: null as unknown as BuiltFolder, baseSub: null };
      const fan = (fn: (s: Subscriber) => void): void => {
        for (const s of [...created.subs]) {
          try {
            fn(s);
          } catch {
            /* the subscriber's own close handler removes it */
          }
        }
      };
      created.folder = createBuiltFolder({
        symbol,
        target: timeframe,
        base,
        history: (req) => deps.history!(provider, req),
        timers: deps.timers ?? realTimers,
        now: deps.now ?? Date.now,
        log: (severity, text) => {
          serverLog(`[live] ${provider} ${symbol} ${timeframe} ${severity}: ${text}`);
          fan((s) => s.onLog({ severity, text }));
        },
        emit: (ev) => {
          created.lastKline = ev;
          fan((s) => s.onKline(ev));
        },
      });
      builtEntries.set(key, created);
      const baseSub = subscribeBase(provider, symbol, base, {
        onStatus: (ev) => {
          created.status = ev;
          fan((s) => s.onStatus(ev));
          created.folder.onBaseStatus(ev);
        },
        onKline: (ev) => created.folder.onBaseKline(ev),
        onLog: (ev) => fan((s) => s.onLog(ev)),
        onEnd: () => undefined,
      });
      if ('error' in baseSub) {
        builtEntries.delete(key);
        created.folder.dispose();
        return baseSub;
      }
      created.baseSub = baseSub;
      entry = created;
    } else {
      entry.subs.add(sub);
      sub.onStatus(entry.status);
      if (entry.lastKline) sub.onKline(entry.lastKline);
    }
    const joined = entry;
    let left = false;
    return {
      unsubscribe() {
        if (left) return;
        left = true;
        joined.subs.delete(sub);
        if (joined.subs.size === 0 && builtEntries.get(key) === joined) {
          builtEntries.delete(key);
          joined.folder.dispose();
          joined.baseSub?.unsubscribe();
        }
      },
    };
  };

  const relay: Relay = {
    subscribe(provider, rawSymbol, timeframe, sub, opts) {
      const symbol = rawSymbol.trim().toUpperCase();
      if (!symbol) return { error: 'Missing symbol' };
      const info = catalogEntry(provider);
      if (deps.history && info?.supportsLive && canonicalInterval(timeframe) === timeframe) {
        const base = sourceBase(info.timeframes, timeframe as Interval, opts?.source ?? 'native');
        if (base) return subscribeBuilt(provider, symbol, timeframe as Interval, base, sub, relay.subscribe);
      }
      const key = `${provider}|${symbol}|${timeframe}`;
      let entry = entries.get(key);
      if (!entry) {
        const found = liveFeed(provider, symbol, timeframe, { fetch: deps.fetch });
        if ('error' in found) return { error: found.error };
        const created: Entry = {
          provider,
          symbol,
          timeframe,
          subs: new Set(),
          socket: null,
          status: { status: 'connecting' },
          lastKline: null,
          reconnects: 0,
          lastError: null,
        };
        entries.set(key, created);
        entry = created;
        // Subscribe before opening: the socket reports its first status synchronously.
        entry.subs.add(sub);
        created.socket = openUpstream({
          feed: found.feed,
          WebSocket: deps.WebSocket,
          timers: deps.timers,
          label: `${symbol} ${timeframe}`,
          onStatus: (ev) => {
            created.status = ev;
            each(created, (s) => s.onStatus(ev));
          },
          onKline: (candle: Candle, closed: boolean) => {
            created.lastKline = { candle, closed };
            each(created, (s) => s.onKline(created.lastKline!));
          },
          onLog: (ev) => {
            serverLog(`[live] ${provider} ${symbol} ${timeframe} ${ev.severity}: ${ev.text}`);
            each(created, (s) => s.onLog(ev));
          },
          onFailure: (text) => {
            created.reconnects++;
            created.lastError = text;
          },
        });
      } else {
        entry.subs.add(sub);
        // A new subscriber starts from the current state.
        sub.onStatus(entry.status);
        if (entry.lastKline) sub.onKline(entry.lastKline);
      }
      const joined = entry;
      let left = false;
      return {
        unsubscribe() {
          if (left) return;
          left = true;
          joined.subs.delete(sub);
          if (joined.subs.size === 0 && entries.get(key) === joined) release(key, joined);
        },
      };
    },
    stats() {
      return [...entries.values()].map((e) => ({
        provider: e.provider,
        symbol: e.symbol,
        timeframe: e.timeframe,
        subscribers: e.subs.size,
        status: e.status.status,
        reconnects: e.reconnects,
        lastError: e.lastError,
      }));
    },
    closeAll() {
      for (const [key, entry] of [...builtEntries]) {
        const subs = [...entry.subs];
        builtEntries.delete(key);
        entry.folder.dispose();
        entry.baseSub?.unsubscribe();
        entry.subs.clear();
        for (const s of subs) {
          try {
            s.onEnd();
          } catch {
            /* ignore */
          }
        }
      }
      for (const [key, entry] of [...entries]) {
        const subs = [...entry.subs];
        release(key, entry);
        entry.subs.clear();
        for (const s of subs) {
          try {
            s.onEnd();
          } catch {
            /* ignore */
          }
        }
      }
    },
  };
  return relay;
}
