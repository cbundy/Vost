/** Fetching the stored TradingView indicators the market search can use, and attaching their sources to a request. */
import type { SweepInput } from './sweep/types';

export interface StoredIndicator {
  scriptId: string;
  name: string;
}

/** The stored indicators, or throws a plain message. */
export async function fetchStoredIndicators(signal?: AbortSignal): Promise<StoredIndicator[]> {
  const res = await fetch('/api/pine/indicators', { signal });
  if (!res.ok) throw new Error(`The server answered HTTP ${res.status}`);
  return ((await res.json()) as { indicators: StoredIndicator[] }).indicators;
}

/** One stored indicator's source, or null when it is no longer stored. */
export async function fetchIndicatorSource(id: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(`/api/pine/indicators/${encodeURIComponent(id)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load the stored TradingView indicator (${res.status})`);
  const body = (await res.json()) as { source?: unknown };
  return typeof body.source === 'string' ? body.source : null;
}

/**
 * The input with each picked indicator's source attached, fetched now and never saved. An indicator that is gone is left
 * without a source, so the run skips each market naming it. Nothing is fetched when no indicator is picked.
 */
export async function withPineSources(input: SweepInput, signal?: AbortSignal): Promise<SweepInput> {
  const pine = input.composed?.pine;
  if (!input.composed || !pine?.length) return input;
  const ids = [...new Set(pine.map((p) => p.role.indicatorId))];
  const sources: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      const source = await fetchIndicatorSource(id, signal);
      if (source) sources[id] = source;
    }),
  );
  return { ...input, composed: { ...input.composed, pineSources: sources } };
}

