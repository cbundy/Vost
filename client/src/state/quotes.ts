/**
 * Daily-quote store for the watchlist rows and the symbol card. Components
 * say which (provider, symbol) pairs are on screen; the store fetches daily
 * bars for them, at most once a minute per key, 4 at a time, never while the
 * tab is hidden (in-flight requests are aborted), and a failure just leaves
 * the key without bars (the row shows a dash). Kept apart from the main store;
 * the document, clock, timers and fetch are injectable so it runs in node tests.
 */
import { create } from 'zustand';
import type { Candle } from '../../../shared/market.ts';
import { dueKeys, QUOTE_MIN_AGE_MS } from '../lib/quotes';
import { providers } from '../lib/providers';

export const MAX_IN_FLIGHT = 4;
export const TICK_MS = 15_000;

export interface QuoteDocLike {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export interface QuoteDeps {
  fetchDaily?: (providerId: string, symbol: string, bars: number, signal: AbortSignal) => Promise<Candle[]>;
  doc?: QuoteDocLike;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  hasProvider?: (id: string) => boolean;
}

export interface WantedQuote {
  providerId: string;
  symbol: string;
  bars: number;
}

export interface QuoteEntry {
  /** The daily bars, or null after a failure. */
  bars: Candle[] | null;
  at: number;
  /** How many bars were asked for. */
  asked: number;
}

export const quoteKey = (providerId: string, symbol: string): string => `${providerId}:${symbol}`;

interface QuoteStore {
  entries: Record<string, QuoteEntry>;
  /** Replace what one source (the rows, the card) wants on screen. */
  setWanted(source: string, wanted: WantedQuote[]): void;
  start(deps?: QuoteDeps): void;
  stop(): void;
}

let runtime: { setWanted(source: string, wanted: WantedQuote[]): void; stop(): void } | null = null;

export const useQuotes = create<QuoteStore>((set) => ({
  entries: {},

  setWanted(source, wanted) {
    if (!runtime) useQuotes.getState().start();
    runtime?.setWanted(source, wanted);
  },

  start(deps = {}) {
    runtime?.stop();
    const doc = deps.doc ?? document;
    const now = deps.now ?? Date.now;
    const hasProvider = deps.hasProvider ?? ((id: string) => providers.some((p) => p.id === id));
    const fetchDaily =
      deps.fetchDaily ??
      ((id, symbol, bars, signal) => {
        const p = providers.find((x) => x.id === id);
        if (!p) return Promise.reject(new Error(`Unknown provider ${id}`));
        return p.fetchHistory({ symbol, timeframe: '1d', bars }, signal);
      });
    const setTick = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    const clearTick = deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));

    const sources = new Map<string, WantedQuote[]>();
    const inflight = new Map<string, AbortController>();
    /** When a request last started per key, so one aborted for leaving the screen still counts toward the throttle. */
    const attempts = new Map<string, { at: number; bars: number }>();
    let timer: unknown;
    let stopped = false;

    const wantedNow = (): Map<string, WantedQuote> => {
      const m = new Map<string, WantedQuote>();
      for (const list of sources.values()) {
        for (const w of list) {
          const k = quoteKey(w.providerId, w.symbol);
          const have = m.get(k);
          if (!have || have.bars < w.bars) m.set(k, w);
        }
      }
      return m;
    };

    const finish = (k: string, ctl: AbortController, bars: Candle[] | null, asked: number): void => {
      if (inflight.get(k) === ctl) inflight.delete(k);
      if (!ctl.signal.aborted) set((s) => ({ entries: { ...s.entries, [k]: { bars, at: now(), asked } } }));
      pump();
    };

    function pump(): void {
      if (stopped || doc.hidden) return;
      const wanted = wantedNow();
      for (const [k, ctl] of inflight) {
        if (!wanted.has(k)) {
          ctl.abort();
          inflight.delete(k);
        }
      }
      const entries = useQuotes.getState().entries;
      const lastFetched: Record<string, number> = {};
      for (const [k, e] of Object.entries(entries)) lastFetched[k] = e.at;
      // A key whose stored bars are fewer than now wanted is fetched again at once.
      for (const [k, a] of attempts) lastFetched[k] = Math.max(lastFetched[k] ?? 0, a.at);
      for (const [k, w] of wanted) {
        const asked = Math.max(entries[k]?.asked ?? 0, attempts.get(k)?.bars ?? 0);
        if (asked > 0 && asked < w.bars) delete lastFetched[k];
      }
      for (const k of dueKeys(wanted.keys(), lastFetched, now(), QUOTE_MIN_AGE_MS)) {
        if (inflight.size >= MAX_IN_FLIGHT) break;
        if (inflight.has(k)) continue;
        const w = wanted.get(k)!;
        if (!hasProvider(w.providerId)) {
          set((s) => ({ entries: { ...s.entries, [k]: { bars: null, at: now(), asked: w.bars } } }));
          continue;
        }
        const ctl = new AbortController();
        inflight.set(k, ctl);
        attempts.set(k, { at: now(), bars: w.bars });
        fetchDaily(w.providerId, w.symbol, w.bars, ctl.signal).then(
          (bars) => finish(k, ctl, bars, w.bars),
          () => finish(k, ctl, null, w.bars),
        );
      }
    }

    const pause = (): void => {
      if (timer !== undefined) clearTick(timer);
      timer = undefined;
      // A pause is not a failed attempt: the key is fetched again as soon as the tab is visible.
      for (const [k, ctl] of inflight) {
        ctl.abort();
        attempts.delete(k);
      }
      inflight.clear();
    };
    const begin = (): void => {
      if (timer !== undefined) return;
      timer = setTick(pump, TICK_MS);
      pump();
    };
    const onVisibility = (): void => (doc.hidden ? pause() : begin());
    doc.addEventListener('visibilitychange', onVisibility);
    if (!doc.hidden) begin();

    runtime = {
      setWanted(source, wanted) {
        if (wanted.length) sources.set(source, wanted);
        else sources.delete(source);
        pump();
      },
      stop() {
        stopped = true;
        pause();
        doc.removeEventListener('visibilitychange', onVisibility);
        runtime = null;
      },
    };
  },

  stop() {
    runtime?.stop();
  },
}));
