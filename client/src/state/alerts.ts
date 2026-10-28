/**
 * Alerts store: one same-origin EventSource on `/api/alerts/events`, the list,
 * the Telegram flag, the sound preference and the popups. Every firing is
 * announced once (inbox line, popup, bell) - also those that happened while
 * Vost was closed, found through the "seen" record. The event source, timers,
 * chime, storage and inbox are injectable so it runs in node tests.
 */
import { create } from 'zustand';
import type { Alert } from '../../../shared/alerts.ts';
import { playChime } from '../lib/chime';
import {
  addSeen,
  announcementText,
  fetchAlerts,
  loadSeen,
  loadSound,
  pruneSeen,
  saveSeen,
  saveSound,
  seenKey,
  unseenTriggers,
} from '../lib/alerts';
import type { MessageSeverity } from '../lib/messages';
import { useStore } from './store';

export const EVENTS_URL = '/api/alerts/events';
export const RETRY_MIN_MS = 1_000;
export const RETRY_MAX_MS = 30_000;

/** The part of an EventSource the store uses. */
export interface SourceLike {
  readonly readyState: number;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(type: string, fn: (ev: Event) => void): void;
  close(): void;
}

export interface AlertsDeps {
  eventSource?: (url: string) => SourceLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Plays the bell; false when the browser blocked it. */
  chime?: () => boolean;
  loadSeen?: () => string[];
  saveSeen?: (keys: string[]) => void;
  pushMessage?: (source: string, severity: MessageSeverity, text: string) => void;
  /** Reads the Telegram flag (once per connection). */
  fetchList?: typeof fetchAlerts;
}

export interface Popup {
  /** The firing's seen key. */
  key: string;
  alert: Alert;
  text: string;
}

interface AlertsStore {
  alerts: Alert[];
  /** null until known. */
  telegramConfigured: boolean | null;
  /** The stream is open. */
  connected: boolean;
  sound: boolean;
  /** Newest first. */
  popups: Popup[];
  start(deps?: AlertsDeps): void;
  stop(): void;
  setSound(on: boolean): void;
  dismissPopup(key: string): void;
  /** Puts an alert from an API reply into the list without waiting for the stream. */
  upsert(alert: Alert): void;
  remove(id: string): void;
}

const CLOSED = 2;
let stopFn: (() => void) | null = null;

export const useAlerts = create<AlertsStore>((set, get) => ({
  alerts: [],
  telegramConfigured: null,
  connected: false,
  sound: loadSound(),
  popups: [],

  start(deps = {}) {
    get().stop();
    const makeSource = deps.eventSource ?? ((url: string) => new EventSource(url) as unknown as SourceLike);
    const later = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    const cancel = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    const chime = deps.chime ?? playChime;
    const readSeen = deps.loadSeen ?? loadSeen;
    const writeSeen = deps.saveSeen ?? saveSeen;
    const push = deps.pushMessage ?? ((s, sev, t) => useStore.getState().pushMessage(s, sev, t));
    const readList = deps.fetchList ?? fetchAlerts;

    let stopped = false;
    let source: SourceLike | null = null;
    let timer: unknown;
    let delay = RETRY_MIN_MS;
    /** Firings announced in this tab. */
    const announced = new Set<string>();

    const announce = (alert: Alert): void => {
      const key = seenKey(alert);
      if (announced.has(key)) return;
      announced.add(key);
      // Written first, from the stored record, so another tab's entries are kept.
      writeSeen(addSeen(readSeen(), [key]));
      const text = announcementText(alert);
      push('Alerts', 'warning', text);
      set((s) => ({ popups: [{ key, alert, text }, ...s.popups.filter((p) => p.key !== key)] }));
      if (get().sound) {
        try {
          chime();
        } catch {
          /* the popup and the inbox line stand without the bell */
        }
      }
    };

    const parse = <T>(ev: Event): T | null => {
      try {
        return JSON.parse(String((ev as MessageEvent).data)) as T;
      } catch {
        return null;
      }
    };

    const open = (): void => {
      timer = undefined;
      if (stopped) return;
      const src = makeSource(EVENTS_URL);
      source = src;
      src.onopen = () => {
        if (stopped || source !== src) return;
        delay = RETRY_MIN_MS;
        set({ connected: true });
        readList()
          .then((res) => {
            if (!stopped && source === src) set({ telegramConfigured: res.telegram.configured });
          })
          .catch(() => undefined);
      };
      src.addEventListener('alerts', (ev) => {
        const d = parse<{ alerts: Alert[] }>(ev);
        if (!d || !Array.isArray(d.alerts) || stopped || source !== src) return;
        set({ alerts: d.alerts });
        const stored = readSeen();
        const pruned = pruneSeen(stored, d.alerts);
        if (pruned.length !== stored.length) writeSeen(pruned);
        for (const a of unseenTriggers(d.alerts, pruned)) announce(a);
      });
      src.addEventListener('triggered', (ev) => {
        const a = parse<Alert>(ev);
        if (!a || typeof a.id !== 'string' || stopped || source !== src) return;
        announce(a);
      });
      src.onerror = () => {
        if (stopped || source !== src) return;
        set({ connected: false });
        if (src.readyState === CLOSED) {
          // The browser gave up: reopen with a growing pause. While CONNECTING it retries by itself.
          src.close();
          timer = later(open, delay);
          delay = Math.min(delay * 2, RETRY_MAX_MS);
        }
      };
    };

    open();
    stopFn = () => {
      stopped = true;
      if (timer !== undefined) cancel(timer);
      timer = undefined;
      source?.close();
      source = null;
      set({ connected: false });
    };
  },

  stop() {
    stopFn?.();
    stopFn = null;
  },

  setSound(on) {
    saveSound(on);
    set({ sound: on });
  },

  dismissPopup(key) {
    set((s) => ({ popups: s.popups.filter((p) => p.key !== key) }));
  },

  upsert(alert) {
    set((s) => {
      const i = s.alerts.findIndex((a) => a.id === alert.id);
      return { alerts: i < 0 ? [...s.alerts, alert] : s.alerts.map((a, j) => (j === i ? alert : a)) };
    });
  },

  remove(id) {
    set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }));
  },
}));
