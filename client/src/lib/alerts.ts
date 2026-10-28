/**
 * Price alerts, client side: the API calls, the labels, the "seen" record that
 * keeps a firing from being announced twice, and the pure `unseenTriggers`.
 */
import type { ApiError } from '../../../shared/market.ts';
import type { Alert, AlertCondition, AlertEdit, AlertInput, AlertList } from '../../../shared/alerts.ts';
import { loadJson, saveJson } from './storage';

export type { Alert, AlertCondition, AlertEdit, AlertInput, AlertList };

export const SEEN_KEY = 'alerts.seen.v1';
export const SOUND_KEY = 'alerts.sound.v1';
/** The seen record keeps at most this many keys (the newest). */
export const SEEN_CAP = 500;

export const NETWORK_ERROR = 'Could not reach the Vost server';

export const CONDITION_LABEL: Record<AlertCondition, string> = {
  'crossing-up': 'Crossing up',
  'crossing-down': 'Crossing down',
  crossing: 'Crossing',
};

const CONDITION_VERB: Record<AlertCondition, string> = {
  'crossing-up': 'crossed up',
  'crossing-down': 'crossed down',
  crossing: 'crossed',
};

export const conditionLabel = (c: AlertCondition): string => CONDITION_LABEL[c] ?? c;

/** A level or price as people read it: grouped thousands, up to 8 decimals. */
export function fmtLevel(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

/** "BTCUSDT crossed up 65,000 (at 65,012) - note" */
export function announcementText(a: Alert): string {
  const at = a.triggerPrice != null ? ` (at ${fmtLevel(a.triggerPrice)})` : '';
  const note = a.note.trim() ? ` - ${a.note.trim()}` : '';
  return `${a.symbol} ${CONDITION_VERB[a.condition] ?? 'crossed'} ${fmtLevel(a.level)}${at}${note}`;
}

/* ------------------------------ seen record ------------------------------ */

/** One firing of an alert. A re-armed alert keeps its id, so the time is part of the key. */
export const seenKey = (a: Pick<Alert, 'id' | 'triggeredAt'>): string => `${a.id}:${a.triggeredAt}`;

const idOfKey = (key: string): string => key.slice(0, key.lastIndexOf(':'));

/** Reads the stored record; anything but an array of strings reads as empty. */
export function loadSeen(): string[] {
  const raw = loadJson<unknown>(SEEN_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === 'string').slice(-SEEN_CAP);
}

export function saveSeen(keys: readonly string[]): void {
  saveJson(SEEN_KEY, keys.slice(-SEEN_CAP));
}

/** Adds keys (newest last), keeps at most `cap`. */
export function addSeen(seen: readonly string[], keys: readonly string[], cap = SEEN_CAP): string[] {
  const next = [...seen.filter((k) => !keys.includes(k)), ...keys];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Drops the keys of alerts that no longer exist. */
export function pruneSeen(seen: readonly string[], alerts: readonly Alert[]): string[] {
  const ids = new Set(alerts.map((a) => a.id));
  return seen.filter((k) => ids.has(idOfKey(k)));
}

/** Triggered alerts whose current firing is not in the seen record. */
export function unseenTriggers(alerts: readonly Alert[], seen: readonly string[] | ReadonlySet<string>): Alert[] {
  const set = seen instanceof Set ? seen : new Set(seen);
  return alerts.filter((a) => a.status === 'triggered' && a.triggeredAt != null && !set.has(seenKey(a)));
}

export function loadSound(): boolean {
  return loadJson<unknown>(SOUND_KEY, true) !== false;
}

export function saveSound(on: boolean): void {
  saveJson(SOUND_KEY, on);
}

/* ------------------------------ API ------------------------------ */

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Partial<ApiError> | null;
    throw new Error(typeof body?.error === 'string' && body.error ? body.error : `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export const fetchAlerts = (): Promise<AlertList> => call<AlertList>('/api/alerts');

export const createAlert = (input: AlertInput): Promise<Alert> =>
  call<Alert>('/api/alerts', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) });

export const editAlert = (id: string, edit: AlertEdit): Promise<Alert> =>
  call<Alert>(`/api/alerts/${encodeURIComponent(id)}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(edit) });

export const deleteAlert = (id: string): Promise<void> =>
  call<void>(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE', headers: JSON_HEADERS });

export const sendTelegramTest = (): Promise<void> =>
  call<void>('/api/alerts/telegram-test', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
