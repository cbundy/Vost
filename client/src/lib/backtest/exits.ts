/**
 * Exit levels of one trade: stop loss, take profit and trailing stop, by
 * percent, ATR multiple or (take profit only) multiple of the stop.
 *
 * Pure helpers: read the settings defensively (saved settings are not
 * validated), fix a trade's levels at its entry fill, ratchet the trail after
 * each bar and test one bar against the levels. The engine owns the loop.
 */
import { ATR_TIMEFRAME_MULTIPLES } from './higherTimeframe';
import type { BacktestConfig, ExitReason } from './types';

export const DEFAULT_ATR_LENGTH = 14;

export type StopSpec = { kind: 'pct'; pct: number } | { kind: 'atr'; mult: number };
export type TargetSpec = StopSpec | { kind: 'r'; r: number };
export type TrailSpec = { kind: 'pct'; pct: number } | { kind: 'atr'; mult: number };

export interface ExitSettings {
  stop: StopSpec | null;
  target: TargetSpec | null;
  trail: TrailSpec | null;
  atrLength: number;
  /** Multiple of the loaded bar length the ATR is measured on (1 = the loaded bars). */
  atrTimeframe: number;
  /** True when any level needs the ATR of the signal bar. */
  needsAtr: boolean;
}

/**
 * Plot levels of a TradingView indicator stop and target (Composed roles), aligned to the candles. The level in force
 * on bar `i` is the value of bar `i - 1`: nothing reads the bar being simulated.
 */
export interface PlotLevels {
  stop?: { mode: 'at-entry' | 'trailing'; values: ReadonlyArray<number | null> };
  target?: { values: ReadonlyArray<number | null> };
}

/** A plot stop level the side can use: finite and on the loss side of the reference price (below for a long). */
export function usableStop(side: -1 | 1, level: number | null | undefined, ref: number): number | null {
  if (level == null || !Number.isFinite(level)) return null;
  return side === 1 ? (level < ref ? level : null) : level > ref ? level : null;
}

/** A plot target level the side can use: finite and on the profit side of the reference price (above for a long). */
export function usableTarget(side: -1 | 1, level: number | null | undefined, ref: number): number | null {
  if (level == null || !Number.isFinite(level)) return null;
  return side === 1 ? (level > ref ? level : null) : level < ref ? level : null;
}

/** Plot levels on the entry bar, from the signal bar's values; `hasStop` says a plot stop is in use (no usable level = no trade). */
export interface PlotEntry {
  hasStop: boolean;
  stop: number | null;
  target: number | null;
}

/** The plot levels in force on the entry bar `bar`: the values of the signal bar, against the entry fill. */
export function plotEntryAt(plot: PlotLevels, side: -1 | 1, fill: number, bar: number): PlotEntry {
  return {
    hasStop: plot.stop != null,
    stop: usableStop(side, plot.stop?.values[bar - 1], fill),
    target: usableTarget(side, plot.target?.values[bar - 1], fill),
  };
}

/**
 * Set the plot levels for a bar after the entry bar: a trailing stop and a target take the previous bar's plot value when
 * it is on the right side of the previous close, otherwise none. An at-entry stop stays as fixed at entry. Mutates `lv`.
 */
export function refreshPlotLevels(side: -1 | 1, lv: TradeLevels, plot: PlotLevels, bar: number, prevClose: number): void {
  if (plot.stop?.mode === 'trailing') lv.plotStop = usableStop(side, plot.stop.values[bar - 1], prevClose);
  if (plot.target) lv.plotTarget = usableTarget(side, plot.target.values[bar - 1], prevClose);
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Read the exit settings of a config; an absent, bad or unknown value reads as today's percent behaviour or off. */
export function readExitSettings(config: Partial<BacktestConfig>): ExitSettings {
  let stop: StopSpec | null = null;
  if (config.stopMode === 'atr' && positive(config.stopAtrMult)) stop = { kind: 'atr', mult: config.stopAtrMult };
  else if (config.stopLossPct != null && config.stopLossPct > 0) stop = { kind: 'pct', pct: config.stopLossPct };

  let target: TargetSpec | null = null;
  if (config.takeProfitMode === 'atr' && positive(config.takeProfitAtrMult)) target = { kind: 'atr', mult: config.takeProfitAtrMult };
  else if (config.takeProfitMode === 'r' && positive(config.takeProfitR)) target = { kind: 'r', r: config.takeProfitR }; // no stop at entry = no target
  else if (config.takeProfitPct != null && config.takeProfitPct > 0) target = { kind: 'pct', pct: config.takeProfitPct };

  let trail: TrailSpec | null = null;
  if (config.trailMode === 'pct' && positive(config.trailPct)) trail = { kind: 'pct', pct: config.trailPct };
  else if (config.trailMode === 'atr' && positive(config.trailAtrMult)) trail = { kind: 'atr', mult: config.trailAtrMult };

  const len = config.atrLength;
  const atrLength = typeof len === 'number' && Number.isInteger(len) && len >= 1 && len <= 500 ? len : DEFAULT_ATR_LENGTH;
  const needsAtr = stop?.kind === 'atr' || target?.kind === 'atr' || trail?.kind === 'atr';
  const tf = config.atrTimeframe;
  const atrTimeframe = typeof tf === 'number' && (ATR_TIMEFRAME_MULTIPLES as readonly number[]).includes(tf) ? tf : 1;
  return { stop, target, trail, atrLength, atrTimeframe, needsAtr };
}

/** The levels of one open trade. Prices are absolute; null = not set. */
export interface TradeLevels {
  stop: number | null;
  target: number | null;
  /** Current trail level (starts at entry -/+ distance, never moves back). */
  trail: number | null;
  trailDist: number | null;
  /** Best price since entry (highest high for a long, lowest low for a short). */
  best: number;
  /** Initial stop distance as a fraction of the entry price (tighter of fixed stop and trail start), for risk sizing. */
  stopFrac: number | null;
  /** The TradingView indicator stop in force on this bar (Composed stop role), or none. Absent without a role. */
  plotStop?: number | null;
  /** The TradingView indicator target in force on this bar (Composed target role), or none. Absent without a role. */
  plotTarget?: number | null;
}

/**
 * Fix the levels of a trade from its entry fill. `atrValue` is the ATR of the
 * signal bar. Returns null when a needed ATR is not known (warm-up).
 */
export function levelsAtEntry(s: ExitSettings, side: -1 | 1, entry: number, atrValue: number | null, plot?: PlotEntry): TradeLevels | null {
  if (plot?.hasStop && plot.stop == null) return null; // an indicator stop with no usable level opens no trade
  const atrOk = atrValue != null && Number.isFinite(atrValue) && atrValue > 0;
  if (s.needsAtr && !atrOk) return null;
  const atrV = atrOk ? (atrValue as number) : 0;

  let stop: number | null = null;
  let stopFrac: number | null = null;
  if (s.stop?.kind === 'pct') {
    stop = entry * (1 - (side === 1 ? s.stop.pct : -s.stop.pct) / 100);
    stopFrac = s.stop.pct / 100;
  } else if (s.stop?.kind === 'atr') {
    stop = entry - side * s.stop.mult * atrV;
    stopFrac = (s.stop.mult * atrV) / entry;
  }

  let trailDist: number | null = null;
  let trail: number | null = null;
  if (s.trail) {
    trailDist = s.trail.kind === 'pct' ? (entry * s.trail.pct) / 100 : s.trail.mult * atrV;
    trail = entry - side * trailDist;
    const tf = trailDist / entry;
    if (stopFrac == null || tf < stopFrac) stopFrac = tf;
  }

  // Stop distance in price terms, the tighter of the fixed stop and the trail start.
  let dist: number | null = null;
  if (stop != null) dist = Math.abs(entry - stop);
  if (trailDist != null && (dist == null || trailDist < dist)) dist = trailDist;
  if (plot?.stop != null) {
    const pd = Math.abs(entry - plot.stop);
    if (dist == null || pd < dist) dist = pd;
    const pf = pd / entry;
    if (stopFrac == null || pf < stopFrac) stopFrac = pf;
  }

  let target: number | null = null;
  if (s.target?.kind === 'pct') target = entry * (1 + (side === 1 ? s.target.pct : -s.target.pct) / 100);
  else if (s.target?.kind === 'atr') target = entry + side * s.target.mult * atrV;
  else if (s.target?.kind === 'r' && dist != null) target = entry + side * s.target.r * dist;

  return { stop, target, trail, trailDist, best: entry, stopFrac, ...(plot && { plotStop: plot.stop, plotTarget: plot.target }) };
}

/** The stop in force and why: the tightest of the fixed stop, the trail level and the indicator stop (a tie keeps the earlier of those). */
export function activeStop(side: -1 | 1, lv: TradeLevels): { price: number; reason: ExitReason } | null {
  const { stop, trail, plotStop } = lv;
  let best: { price: number; reason: ExitReason } | null = stop != null ? { price: stop, reason: 'stop_loss' } : null;
  const consider = (price: number | null | undefined, reason: ExitReason): void => {
    if (price == null) return;
    if (best == null || (side === 1 ? price > best.price : price < best.price)) best = { price, reason };
  };
  consider(trail, 'trailing_stop');
  consider(plotStop, 'stop_loss');
  return best;
}

/** The target in force: the nearer of the fixed target and the indicator target. */
export function activeTarget(side: -1 | 1, lv: TradeLevels): number | null {
  const { target, plotTarget } = lv;
  if (plotTarget == null) return target;
  if (target == null) return plotTarget;
  return side === 1 ? Math.min(target, plotTarget) : Math.max(target, plotTarget);
}

/** Test one bar against the trade's levels (stop first, gap-through fills at the open). */
export function hitTest(
  side: -1 | 1,
  lv: TradeLevels,
  bar: { open: number; high: number; low: number },
): { price: number; reason: ExitReason } | null {
  const st = activeStop(side, lv);
  const tp = activeTarget(side, lv);
  if (side === 1) {
    if (st && bar.low <= st.price) return { price: bar.open <= st.price ? bar.open : st.price, reason: st.reason };
    if (tp != null && bar.high >= tp) return { price: bar.open >= tp ? bar.open : tp, reason: 'take_profit' };
  } else {
    if (st && bar.high >= st.price) return { price: bar.open >= st.price ? bar.open : st.price, reason: st.reason };
    if (tp != null && bar.low <= tp) return { price: bar.open <= tp ? bar.open : tp, reason: 'take_profit' };
  }
  return null;
}

/** After a bar that did not exit: move the best price and ratchet the trail (never back). Mutates `lv`. */
export function updateTrail(side: -1 | 1, lv: TradeLevels, bar: { high: number; low: number }): void {
  if (lv.trail == null || lv.trailDist == null) return;
  if (side === 1) {
    if (bar.high > lv.best) lv.best = bar.high;
    const t = lv.best - lv.trailDist;
    if (t > lv.trail) lv.trail = t;
  } else {
    if (bar.low < lv.best) lv.best = bar.low;
    const t = lv.best + lv.trailDist;
    if (t < lv.trail) lv.trail = t;
  }
}

/** True when the config has a stop of any kind: percent, ATR or trailing. */
export function hasAnyStop(config: Partial<BacktestConfig>): boolean {
  const s = readExitSettings(config);
  return s.stop != null || s.trail != null || indicatorExits(config).stop != null;
}

/** The TradingView indicator stop and target a Composed config names (read defensively; saved settings are not validated). */
export function indicatorExits(config: Partial<BacktestConfig>): { stop: { name: string; plot: string; trailing: boolean } | null; target: { name: string; plot: string } | null } {
  const out: ReturnType<typeof indicatorExits> = { stop: null, target: null };
  if (config.strategyId !== 'composed' || !Array.isArray(config.pineRoles)) return out;
  for (const r of config.pineRoles) {
    const rule = r?.rule;
    if (!rule || rule.type !== 'level' || typeof rule.plot !== 'string' || typeof r.name !== 'string') continue;
    if (r.role === 'stop' && !out.stop) out.stop = { name: r.name, plot: rule.plot, trailing: r.mode === 'trailing' };
    else if (r.role === 'target' && !out.target) out.target = { name: r.name, plot: rule.plot };
  }
  return out;
}

/** The message shown when a take profit in R has no stop. */
export const R_NEEDS_STOP = 'A take profit in times the stop needs a stop loss or a trailing stop';

/** True when the take profit is a multiple of the stop and there is no stop to multiply. */
export function rTargetNeedsStop(config: Partial<BacktestConfig>): boolean {
  return readExitSettings(config).target?.kind === 'r' && !hasAnyStop(config);
}

/** Short labels for the modes in use, e.g. `SL 2 ATR`, `TP 3R`, `Trail 1.5 ATR`. */
export function exitModeLabels(config: Partial<BacktestConfig>): {
  stop: string | null;
  target: string | null;
  trail: string | null;
  atrLength: number | null;
  atrTimeframe: number | null;
  /** A TradingView indicator stop or target, for example `Trail Supertrend Line` or `TP Pivot R1`; present only with one. */
  indicatorStop?: string;
  indicatorTarget?: string;
} {
  const s = readExitSettings(config);
  const ind = indicatorExits(config);
  const num = (n: number): string => String(Number(n.toFixed(4)));
  return {
    stop: s.stop ? (s.stop.kind === 'atr' ? `SL ${num(s.stop.mult)} ATR` : `SL ${num(s.stop.pct)}%`) : null,
    target: s.target ? (s.target.kind === 'atr' ? `TP ${num(s.target.mult)} ATR` : s.target.kind === 'r' ? `TP ${num(s.target.r)}R` : `TP ${num(s.target.pct)}%`) : null,
    trail: s.trail ? (s.trail.kind === 'atr' ? `Trail ${num(s.trail.mult)} ATR` : `Trail ${num(s.trail.pct)}%`) : null,
    atrLength: s.needsAtr ? s.atrLength : null,
    atrTimeframe: s.needsAtr && s.atrTimeframe > 1 ? s.atrTimeframe : null,
    ...(ind.stop && { indicatorStop: `${ind.stop.trailing ? 'Trail' : 'SL'} ${ind.stop.name} ${ind.stop.plot}` }),
    ...(ind.target && { indicatorTarget: `TP ${ind.target.name} ${ind.target.plot}` }),
  };
}

/** The volatility exits of a run for the optimizer file's context: only the ATR, R and trailing ones (the percent ones have their own lines). */
export interface ExitContext {
  stopLoss?: string;
  takeProfit?: string;
  trailingStop?: string;
  /** A TradingView indicator stop: `Supertrend Line, trailing` or `Supertrend Line, fixed at entry`. */
  indicatorStop?: string;
  indicatorTarget?: string;
  atrLength?: number;
  atrTimeframe?: number;
}

export function exitContext(config: Partial<BacktestConfig>): { exits?: ExitContext } {
  const s = readExitSettings(config);
  const out: ExitContext = {};
  if (s.stop?.kind === 'atr') out.stopLoss = `${s.stop.mult} x ATR`;
  if (s.target?.kind === 'atr') out.takeProfit = `${s.target.mult} x ATR`;
  if (s.target?.kind === 'r') out.takeProfit = `${s.target.r} x stop`;
  if (s.trail) out.trailingStop = s.trail.kind === 'atr' ? `${s.trail.mult} x ATR` : `${s.trail.pct}%`;
  const ind = indicatorExits(config);
  if (ind.stop) out.indicatorStop = `${ind.stop.name} ${ind.stop.plot}, ${ind.stop.trailing ? 'trailing' : 'fixed at entry'}`;
  if (ind.target) out.indicatorTarget = `${ind.target.name} ${ind.target.plot}`;
  if (Object.keys(out).length === 0) return {};
  if (s.needsAtr) out.atrLength = s.atrLength;
  if (s.needsAtr && s.atrTimeframe > 1) out.atrTimeframe = s.atrTimeframe;
  return { exits: out };
}
