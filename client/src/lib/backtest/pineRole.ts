/**
 * TradingView indicator roles for the Composed strategy: a stored Pine indicator can be the entry rule, a filter, the stop or the target.
 * The indicator runs once (async) before the signals are built; the Composed code then reads the mapped plots
 * synchronously, bar for bar, through a `PineRoleContext`.
 */
import type { Candle } from '../../types';
import { convertToV6 } from '../pine/convert';
import { runPine, type PineEnv } from '../pine/runtime';
import type { PineInputValue, PineMarket, PinePlot, PineRunOutcome } from '../pine/types';
import { detectPineVersion } from '../pine/version';
import type { Signal } from './types';

/** What a rule compares: a plot by title, the bar's close, or a fixed level. */
export type PineOperand = { kind: 'plot'; plot: string } | { kind: 'close' } | { kind: 'level'; value: number };

export type PineRule =
  | { type: 'cross'; a: PineOperand; b: PineOperand }
  | { type: 'shape'; long?: string; short?: string }
  | { type: 'above'; a: PineOperand; b: PineOperand }
  | { type: 'below'; a: PineOperand; b: PineOperand }
  | { type: 'inside'; a: PineOperand; lo: PineOperand; hi: PineOperand }
  /** A stop or target role: the price level is the value of one line plot, by title. */
  | { type: 'level'; plot: string };

export type PineRoleLabel = 'trend' | 'volume' | 'volatility' | 'strength' | 'custom';

export type PineRoleKind = 'entry' | 'filter' | 'stop' | 'target';
export type PineStopMode = 'at-entry' | 'trailing';

export interface PineRole {
  /** The stored indicator's scriptId. */
  indicatorId: string;
  /** Shown in messages and labels. */
  name: string;
  /** Attached only when a run is requested, never saved. */
  source?: string;
  inputs: Record<string, PineInputValue>;
  role: PineRoleKind;
  /** A stop role only: fixed at the entry bar's level, or following the plot bar by bar. Absent reads as at-entry. */
  mode?: PineStopMode;
  label?: PineRoleLabel;
  rule: PineRule;
}

export const MAX_FILTER_ROLES = 4;
const LABELS: readonly string[] = ['trend', 'volume', 'volatility', 'strength', 'custom'];

/** A resolved entry: the exposure for a direction (1 long only, 2 short only, 3 both). */
export interface ResolvedEntry {
  name: string;
  signals(direction: number): Signal[];
}

export interface ResolvedFilter {
  name: string;
  label: string;
  /** Whether the bar passes for a side; null while a mapped plot has no value. */
  check(i: number, side: 1 | -1): boolean | null;
}

/** The computed indicator values a run needs, per role. */
export interface PineRoleContext {
  entry?: ResolvedEntry;
  filters: ResolvedFilter[];
  /** The stop plot's values, aligned to the candles (na and non-finite as null). */
  stop?: { name: string; plot: string; mode: PineStopMode; values: Array<number | null> };
  /** The target plot's values, aligned to the candles. */
  target?: { name: string; plot: string; values: Array<number | null> };
}

/* ------------------------------ validation ------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseOperand(v: unknown): PineOperand | null {
  if (!isObj(v)) return null;
  if (v.kind === 'close') return { kind: 'close' };
  if (v.kind === 'plot') return typeof v.plot === 'string' && v.plot !== '' ? { kind: 'plot', plot: v.plot } : null;
  if (v.kind === 'level') return typeof v.value === 'number' && Number.isFinite(v.value) ? { kind: 'level', value: v.value } : null;
  return null;
}

function parseRule(role: PineRoleKind, v: unknown): PineRule | null {
  if (!isObj(v)) return null;
  if (role === 'stop' || role === 'target') {
    return v.type === 'level' && typeof v.plot === 'string' && v.plot !== '' ? { type: 'level', plot: v.plot } : null;
  }
  if (role === 'entry') {
    if (v.type === 'cross') {
      const a = parseOperand(v.a);
      const b = parseOperand(v.b);
      return a && b ? { type: 'cross', a, b } : null;
    }
    if (v.type === 'shape') {
      const ok = (x: unknown) => x === undefined || (typeof x === 'string' && x !== '');
      if (!ok(v.long) || !ok(v.short) || (v.long === undefined && v.short === undefined)) return null;
      return { type: 'shape', ...(v.long !== undefined && { long: v.long as string }), ...(v.short !== undefined && { short: v.short as string }) };
    }
    return null;
  }
  if (v.type === 'above' || v.type === 'below') {
    const a = parseOperand(v.a);
    const b = parseOperand(v.b);
    return a && b ? { type: v.type, a, b } : null;
  }
  if (v.type === 'inside') {
    const a = parseOperand(v.a);
    const lo = parseOperand(v.lo);
    const hi = parseOperand(v.hi);
    return a && lo && hi ? { type: 'inside', a, lo, hi } : null;
  }
  return null;
}

/** One role, or null when it is malformed. Unknown fields are dropped. */
export function parsePineRole(v: unknown): PineRole | null {
  if (!isObj(v)) return null;
  if (typeof v.indicatorId !== 'string' || v.indicatorId === '' || typeof v.name !== 'string') return null;
  if (v.role !== 'entry' && v.role !== 'filter' && v.role !== 'stop' && v.role !== 'target') return null;
  if (!isObj(v.inputs)) return null;
  const inputs: Record<string, PineInputValue> = {};
  for (const [k, x] of Object.entries(v.inputs)) {
    if (typeof x === 'number' ? !Number.isFinite(x) : typeof x !== 'boolean' && typeof x !== 'string') return null;
    inputs[k] = x as PineInputValue;
  }
  if (v.label !== undefined && !(typeof v.label === 'string' && LABELS.includes(v.label))) return null;
  if (v.mode !== undefined && v.mode !== 'at-entry' && v.mode !== 'trailing') return null;
  const rule = parseRule(v.role, v.rule);
  if (!rule) return null;
  return {
    indicatorId: v.indicatorId,
    name: v.name,
    ...(typeof v.source === 'string' && { source: v.source }),
    inputs,
    role: v.role,
    ...(v.role === 'stop' && v.mode !== undefined && { mode: v.mode as PineStopMode }),
    ...(v.label !== undefined && { label: v.label as PineRoleLabel }),
    rule,
  };
}

/** Roles from saved prefs: malformed ones are dropped, as are those past the limits. */
export function sanitizePineRoles(raw: unknown): PineRole[] {
  if (!Array.isArray(raw)) return [];
  const out: PineRole[] = [];
  let entries = 0;
  let filters = 0;
  let stops = 0;
  let targets = 0;
  for (const r of raw) {
    const role = parsePineRole(r);
    if (!role) continue;
    if (role.role === 'entry') {
      if (entries++ >= 1) continue;
    } else if (role.role === 'stop') {
      if (stops++ >= 1) continue;
    } else if (role.role === 'target') {
      if (targets++ >= 1) continue;
    } else if (filters++ >= MAX_FILTER_ROLES) continue;
    out.push(role);
  }
  return out;
}

/** Roles for a run: throws a plain message on anything malformed or over the limits. */
export function validatePineRoles(raw: unknown): PineRole[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('The TradingView indicator roles are malformed.');
  const roles = raw.map((r) => {
    const role = parsePineRole(r);
    if (!role) throw new Error(`A TradingView indicator role is malformed${isObj(r) && typeof r.name === 'string' ? ` (${r.name})` : ''}.`);
    return role;
  });
  if (roles.filter((r) => r.role === 'entry').length > 1) throw new Error('Composed takes at most one TradingView indicator entry rule.');
  if (roles.filter((r) => r.role === 'filter').length > MAX_FILTER_ROLES) {
    throw new Error(`Composed takes at most ${MAX_FILTER_ROLES} TradingView indicator filters.`);
  }
  if (roles.filter((r) => r.role === 'stop').length > 1) throw new Error('Composed takes at most one TradingView indicator stop.');
  if (roles.filter((r) => r.role === 'target').length > 1) throw new Error('Composed takes at most one TradingView indicator target.');
  return roles;
}

/** The roles this run reads: the entry role only counts while the entry rule is the TradingView indicator (7); filters, stop and target always count. */
export function rolesInUse(config: { strategyId: string; params?: Record<string, number>; pineRoles?: PineRole[] }): PineRole[] {
  if (config.strategyId !== 'composed' || !config.pineRoles?.length) return [];
  const rule7 = Math.round(Number(config.params?.entryRule)) === ENTRY_RULE_PINE;
  return validatePineRoles(config.pineRoles).filter((r) => r.role !== 'entry' || rule7);
}

export const ENTRY_RULE_PINE = 7;

/** The roles with their sources removed, for the saved settings and the result's `config`. */
export function withoutSources(roles: PineRole[] | undefined): PineRole[] | undefined {
  return roles?.map((r) => {
    const { source: _source, ...rest } = r;
    return rest;
  });
}

/* ------------------------------ words ------------------------------ */

const fmt = (n: number): string => String(Number(n.toFixed(4)));

function operandWords(o: PineOperand): string {
  return o.kind === 'close' ? 'close' : o.kind === 'level' ? fmt(o.value) : o.plot;
}

/** A rule in words, for example `close crosses EMA` or `RSI inside 30 to 70`. */
export function pineRuleWords(rule: PineRule): string {
  switch (rule.type) {
    case 'cross':
      return `${operandWords(rule.a)} crosses ${operandWords(rule.b)}`;
    case 'shape':
      return [rule.long !== undefined && `long shape "${rule.long}"`, rule.short !== undefined && `short shape "${rule.short}"`].filter(Boolean).join(', ');
    case 'above':
    case 'below':
      return `${operandWords(rule.a)} ${rule.type} ${operandWords(rule.b)}`;
    case 'inside':
      return `${operandWords(rule.a)} inside ${operandWords(rule.lo)} to ${operandWords(rule.hi)}`;
    case 'level':
      return `at ${rule.plot}`;
  }
}

/** A role in words: the indicator's name (and a filter's label), its rule and the input values set, for example `"My EMA" close crosses EMA, length 20` or `"Supertrend" stop at Supertrend line, trailing`. */
export function pineRoleWords(role: Omit<PineRole, 'source'>): string {
  const label = role.role === 'filter' && role.label && role.label !== 'custom' ? ` (${role.label})` : '';
  const inputs = Object.entries(role.inputs)
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k.toLowerCase()} ${typeof v === 'number' ? fmt(v) : String(v)}`);
  const kind = role.role === 'stop' ? 'stop ' : role.role === 'target' ? 'target ' : '';
  const mode = role.role === 'stop' && role.mode === 'trailing' ? ['trailing'] : [];
  return [`"${role.name}"${label} ${kind}${pineRuleWords(role.rule)}`, ...mode, ...inputs].join(', ');
}

/* ------------------------------ running ------------------------------ */

type Outcome = Promise<PineRunOutcome>;
const memo = new WeakMap<Candle[], Map<string, Outcome>>();

/** Run an indicator once per candle array, source (converted), inputs and market. */
function runOnce(candles: Candle[], source: string, inputs: Record<string, PineInputValue>, market: PineMarket | undefined, env?: PineEnv): Outcome {
  let byKey = memo.get(candles);
  if (!byKey) memo.set(candles, (byKey = new Map()));
  const key = JSON.stringify([source, Object.entries(inputs).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)), market ?? null]);
  let out = byKey.get(key);
  if (!out) {
    out = runPine(source, candles, inputs, { market, ...(env?.resolver && { resolver: env.resolver }), ...(env?.feed && { feed: env.feed }) });
    byKey.set(key, out);
  }
  return out;
}

type Series = (i: number) => number | null;

/** Run each role's indicator and map its plots; throws a plain message naming the indicator when one cannot be used. */
export async function computePineRoleContext(
  candles: Candle[],
  roles: PineRole[],
  market: PineMarket | undefined,
  env?: PineEnv,
): Promise<PineRoleContext> {
  const ctx: PineRoleContext = { filters: [] };
  for (const role of roles) {
    const label = `TradingView indicator "${role.name}"`;
    if (typeof role.source !== 'string' || role.source.trim() === '') {
      throw new Error(`${label} is no longer stored. Pick another one in the Composed settings.`);
    }
    const source = detectPineVersion(role.source).legacy ? convertToV6(role.source).code : role.source;
    const outcome = await runOnce(candles, source, role.inputs, market, env);
    if (!outcome.ok) {
      const { message, line } = outcome.error;
      throw new Error(`${label}: ${line != null && !message.includes(`${line}:`) ? `${message} (line ${line})` : message}`);
    }
    if (outcome.kind !== 'indicator') throw new Error(`${label} is a strategy script, not an indicator.`);
    const plotOf = (title: string): PinePlot => {
      const plot = outcome.plots.find((p) => p.name === title);
      if (!plot) throw new Error(`${label} has no plot titled "${title}".`);
      if (plot.values.length !== candles.length) {
        throw new Error(`${label}: plot "${title}" has ${plot.values.length} values for ${candles.length} bars.`);
      }
      return plot;
    };
    const series = (o: PineOperand): Series => {
      if (o.kind === 'close') return (i) => candles[i].close;
      if (o.kind === 'level') return () => o.value;
      const values = plotOf(o.plot).values;
      return (i) => {
        const v = values[i];
        return v == null || !Number.isFinite(v) ? null : v;
      };
    };
    const rule = role.rule;
    if (role.role === 'stop' || role.role === 'target') {
      if (rule.type !== 'level') throw new Error(`${label}: a ${role.role} needs a plot.`);
      const raw = plotOf(rule.plot).values;
      const values = Array.from(raw, (v) => (v == null || !Number.isFinite(v) ? null : v));
      if (role.role === 'stop') ctx.stop = { name: role.name, plot: rule.plot, mode: role.mode ?? 'at-entry', values };
      else ctx.target = { name: role.name, plot: rule.plot, values };
    } else if (role.role === 'entry') {
      ctx.entry = { name: role.name, signals: entrySignals(candles.length, rule, series, plotOf, label) };
    } else {
      ctx.filters.push({ name: role.name, label: role.label && role.label !== 'custom' ? `${role.name} (${role.label})` : role.name, check: filterCheck(rule, series) });
    }
  }
  return ctx;
}

/* ------------------------------ rules ------------------------------ */

function directional(level: boolean, direction: number): Signal {
  if (direction === 1) return level ? 1 : 0;
  if (direction === 2) return level ? 0 : -1;
  return level ? 1 : -1;
}

function entrySignals(n: number, rule: PineRule, series: (o: PineOperand) => Series, plotOf: (title: string) => PinePlot, label: string): (direction: number) => Signal[] {
  if (rule.type === 'cross') {
    const a = series(rule.a);
    const b = series(rule.b);
    return (direction) =>
      Array.from({ length: n }, (_, i) => {
        const x = a(i);
        const y = b(i);
        return x == null || y == null ? null : directional(x > y, direction);
      });
  }
  if (rule.type === 'shape') {
    const drawn = (title: string | undefined): ((i: number) => boolean) => {
      if (title === undefined) return () => false;
      const plot = plotOf(title);
      if (plot.kind !== 'plotshape' && plot.kind !== 'plotarrow') throw new Error(`${label}: plot "${title}" is not a plotshape or plotarrow.`);
      const values = plot.values;
      return (i) => values[i] != null && values[i] !== 0;
    };
    const long = drawn(rule.long);
    const short = drawn(rule.short);
    return (direction) => {
      const out: Signal[] = new Array(n);
      let side: 0 | 1 | -1 = 0;
      for (let i = 0; i < n; i++) {
        const l = long(i);
        const s = short(i);
        if (l && !s) side = 1;
        else if (s && !l) side = -1;
        out[i] = side === 1 ? (direction === 2 ? 0 : 1) : side === -1 ? (direction === 1 ? 0 : -1) : 0;
      }
      return out;
    };
  }
  throw new Error('This rule cannot be an entry rule.');
}

function filterCheck(rule: PineRule, series: (o: PineOperand) => Series): ResolvedFilter['check'] {
  if (rule.type === 'above' || rule.type === 'below') {
    const a = series(rule.a);
    const b = series(rule.b);
    const aboveForLong = rule.type === 'above';
    return (i, side) => {
      const x = a(i);
      const y = b(i);
      if (x == null || y == null) return null;
      return (side === 1) === aboveForLong ? x > y : x < y;
    };
  }
  if (rule.type === 'inside') {
    const a = series(rule.a);
    const lo = series(rule.lo);
    const hi = series(rule.hi);
    return (i) => {
      const x = a(i);
      const l = lo(i);
      const h = hi(i);
      if (x == null || l == null || h == null) return null;
      return x >= Math.min(l, h) && x <= Math.max(l, h);
    };
  }
  throw new Error('This rule cannot be a filter.');
}
