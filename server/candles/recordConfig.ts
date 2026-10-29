/**
 * `VOST_RECORD` and `VOST_RECORD_BARS`: which markets the server records and
 * how deep. Read once at start. A bad entry is skipped with a warning and
 * never stops the server.
 */
import { MAX_BARS, TIMEFRAMES, type Timeframe } from '../../shared/market.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import { liveFeed } from '../live/feeds.ts';
import { adapters } from '../providers/index.ts';
import type { Series } from './store.ts';

export const DEFAULT_RECORD = 'binance:BTCUSDT binance:ETHUSDT coinbase:BTC-USD coinbase:ETH-USD hyperliquid:BTC hyperliquid:ETH';
export const MIN_DEPTH = 100;

export interface RecordConfig {
  /** False for `VOST_RECORD=off`. */
  on: boolean;
  series: Series[];
  depthBars: number;
}

const isTimeframe = (s: string): s is Timeframe => (TIMEFRAMES as readonly string[]).includes(s);

/** Parses one entry into series, or returns why it is skipped. */
function parseEntry(token: string, quietUnknownProvider: boolean): Series[] | string | null {
  const parts = token.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p === '')) return 'malformed (use provider:SYMBOL or provider:SYMBOL:tf/tf)';
  const provider = parts[0]!.toLowerCase();
  const symbol = parts[1]!.toUpperCase();
  const info = catalogEntry(provider);
  if (!info) return quietUnknownProvider ? null : `unknown provider "${provider}"`;
  if (!adapters.has(provider)) return `${info.name} has no history adapter`;
  if (!info.supportsLive) return `${info.name} has no live feed`;
  let timeframes: string[];
  if (parts[2] === undefined) {
    timeframes = info.timeframes.filter((tf) => !('error' in liveFeed(provider, symbol, tf)));
    if (timeframes.length === 0) return `${info.name} has no live timeframe`;
  } else {
    timeframes = parts[2].split('/');
    for (const tf of timeframes) {
      if (!isTimeframe(tf)) return `unknown timeframe "${tf}"`;
      if (!info.timeframes.includes(tf)) return `${info.name} does not offer ${tf}`;
      const feed = liveFeed(provider, symbol, tf);
      if ('error' in feed) return feed.error;
    }
  }
  return timeframes.map((timeframe) => ({ provider, symbol, timeframe: timeframe as Timeframe }));
}

export function readRecordConfig(env: Record<string, string | undefined>, warn: (line: string) => void): RecordConfig {
  let depthBars = MAX_BARS;
  const rawDepth = env.VOST_RECORD_BARS?.trim();
  if (rawDepth) {
    const n = /^\d+$/.test(rawDepth) ? Number(rawDepth) : NaN;
    if (Number.isSafeInteger(n) && n >= MIN_DEPTH) depthBars = n;
    else warn(`[recorder] VOST_RECORD_BARS "${rawDepth}" is not an integer of at least ${MIN_DEPTH}; using ${MAX_BARS}`);
  }
  const raw = env.VOST_RECORD?.trim() ?? '';
  if (raw.toLowerCase() === 'off') return { on: false, series: [], depthBars };
  const isDefault = raw === '';
  const tokens = (isDefault ? DEFAULT_RECORD : raw).split(/[,\s]+/).filter(Boolean);
  const seen = new Set<string>();
  const series: Series[] = [];
  for (const token of tokens) {
    // A default provider this build does not have yet is left out without a warning.
    const parsed = parseEntry(token, isDefault);
    if (typeof parsed === 'string') warn(`[recorder] skipped "${token}": ${parsed}`);
    for (const s of Array.isArray(parsed) ? parsed : []) {
      const key = `${s.provider}|${s.symbol}|${s.timeframe}`;
      if (seen.has(key)) continue;
      seen.add(key);
      series.push(s);
    }
  }
  return { on: true, series, depthBars };
}

/** The `isRecorded` the history read-through takes. */
export function recordedFilter(config: RecordConfig): (provider: string, symbol: string, timeframe: Timeframe) => boolean {
  const keys = new Set(config.series.map((s) => `${s.provider}|${s.symbol}|${s.timeframe}`));
  return (provider, symbol, timeframe) => keys.has(`${provider}|${symbol.trim().toUpperCase()}|${timeframe}`);
}

/** The one start line. */
export function describeRecord(config: RecordConfig, storeOn: boolean): string {
  if (!config.on) return '[recorder] off (VOST_RECORD=off)';
  if (!storeOn) return '[recorder] off: candle store off';
  const list = config.series.map((s) => `${s.provider} ${s.symbol} ${s.timeframe}`).join(', ');
  return `[recorder] on: ${config.series.length} series (${list}), depth ${config.depthBars} bars`;
}
