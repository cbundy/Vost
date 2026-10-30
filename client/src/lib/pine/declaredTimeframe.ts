/**
 * An indicator that declares its own timeframe (`indicator("x", timeframe="D")`) runs on that timeframe's bars and
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
}

/** Seconds in a Pine timeframe string, or null for one that is not a timeframe. */
function timeframeSeconds(tf: string): number | null {
  const m = /^(\d*)([SDWM]?)$/i.exec(tf.trim());
  if (!m || !(m[1] || m[2])) return null;
  const n = Number(m[1] || 1);
  const unit = m[2].toUpperCase();
  return n * (unit === 'S' ? 1 : unit === 'D' ? 86400 : unit === 'W' ? 604800 : unit === 'M' ? 2592000 : 60);
}

/** The timeframe the indicator declares, or null when it declares none or the chart's own. */
export function readDeclaredTimeframe(indicator: Indicator, chartTf: string): DeclaredTimeframe | null {
  const prop = (indicator as any).prop;
  const tf = prop?.timeframe;
  if (typeof tf !== 'string' || tf.trim() === '') return null;
  if (normalizeTimeframe(tf) === normalizeTimeframe(chartTf)) return null;
  const a = timeframeSeconds(tf);
  if (a !== null && a === timeframeSeconds(chartTf)) return null;
  return { timeframe: tf.trim(), gaps: prop.timeframe_gaps !== false };
}

const lead = (declared: DeclaredTimeframe) => `indicator(timeframe="${declared.timeframe}")`;

/** Why the declared timeframe cannot run on the chart, or null. */
export function checkDeclaredTimeframe(declared: DeclaredTimeframe, chartTf: string, market: PineMarket | undefined): string | null {
  const head = `${lead(declared)} cannot run on a ${chartTf} chart: `;
  const want = timeframeSeconds(declared.timeframe);
  const have = timeframeSeconds(chartTf);
  if (want === null || !vostInterval(declared.timeframe)) return `${head}Vost has no bars for that timeframe`;
  if (have !== null && want < have) return `${head}Vost runs a script only on the chart's timeframe or a higher one`;
  if (!market) return `${head}the run has no market to load bars from`;
  return null;
}

export interface DeclaredRun {
  provider: IProvider;
  /** The bars the declared timeframe runs on, loaded once and shared with the run. */
  load(): Promise<HigherKline[]>;
}

/** Wraps the provider so the bars of the declared timeframe load once, are kept, and fail with a message that names the declaration. */
export function wrapProvider(provider: IProvider, ticker: string, declared: DeclaredTimeframe, chartTf: string): DeclaredRun {
  let loaded: Promise<HigherKline[]> | null = null;
  const own = (t: string) => { const u = t.toUpperCase(); const k = ticker.toUpperCase(); return u === k || u.endsWith(`:${k}`); };
  const fetchBars = (tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number) => {
    loaded ??= provider.getMarketData(tickerId, timeframe, limit, sDate, eDate).catch((e) => {
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
    const data: any[] = [];
    for (const p of plot.data) {
      const i = byOpen.get(p.time);
      if (i === undefined) continue;
      const [from, to] = span(i);
      for (let c = from; c <= to; c++) data.push({ ...p, time: candles[c].time * 1000 });
    }
    out[key] = { ...plot, data };
  }
  return { plots: out, times: at.map((c, i) => candles[Math.max(c, 0)].time) };
}
