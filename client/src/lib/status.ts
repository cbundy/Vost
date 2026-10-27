/**
 * Connection status, client side: fetch `/api/status`, and the pure helpers
 * the top-bar indicator needs (worst state, problem count, server-down view).
 */
import type { ApiError } from '../../../shared/market.ts';
import type { StatusCheck, StatusResponse, StatusState } from '../../../shared/status.ts';

export type { StatusCheck, StatusFeed, StatusState } from '../../../shared/status.ts';

/** What the indicator shows: the server's answer, or the last known rows when the server cannot be reached. */
export interface StatusView {
  server: { state: 'ok' | 'down'; version: string | null; uptimeSeconds: number | null };
  intervalSeconds: number;
  checks: StatusCheck[];
}

export async function fetchStatus(signal?: AbortSignal, refresh = false): Promise<StatusResponse> {
  const res = await fetch(`/api/status${refresh ? '?refresh=1' : ''}`, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Partial<ApiError> | null;
    throw new Error(typeof body?.error === 'string' && body.error ? body.error : `HTTP ${res.status}`);
  }
  return (await res.json()) as StatusResponse;
}

export function viewOf(res: StatusResponse): StatusView {
  return { server: { state: 'ok', version: res.server.version, uptimeSeconds: res.server.uptimeSeconds }, intervalSeconds: res.intervalSeconds, checks: res.checks };
}

/** The Vost server could not be reached: it is down and nothing is known about the exchanges (rows are kept). */
export function serverDown(previous: StatusView | null): StatusView {
  return {
    server: { state: 'down', version: previous?.server.version ?? null, uptimeSeconds: null },
    intervalSeconds: previous?.intervalSeconds ?? 60,
    checks: (previous?.checks ?? []).map((c) => ({ ...c, state: 'unknown' as const })),
  };
}

const SEVERITY: Record<StatusState, number> = { ok: 0, unknown: 1, degraded: 2, down: 3 };

/** The worst of the server and every check: down > degraded > unknown > ok. */
export function worstState(view: StatusView | null): StatusState {
  if (!view) return 'unknown';
  let worst: StatusState = view.server.state;
  for (const c of view.checks) if (SEVERITY[c.state] > SEVERITY[worst]) worst = c.state;
  return worst;
}

/** How many checks are not `ok`. */
export function problemCount(view: StatusView | null): number {
  return view ? view.checks.filter((c) => c.state !== 'ok').length : 0;
}

/** "All connections ok" / "Connections: 2 problems" (also for the title and aria-label). */
export function summaryText(view: StatusView | null): string {
  if (!view) return 'Connections: checking';
  const n = problemCount(view);
  if (view.server.state === 'down') return `Vost server unreachable${n > 0 ? ` - Connections: ${n} ${n === 1 ? 'problem' : 'problems'}` : ''}`;
  if (n === 0) return 'All connections ok';
  return `Connections: ${n} ${n === 1 ? 'problem' : 'problems'}`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** Checks grouped by provider, in the order the server sent them. */
export function groupByProvider(checks: StatusCheck[]): Array<{ provider: string; providerName: string; checks: StatusCheck[] }> {
  const groups = new Map<string, { provider: string; providerName: string; checks: StatusCheck[] }>();
  for (const c of checks) {
    const g = groups.get(c.provider) ?? { provider: c.provider, providerName: c.providerName, checks: [] };
    g.checks.push(c);
    groups.set(c.provider, g);
  }
  return [...groups.values()];
}

/** "45 s", "12 min", "3 h", "2 d". */
export function uptimeText(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
}
