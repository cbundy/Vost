/**
 * Wire types of `GET /api/status`: the health of every (exchange, data type)
 * pair Vost pulls data from, kept by the server and shown in the top bar.
 */
import { PROVIDER_CATALOG } from './providerCatalog.ts';

/** `ok` working, `degraded` slow or failing once, `down` failing twice in a row, `unknown` not checked yet. */
export type StatusState = 'ok' | 'degraded' | 'down' | 'unknown';
/** `history` candles, `symbols` symbol lookup, `live` the websocket stream. */
export type StatusFeed = 'history' | 'symbols' | 'live';
/** Who saw the last result: a background probe, the live relay, or a real user request. */
export type StatusSource = 'probe' | 'relay' | 'traffic';

export interface StatusCheck {
  provider: string;
  providerName: string;
  feed: StatusFeed;
  state: StatusState;
  latencyMs: number | null;
  /** Unix ms of the last result, or null before the first one. */
  checkedAt: number | null;
  /** Unix ms of the last success, or null when there was none yet. */
  lastOkAt: number | null;
  /** The last failure text (kept while the check is not ok), or null. */
  error: string | null;
  source: StatusSource;
}

export interface StatusResponse {
  server: { state: 'ok'; version: string; uptimeSeconds: number };
  /** Seconds between background rounds; 0 when background probes are off. */
  intervalSeconds: number;
  checks: StatusCheck[];
  /** Only on `?refresh=1`: true when this call ran a round, false when it joined or reused one. */
  refreshed?: boolean;
}

/** Providers whose symbol lookup is built in (no remote call to check). */
const LOCAL_SYMBOLS = new Set(['stooq']);

/** The feeds Vost checks for a provider, derived from the catalog. */
export function statusFeeds(provider: string): StatusFeed[] {
  const info = PROVIDER_CATALOG.find((p) => p.id === provider);
  if (!info) return [];
  const feeds: StatusFeed[] = ['history'];
  if (!LOCAL_SYMBOLS.has(provider)) feeds.push('symbols');
  if (info.supportsLive) feeds.push('live');
  return feeds;
}

/** Every (provider, feed) pair, in catalog order. */
export function statusKeys(): Array<{ provider: string; feed: StatusFeed }> {
  return PROVIDER_CATALOG.flatMap((p) => statusFeeds(p.id).map((feed) => ({ provider: p.id, feed })));
}
