/**
 * An indicator that declares its own timeframe (or has one set in its Calculation settings) (`indicator("x", timeframe="D")`) runs on that timeframe's bars and
 * shows its values on the chart's bars. The bars are the ones `request.security` gets (finished bars plus the forming
 * bar rebuilt from the chart's candles), so a script never sees a higher bar's final close before the bar ends.
 */
import type { IProvider } from 'pinets';
import type { Indicator } from 'pinets';
import type { Candle } from '../../types';
import { normalizeTimeframe, vostInterval } from './market';
import type { PineMarket } from './types';

export type HigherKline = Awaited<ReturnType<IProvider['getMarketData']>>[number];

export interface DeclaredTimeframe {
  timeframe: string;
  /** `timeframe_gaps`: true (the default) shows a higher bar's value only on its chart bar. */
  gaps: boolean;
  /** True when the timeframe comes from the Calculation setting, not the script. */
  fromSetting?: boolean;
}

/** Seconds in a Pine timeframe string, or null for one that is not a timeframe. */
function timeframeSeconds(tf: string): number | null {
  const m = /^(\d*)([SDWM]?)$/i.exec(tf.trim());
  if (!m || !(m[1] || m[2])) return null;
  const n = Number(m[1] || 1);
  const unit = m[2].toUpperCase();
  return n * (unit === 'S' ? 1 : unit === 'D' ? 86400 : unit === 'W' ? 604800 : unit === 'M' ? 2592000 : 60);
}

/**
 * True when the first `indicator(...)` call passes a top-level `timeframe=` named argument (any value, `""` too).
 * Strings, comments and nested calls are skipped; `timeframe_gaps=` alone does not count.
 */
export function declaresTimeframe(source: string): boolean {
  const start = findIndicatorCall(source);
  if (start < 0) return false;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") { i = skipString(source, i); continue; }
    if (ch === '/' && source[i + 1] === '/') { i = skipLine(source, i); continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) return false; }
    else if (depth === 1 && ch === 't' && /^timeframe\s*=(?!=)/.test(source.slice(i, i + 40)) && !/[\w.]/.test(source[i - 1] ?? '')) return true;
  }
  return false;
}

/** Index of the `(` of the first `indicator(` call outside strings and comments, or -1. */
function findIndicatorCall(source: string): number {
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") { i = skipString(source, i); continue; }
    if (ch === '/' && source[i + 1] === '/') { i = skipLine(source, i); continue; }
    if (ch === 'i' && !/[\w.]/.test(source[i - 1] ?? '')) {
      const m = /^indicator\s*\(/.exec(source.slice(i, i + 40));
      if (m) return i + m[0].length - 1;
    }
  }
  return -1;
}

function skipString(source: string, at: number): number {
  const q = source[at];
  let i = at + 1;
  while (i < source.length && source[i] !== q && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
  return i;
}

function skipLine(source: string, at: number): number {
  const nl = source.indexOf('\n', at);
  return nl < 0 ? source.length : nl;
}

/** The user's overrides of the declared timeframe (`""` = the chart). */
export interface CalculationOverride { timeframe?: string; gaps?: boolean }

/**
 * The timeframe the indicator runs on, or null when it declares none, is not supported, or it is the chart's own.
 * The script's own timeframe and gaps apply unless the override sets them.
 */
export function readDeclaredTimeframe(
  indicator: Indicator,
  chartTf: string,
  supports: boolean,
  override?: CalculationOverride,
): DeclaredTimeframe | null {
  if (!supports) return null;
  const prop = (indicator as any).prop;
  const own = typeof prop?.timeframe === 'string' ? prop.timeframe : '';
  const fromSetting = typeof override?.timeframe === 'string';
  const tf = (fromSetting ? override!.timeframe! : own).trim();
  if (tf === '') return null;
  if (normalizeTimeframe(tf) === normalizeTimeframe(chartTf)) return null;
  const a = timeframeSeconds(tf);
  if (a !== null && a === timeframeSeconds(chartTf)) return null;
  const gaps = typeof override?.gaps === 'boolean' ? override.gaps : prop?.timeframe_gaps !== false;
  return { timeframe: tf, gaps, fromSetting };
}

/** The script's own declared calculation values. */
export function declaredCalculation(indicator: Indicator): { timeframe: string; gaps: boolean } {
  const prop = (indicator as any).prop;
  return { timeframe: typeof prop?.timeframe === 'string' ? prop.timeframe : '', gaps: prop?.timeframe_gaps !== false };
}

const lead = (declared: DeclaredTimeframe) => (declared.fromSetting ? `Calculation timeframe ${declared.timeframe}` : `indicator(timeframe="${declared.timeframe}")`);

/** Why the declared timeframe cannot run on the chart, or null. */
export function checkDeclaredTimeframe(declared: DeclaredTimeframe, chartTf: string, market: PineMarket | undefined): string | null {
  const head = `${lead(declared)} cannot run on a ${chartTf} chart: `;
  if (timeframeSeconds(declared.timeframe) === null || !vostInterval(declared.timeframe)) return `${head}Vost has no bars for that timeframe`;
  if (!market) return `${head}the run has no market to load bars from`;
  return null;
}

export interface DeclaredRun {
  provider: IProvider;
  /** The bars the declared timeframe runs on, loaded once and shared with the run. */
  load(): Promise<HigherKline[]>;
}

/**
 * Wraps the provider so the bars of the declared timeframe load once, are kept, and fail with a message that names the declaration.
 * With `finishedBy` (the run's end time) the script runs only on bars that closed by then: the forming bar, which the run would
 * otherwise show on the live chart bar and later replace, is left out.
 */
export function wrapProvider(provider: IProvider, ticker: string, declared: DeclaredTimeframe, chartTf: string, finishedBy?: number): DeclaredRun {
  let loaded: Promise<HigherKline[]> | null = null;
  const own = (t: string) => { const u = t.toUpperCase(); const k = ticker.toUpperCase(); return u === k || u.endsWith(`:${k}`); };
  const fetchBars = (tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number) => {
    loaded ??= provider.getMarketData(tickerId, timeframe, limit, sDate, eDate).then((bars) => (finishedBy === undefined ? bars : bars.filter((k) => k.closeTime <= finishedBy))).catch((e) => {
      const msg = (e instanceof Error ? e.message : String(e)).replace(/^request\.security\([^)]*\):\s*/, '');
      throw new Error(`${lead(declared)} cannot run on a ${chartTf} chart: ${msg}`);
    });
    return loaded;
  };
  return {
    load: () => fetchBars(ticker, declared.timeframe),
    provider: {
      ...provider,
      getMarketData(tickerId, timeframe, limit, sDate, eDate) {
        if (own(tickerId) && normalizeTimeframe(timeframe) === normalizeTimeframe(declared.timeframe)) return fetchBars(tickerId, timeframe, limit, sDate, eDate);
        return provider.getMarketData(tickerId, timeframe, limit, sDate, eDate);
      },
      getSymbolInfo: (t) => provider.getSymbolInfo(t),
      configure: (...a: any[]) => (provider.configure as any)(...a),
    } as IProvider,
  };
}

export interface Remapped {
  plots: Record<string, any>;
  /** The chart time (seconds) of each higher bar's chart bar, for placing drawings by bar index. */
  times: number[];
}

/**
 * Moves every plot point from its higher bar's open to the chart bar it belongs to: the last chart bar whose open is
 * at or before the higher bar's close time. Without gaps the point holds on every chart bar up to the next one's.
 */
export function remapToChart(plots: Record<string, any>, higher: readonly HigherKline[], candles: readonly Candle[], gaps: boolean): Remapped {
  const chartIndex = (closeMs: number): number => {
    let lo = 0;
    let hi = candles.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].time * 1000 <= closeMs) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  };
  const at = higher.map((k) => chartIndex(k.closeTime));
  const byOpen = new Map<number, number>();
  higher.forEach((k, i) => byOpen.set(k.openTime, i));
  /** Chart bars a higher bar covers: its own, plus up to the next higher bar's without gaps. */
  const span = (i: number): [number, number] => {
    const from = at[i];
    if (from < 0) return [0, -1];
    if (gaps) return [from, from];
    let next = candles.length;
    for (let j = i + 1; j < higher.length; j++) if (at[j] > from) { next = at[j]; break; }
    return [from, next - 1];
  };
  const out: Record<string, any> = {};
  for (const [key, plot] of Object.entries(plots)) {
    if (key.startsWith('__') || !plot || !Array.isArray(plot.data)) { out[key] = plot; continue; }
    // Several lower bars can land on one chart bar: the last one's point stays.
    const byChart = new Map<number, any>();
    for (const p of plot.data) {
      const i = byOpen.get(p.time);
      if (i === undefined) continue;
      const [from, to] = span(i);
      for (let c = from; c <= to; c++) byChart.set(c, { ...p, time: candles[c].time * 1000 });
    }
    const data = [...byChart.values()];
    out[key] = { ...plot, data };
  }
  return { plots: out, times: at.map((c, i) => candles[Math.max(c, 0)].time) };
}
