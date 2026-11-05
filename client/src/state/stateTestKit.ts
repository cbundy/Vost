/** Shared helpers for the store tests (not a test file itself). */
import { expect, vi } from 'vitest';
import type { ChartStore } from './chart';
import { seedStorageForTest } from '../lib/storage';

/** An empty server settings store for this test (shared across `vi.resetModules()`; every write counts as saved). */
export function stubStorage(initial: Record<string, unknown> = {}) {
  seedStorageForTest(initial);
}

const cache = () => (globalThis as { __vostStorageCache?: Map<string, string> }).__vostStorageCache!;
/** The JSON text saved under a name, or null. */
export const storedRaw = (key: string): string | null => cache().get(key) ?? null;
/** The names of the saved documents. */
export const storedKeys = (): string[] => [...cache().keys()];
/** Every saved document's JSON text, one per line. */
export const allStoredRaw = (): string => [...cache().values()].join('\n');
/** The value saved under a name (undefined when none). */
export const stored = (key: string): any => {
  const raw = storedRaw(key);
  return raw === null ? undefined : JSON.parse(raw);
};
/** Saves JSON text under a name as it would be after a start-up load (not necessarily valid JSON, to test corrupt data). */
export const seedRaw = (key: string, raw: string): void => void cache().set(key, raw);

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
