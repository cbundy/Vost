/**
 * Tiny localStorage persistence layer. Everything is namespaced under
 * `vost.*` and every call is defensive: private modes / quotas must never
 * crash the app.
 */

const PREFIX = 'vost.';

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export function storageAvailable(): boolean {
  try {
    const k = PREFIX + 'probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** Debounce helper used for autosaving preferences. `flush()` runs a pending call now; `cancel()` drops it. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait = 400) {
  let t: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  const debounced = (...args: A) => {
    if (t) clearTimeout(t);
    pending = args;
    t = setTimeout(() => {
      t = undefined;
      const a = pending!;
      pending = undefined;
      fn(...a);
    }, wait);
  };
  debounced.cancel = () => {
    if (t) clearTimeout(t);
    t = undefined;
    pending = undefined;
  };
  debounced.flush = () => {
    if (!t) return;
    const a = pending!;
    debounced.cancel();
    fn(...a);
  };
  return debounced;
}
