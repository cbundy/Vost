/**
 * Connection-status store: polls `/api/status` every 30 s while the tab is
 * visible, stops while it is hidden and polls at once when it comes back.
 * Kept apart from the main store. The document and the timers are injectable
 * so it runs in node tests.
 */
import { create } from 'zustand';
import { fetchStatus, serverDown, viewOf, type StatusView } from '../lib/status';

export const POLL_MS = 30_000;

/** The part of `document` the poller uses. */
export interface DocLike {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export interface PollDeps {
  fetchStatus?: typeof fetchStatus;
  doc?: DocLike;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

interface StatusStore {
  status: StatusView | null;
  /** A "Test now" refresh is running. */
  loading: boolean;
  /** The last failure text, or null. */
  error: string | null;
  startPolling(deps?: PollDeps): void;
  stopPolling(): void;
  testNow(deps?: Pick<PollDeps, 'fetchStatus'>): Promise<void>;
}

let stop: (() => void) | null = null;

export const useStatus = create<StatusStore>((set, get) => ({
  status: null,
  loading: false,
  error: null,

  startPolling(deps = {}) {
    get().stopPolling();
    const doFetch = deps.fetchStatus ?? fetchStatus;
    const doc = deps.doc ?? document;
    const setTick = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    const clearTick = deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    let timer: unknown;
    let inflight: AbortController | null = null;

    const poll = (): void => {
      inflight?.abort();
      const ctl = new AbortController();
      inflight = ctl;
      doFetch(ctl.signal)
        .then((res) => {
          if (!ctl.signal.aborted) set({ status: viewOf(res), error: null });
        })
        .catch((err: unknown) => {
          if (ctl.signal.aborted) return;
          set({ status: serverDown(get().status), error: err instanceof Error ? err.message : String(err) });
        });
    };
    const begin = (): void => {
      if (timer !== undefined) return;
      poll();
      timer = setTick(poll, POLL_MS);
    };
    const pause = (): void => {
      if (timer !== undefined) clearTick(timer);
      timer = undefined;
      inflight?.abort();
      inflight = null;
    };
    const onVisibility = (): void => (doc.hidden ? pause() : begin());

    doc.addEventListener('visibilitychange', onVisibility);
    if (!doc.hidden) begin();
    stop = () => {
      pause();
      doc.removeEventListener('visibilitychange', onVisibility);
    };
  },

  stopPolling() {
    stop?.();
    stop = null;
  },

  async testNow(deps = {}) {
    if (get().loading) return;
    set({ loading: true });
    try {
      const res = await (deps.fetchStatus ?? fetchStatus)(undefined, true);
      set({ status: viewOf(res), error: null });
    } catch (err) {
      set({ status: serverDown(get().status), error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },
}));
