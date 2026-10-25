/**
 * Core domain types shared across the app.
 */

export { TIMEFRAMES } from '../../shared/market.ts';
import type { Candle } from '../../shared/market.ts';
export type { Candle, Timeframe } from '../../shared/market.ts';

/** Human label for a detected/synthetic timeframe. */
export interface DatasetInfo {
  /** Estimated bar length in seconds. */
  barSeconds: number;
  /** Human label, e.g. "1h", "13m", "3d", "custom". */
  label: string;
}

/** A locally stored dataset (CSV import, saved fetch, demo data...). */
export interface Dataset {
  id: string;
  name: string;
  /** Where it came from: provider id, "csv", "demo"... */
  source: string;
  createdAt: number;
  /** e.g. "Binance • BTCUSDT • 1h" or file name. */
  description: string;
  barSeconds: number;
  barLabel: string;
  candles: Candle[];
}

export type Series = Array<number | null>;

export function uid(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
