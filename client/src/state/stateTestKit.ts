/** Shared helpers for the store tests (not a test file itself). */
import { expect, vi } from 'vitest';
import type { ChartStore } from './chart';

export function stubStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  });
}

export type TestStore = (typeof import('./store'))['useStore'];
const used: TestStore[] = [];

/** Remember an app store so the after-each cleanup can let its Pine runs settle and flush its saves. */
export const track = (s: TestStore) => {
  used.push(s);
  return s;
};

export async function afterEachCleanup() {
  const stores = used.splice(0);
  for (const s of stores) {
    await vi.waitFor(() => {
      expect(Object.values(chartOf(s).getState().pineRuns).some((r) => r.running)).toBe(false);
    }, { timeout: 20000 });
    // flush while this test's storage stub is still in place
    s.getState().flushPersist();
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
}

/** The chart store the app store currently has active (the one `init()` builds from the saved prefs). */
export function chartOf(app: TestStore): ChartStore {
  const s = app.getState();
  return s.charts[s.activeChartId];
}

/** Marks a store as used without going through `track` (for a test that runs the cleanup itself). */
export function markUsed(s: TestStore) {
  used.push(s);
}

/** A snapshot of the app state and the active chart's state together, for assertions that read both. */
export function snap(app: TestStore) {
  return { ...app.getState(), ...chartOf(app).getState() };
}
