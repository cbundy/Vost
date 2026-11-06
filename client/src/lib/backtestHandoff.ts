/**
 * The hand-off from the strategy maker to the main Backtest tab. It travels in the URL fragment of the
 * new tab (`#backtest=<base64url JSON>`), so the strategy maker never writes storage and the main app
 * never imports the strategy maker. Only built-in signal strategies can be handed over.
 */
import { getStrategy, strategies } from './backtest/strategies';

export interface Handoff {
  v: 1;
  strategyId: string;
  params: Record<string, number>;
  feeBps: number;
  slippageBps: number;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  allowShort: boolean;
  initialCapital: number;
  positionSizePct: number;
  /** Risk sizing: percent of equity lost at the stop. Written only when set. */
  riskPct?: number;
  /** The strategy maker's label for the data it was found on. */
  source: string;
}

export const HANDOFF_PREFIX = '#backtest=';

const MAX_SOURCE = 200;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeHandoff(h: Handoff): string {
  return HANDOFF_PREFIX + toBase64Url(JSON.stringify(h));
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A built-in signal strategy: not `pine`, not `custom`, not the benchmark without parameters. */
function handoffStrategy(id: unknown) {
  if (typeof id !== 'string') return null;
  const s = strategies.find((x) => x.id === id);
  return s && !s.pine && !s.custom ? getStrategy(id) : null;
}

/** For example `fast 8, slow 34, long only`, for a toast. */
export function handoffSettingsText(h: Pick<Handoff, 'strategyId' | 'params'>): string {
  const specs = getStrategy(h.strategyId).params;
  return specs
    .filter((p) => p.key in h.params)
    .map((p) => {
      const v = h.params[p.key];
      const opt = p.type === 'select' ? p.options?.find((o) => o.value === v)?.label : undefined;
      return `${p.label.toLowerCase()} ${opt ? opt.toLowerCase() : v}`;
    })
    .join(', ');
}

/** The hand-off in a URL fragment, or null when it is not a valid one. */
export function parseHandoff(hash: string): Handoff | null {
  if (!hash.startsWith(HANDOFF_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(hash.slice(HANDOFF_PREFIX.length)));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const strategy = handoffStrategy(r.strategyId);
  if (!strategy) return null;
  if (typeof r.params !== 'object' || r.params === null || Array.isArray(r.params)) return null;
  const given = r.params as Record<string, unknown>;
  const params: Record<string, number> = {};
  for (const spec of strategy.params) {
    if (!(spec.key in given)) continue;
    const v = given[spec.key];
    if (!isNum(v)) return null;
    params[spec.key] = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, v));
  }
  const { feeBps, slippageBps, initialCapital, positionSizePct, stopLossPct, takeProfitPct } = r;
  if (!isNum(feeBps) || feeBps < 0 || !isNum(slippageBps) || slippageBps < 0) return null;
  if (!isNum(initialCapital) || initialCapital < 1) return null;
  if (!isNum(positionSizePct) || positionSizePct < 1 || positionSizePct > 100) return null;
  for (const v of [stopLossPct, takeProfitPct]) if (v !== null && (!isNum(v) || v <= 0)) return null;
  if (typeof r.allowShort !== 'boolean') return null;
  if (r.riskPct !== undefined && (!isNum(r.riskPct) || r.riskPct <= 0 || r.riskPct > 100)) return null;
  return {
    v: 1,
    strategyId: strategy.id,
    params,
    feeBps,
    slippageBps,
    stopLossPct: stopLossPct as number | null,
    takeProfitPct: takeProfitPct as number | null,
    allowShort: r.allowShort,
    initialCapital,
    positionSizePct,
    ...(r.riskPct !== undefined && { riskPct: r.riskPct as number }),
    source: typeof r.source === 'string' ? r.source.slice(0, MAX_SOURCE) : '',
  };
}

/**
 * Start-up: when the URL fragment is a hand-off, remove it (so a reload or a second effect run applies
 * nothing) and return it. `null` when there is no hand-off (any other fragment is left alone);
 * `{ handoff: null }` when there was one that cannot be read.
 */
export function takeBacktestHandoff(): { handoff: Handoff | null } | null {
  if (typeof location === 'undefined' || !location.hash.startsWith(HANDOFF_PREFIX)) return null;
  const hash = location.hash;
  history.replaceState(history.state, '', location.pathname + location.search);
  return { handoff: parseHandoff(hash) };
}
