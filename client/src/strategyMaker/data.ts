/** Loads candles for the strategy maker page: from a provider, the local library (read-only) or a CSV text. */
import { MAX_BARS, type Candle } from '../../../shared/market.ts';
import { candlesFromCsvText } from '../lib/csv';
import { loadJson } from '../lib/storage';
import type { DataProvider, HistoryRequest } from '../lib/providers/http';
import type { Dataset } from '../types';

export type Loaded = { ok: true; candles: Candle[]; label: string } | { ok: false; error: string };

/** Bars a market load (and Find's refetch of a provider set) asks for: the most one history request may ask. */
export const PROVIDER_BARS = MAX_BARS;

/** Bars visible when the chart opens on a long series. */
export const OPENING_BARS = 300;
const RIGHT_PAD = 5;

/** The logical range the chart opens on: the latest bars with a small right pad, or null (fit all) for a short series. */
export function openingRange(count: number, view = OPENING_BARS): { from: number; to: number } | null {
  if (count <= view) return null;
  return { from: count - view, to: count - 1 + RIGHT_PAD };
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function loadFromProvider(provider: DataProvider, req: HistoryRequest, signal?: AbortSignal): Promise<Loaded> {
  try {
    const candles = await provider.fetchHistory(req, signal);
    if (!candles.length) return { ok: false, error: 'The provider returned no candles for this market and timeframe.' };
    return { ok: true, candles, label: `${provider.name} - ${req.symbol} - ${req.timeframe}` };
  } catch (e) {
    return { ok: false, error: `Could not load candles: ${msg(e)}` };
  }
}

/** The saved datasets of the main app, read only. An empty, missing or corrupt key gives an empty list. */
export function readLibrary(): Dataset[] {
  const list = loadJson<unknown>('datasets.v1', []);
  if (!Array.isArray(list)) return [];
  return list.filter(
    (d): d is Dataset => !!d && typeof d === 'object' && typeof (d as Dataset).id === 'string' && Array.isArray((d as Dataset).candles),
  );
}

export function loadFromDataset(d: Dataset): Loaded {
  if (!d.candles.length) return { ok: false, error: 'This dataset has no candles.' };
  return { ok: true, candles: d.candles, label: d.name };
}

export function loadFromCsv(text: string, name: string): Loaded {
  try {
    const r = candlesFromCsvText(text);
    if (!r.candles.length) return { ok: false, error: `No candles found in ${name}.` };
    return { ok: true, candles: r.candles, label: name };
  } catch (e) {
    return { ok: false, error: `Could not read ${name}: ${msg(e)}` };
  }
}
