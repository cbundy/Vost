/**
 * The health record of every (provider, feed): the latest result, and the
 * rules that turn results into a state. Probes, real requests and the live
 * relay all report here; `snapshot()` is what `/api/status` serves.
 */
import { PROVIDER_CATALOG } from '../../shared/providerCatalog.ts';
import { statusKeys, type StatusCheck, type StatusFeed, type StatusSource, type StatusState } from '../../shared/status.ts';
import type { FeedStats } from '../live/relay.ts';

/** A success slower than this is `degraded`. */
export const SLOW_MS = 3000;
/** Failures in a row that make a check `down`. */
export const DOWN_AFTER = 2;

/**
 * One result. `ok: false` is a failure, unless `partial` (a live socket that
 * opened but sent nothing): then the check is degraded without counting as a failure.
 */
export type CheckResult = { ok: true; latencyMs: number } | { ok: false; error: string; latencyMs?: number | null; partial?: boolean };

interface Record_ {
  provider: string;
  providerName: string;
  feed: StatusFeed;
  state: StatusState;
  latencyMs: number | null;
  checkedAt: number | null;
  lastOkAt: number | null;
  error: string | null;
  source: StatusSource;
  failures: number;
}

export interface Registry {
  record(provider: string, feed: StatusFeed, result: CheckResult, source?: StatusSource): void;
  /** The checks in catalog order; the relay's stats override each provider's `live` check. */
  snapshot(relay?: FeedStats[]): StatusCheck[];
}

export interface RegistryOptions {
  now?: () => number;
  /** Defaults to `console.log`. */
  log?: (line: string) => void;
}

export function createRegistry(opts: RegistryOptions = {}): Registry {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.log(line));
  const names = new Map(PROVIDER_CATALOG.map((p) => [p.id, p.name]));
  const records = new Map<string, Record_>();
  const keyOf = (provider: string, feed: StatusFeed): string => `${provider}/${feed}`;
  for (const { provider, feed } of statusKeys()) {
    records.set(keyOf(provider, feed), {
      provider,
      providerName: names.get(provider) ?? provider,
      feed,
      state: 'unknown',
      latencyMs: null,
      checkedAt: null,
      lastOkAt: null,
      error: null,
      source: 'probe',
      failures: 0,
    });
  }

  const setState = (r: Record_, state: StatusState): void => {
    if (state === r.state) return;
    const old = r.state;
    r.state = state;
    const detail = [r.latencyMs === null ? null : `${r.latencyMs} ms`, state === 'ok' ? null : r.error].filter((x) => x !== null).join(', ');
    log(`[status] ${r.provider} ${r.feed} ${old} -> ${state}${detail ? ` (${detail})` : ''}`);
  };

  return {
    record(provider, feed, result, source = 'probe') {
      const r = records.get(keyOf(provider, feed));
      if (!r) return;
      r.checkedAt = now();
      r.source = source;
      r.latencyMs = result.latencyMs ?? null;
      if (result.ok) {
        r.failures = 0;
        r.lastOkAt = r.checkedAt;
        const slow = result.latencyMs > SLOW_MS;
        r.error = slow ? `slow answer (${result.latencyMs} ms)` : null;
        setState(r, slow ? 'degraded' : 'ok');
        return;
      }
      r.error = result.error;
      if (result.partial) {
        r.failures = 0;
        setState(r, 'degraded');
        return;
      }
      r.failures++;
      setState(r, r.failures >= DOWN_AFTER ? 'down' : 'degraded');
    },
    snapshot(relay = []) {
      const byProvider = new Map<string, FeedStats[]>();
      for (const s of relay) byProvider.set(s.provider, [...(byProvider.get(s.provider) ?? []), s]);
      for (const [provider, stats] of byProvider) {
        const r = records.get(keyOf(provider, 'live'));
        if (!r) continue;
        const live = stats.some((s) => s.status === 'live');
        const failing = stats.find((s) => s.status === 'error');
        const state: StatusState = live ? 'ok' : failing ? 'down' : 'degraded';
        r.checkedAt = now();
        r.source = 'relay';
        r.latencyMs = null;
        r.failures = 0;
        if (live) {
          r.lastOkAt = r.checkedAt;
          r.error = null;
        } else {
          r.error = (failing ?? stats.find((s) => s.lastError) ?? stats[0]).lastError;
        }
        setState(r, state);
      }
      return [...records.values()].map(({ failures: _failures, ...check }) => ({ ...check }));
    },
  };
}
