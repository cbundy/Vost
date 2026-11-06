/**
 * The market search: for each market and timeframe, tries every signal setting with every exit on the first 70% of the
 * bars, and checks each strategy that meets a target set on the last 30%. Pure: candles come from `load`.
 */
import { MAX_BARS, type Interval } from '../../../../shared/market.ts';
import { runBacktest } from '../../lib/backtest/engine';
import { barsSpanSeconds, signalRates } from '../../lib/backtest/metrics';
import type { EngineOutput } from '../../lib/backtest/engine';
import type { SweepParam } from '../../lib/backtest/optimizer';
import type { Candle } from '../../types';
import { buildSignals } from '../../lib/backtest/strategies';
import { defaultBacktestConfig, type BacktestConfig } from '../../lib/backtest/types';
import { gapSize, gapsOf } from '../engine/backtest';
import { candidatesOf, DEFAULT_SPACE, SELECTION_PCT } from '../engine/search';
import { SIGNAL_FAMILIES, type Gap } from '../engine/types';
import { composedCount, composedSettings, COMPOSED_ENTRY_RULES, COMPOSED_FILTERS, COMPOSED_TREND_TFS } from './composedSpace';
import { shuffledCopy, seedOf } from './shuffle';
import { exitCount, exitFields, exitsOf, typicalRangePct, DEFAULT_EXITS } from './exits';
import type {
  BeatBuyHold,
  ClosestCandidate,
  PartFigures,
  SkippedSeries,
  SweepCandidate,
  SweepInput,
  SweepLoad,
  SweepMarket,
  SweepProgress,
  SweepExit,
  SweepResult,
  SweepRisk,
} from './types';

/** Fewest trades on the searched part for a strategy to count as meeting a set. */
export const MIN_SELECTION_TRADES = 30;
/** Fewest trades on the hold-out for a strategy to count as held. */
export const MIN_HELD_TRADES = 10;
/** Most combinations one run may try. */
export const MAX_SWEEP_COMBOS = 2_000_000;
/** Candle loads in flight at once. */
export const MAX_LOADS = 3;
/** Most strategies kept per market and timeframe (the counts still cover all). */
export const KEEP_PER_SERIES = 200;
/** Longest the engine runs before it gives the thread back (so a cancel is heard). */
const SLICE_MS = 40;

export const DEFAULT_SWEEP_INPUT: Omit<SweepInput, 'markets'> = {
  timeframes: ["1d", "1w"],
  families: ['macd_cross', 'sma_cross', 'ema_cross'],
  direction: 'long',
  targetSets: [
    { minHitRatePct: 75, minRR: 1 },
    { minHitRatePct: 50, minRR: 4 },
  ],
  risk: { initialCapital: 1000, riskPct: 2, feeBps: 10, slippageBps: 5 },
  exits: DEFAULT_EXITS,
};

const abortError = (): Error => new DOMException('The search was cancelled', 'AbortError');
const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The config of one backtest: risk-sized from the exit's stop, with no position cap. */
export function sweepConfig(
  risk: SweepRisk,
  strategyId: string,
  params: Record<string, number>,
  exit: SweepExit,
): BacktestConfig {
  return {
    ...defaultBacktestConfig(),
    allowShort: (params.direction ?? 1) !== 1,
    strategyId,
    params,
    initialCapital: risk.initialCapital,
    riskPct: risk.riskPct,
    feeBps: risk.feeBps,
    slippageBps: risk.slippageBps,
    ...exit.config,
  };
}

/** Hit rate and R:R as `runParts` computes them; drawdown positive. */
export function figuresOf(out: EngineOutput, initialCapital: number): PartFigures {
  const trades = out.trades;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0) / losses.length) : 0;
  let dd = 0;
  for (const p of out.equity) dd = Math.max(dd, -p.drawdownPct);
  const finalEquity = out.equity.length ? out.equity[out.equity.length - 1].equity : initialCapital;
  return {
    trades: trades.length,
    signalsFired: out.signalsFired,
    ...signalRates(out.signalsFired, out.equity.length, barsSpanSeconds(out.equity)),
    totalReturnPct: initialCapital > 0 ? (finalEquity / initialCapital - 1) * 100 : 0,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : null,
    rr: avgLoss > 0 ? avgWin / avgLoss : null,
    maxDrawdownPct: dd,
    finalEquity,
  };
}

interface Setting {
  strategyId: string;
  params: Record<string, number>;
}

/** The settings of the plain families (the same on every timeframe). */
function baseSettingsOf(input: SweepInput): Setting[] {
  const direction = { long: 1, short: 2, both: 3 }[input.direction];
  const out: Setting[] = [];
  for (const id of new Set(input.families)) {
    const sweeps: SweepParam[] = input.space?.[id] ?? DEFAULT_SPACE[id];
    for (const c of candidatesOf(id, sweeps, direction)) out.push(c);
  }
  return out;
}

/** The settings tried on a timeframe: the plain families and the Composed ones. */
function settingsOf(input: SweepInput, base: Setting[], timeframe: Interval): Setting[] {
  const direction = { long: 1, short: 2, both: 3 }[input.direction];
  return [...base, ...composedSettings(input.composed, timeframe, direction)];
}

const listOf = (xs: readonly unknown[]): string => xs.join(', ');

function check(input: SweepInput): void {
  if (input.markets.length === 0) throw new Error('Pick at least one market.');
  if (input.timeframes.length === 0) throw new Error('Pick at least one timeframe.');
  if (input.targetSets.length < 1 || input.targetSets.length > 4) throw new Error('Give 1 to 4 target sets.');
  if (input.families.length === 0 && !input.composed?.entryRules.length) throw new Error('Pick at least one strategy family.');
  for (const id of input.families) {
    if (!(SIGNAL_FAMILIES as readonly string[]).includes(id)) {
      throw new Error(`Unknown strategy family "${id}". The search can use: ${SIGNAL_FAMILIES.join(', ')}.`);
    }
  }
  if (input.composed) {
    for (const r of input.composed.entryRules) {
      if (!(COMPOSED_ENTRY_RULES as readonly number[]).includes(r)) {
        throw new Error(`Unknown Composed entry rule "${r}". The search can use: ${listOf(COMPOSED_ENTRY_RULES)}.`);
      }
    }
    for (const f of input.composed.filters) {
      if (!(COMPOSED_FILTERS as readonly string[]).includes(f)) {
        throw new Error(`Unknown Composed filter "${f}". The search can use: ${listOf(COMPOSED_FILTERS)}.`);
      }
    }
    for (const k of input.composed.trendTfs) {
      if (!(COMPOSED_TREND_TFS as readonly number[]).includes(k)) {
        throw new Error(`Unknown Composed trend timeframe "${k}". The search can use these multiples of the loaded bars: ${listOf(COMPOSED_TREND_TFS)}.`);
      }
    }
  }
  if (input.beatBuyHold !== undefined && !['off', 'return', 'return_dd'].includes(input.beatBuyHold)) {
    throw new Error(`Unknown buy-and-hold target "${input.beatBuyHold}". The search can use: off, return, return_dd.`);
  }
  if (exitCount(input.exits) === 0) throw new Error('Give at least one exit.');
  if (!(input.risk.riskPct > 0)) throw new Error('Risk per trade must be above 0.');
}

/** Combinations a run would try: markets x (per timeframe: its signal settings) x exits, twice with the baseline. Counted before anything loads, without building the Composed settings. */
export function sweepCombos(input: SweepInput): number {
  const base = baseSettingsOf(input).length;
  let settings = 0;
  for (const tf of input.timeframes) settings += base + composedCount(input.composed, tf);
  return input.markets.length * settings * exitCount(input.exits) * (input.baseline ? 2 : 1);
}

/** Buy and hold of a part: first close to last close, and the largest fall from a peak of the closes (positive percent). */
export function buyHoldOf(candles: Candle[]): { buyHoldPct: number; buyHoldDrawdownPct: number } {
  if (candles.length === 0 || !(candles[0].close > 0)) return { buyHoldPct: 0, buyHoldDrawdownPct: 0 };
  let peak = candles[0].close;
  let dd = 0;
  for (const c of candles) {
    peak = Math.max(peak, c.close);
    if (peak > 0) dd = Math.max(dd, ((peak - c.close) / peak) * 100);
  }
  return { buyHoldPct: (candles[candles.length - 1].close / candles[0].close - 1) * 100, buyHoldDrawdownPct: dd };
}

/** Whether the hold-out figures beat buy and hold under the chosen target. */
export function beatsBuyHold(mode: BeatBuyHold | undefined, b: PartFigures, bh: { buyHoldPct: number; buyHoldDrawdownPct: number }): boolean {
  if (!mode || mode === 'off') return true;
  if (mode === 'return') return b.totalReturnPct > bh.buyHoldPct;
  if (!(b.totalReturnPct > 0)) return false;
  if (!(b.maxDrawdownPct > 0)) return true;
  const hold = bh.buyHoldDrawdownPct > 0 ? bh.buyHoldPct / bh.buyHoldDrawdownPct : bh.buyHoldPct > 0 ? Infinity : 0;
  return b.totalReturnPct / b.maxDrawdownPct > hold;
}

/** Held first, then by final equity (hold-out for held ones, selection otherwise). */
export function rankCandidates(list: SweepCandidate[]): SweepCandidate[] {
  const key = (c: SweepCandidate): number => (c.held ? c.heldOut.finalEquity : c.selection.finalEquity);
  return [...list].sort((a, b) => Number(b.held) - Number(a.held) || key(b) - key(a));
}

interface Task {
  market: SweepMarket;
  timeframe: Interval;
}

type Loaded = { ok: true; candles: Candle[] } | { ok: false; reason: string };

interface PassOut {
  found: SweepCandidate[];
  best: { gaps: Gap[]; size: number; c: ClosestCandidate } | null;
  reachedMin: boolean;
  met: number;
  held: number;
}

/** Runs the search. Rejects with an AbortError when `signal` aborts, and with the count when the run is over budget. */
export async function runSweep(
  input: SweepInput,
  load: SweepLoad,
  onProgress?: (p: SweepProgress) => void,
  signal?: AbortSignal,
): Promise<SweepResult> {
  check(input);
  const total = sweepCombos(input);
  if (total > MAX_SWEEP_COMBOS) {
    throw new Error(`Search has ${total} combinations; the limit is ${MAX_SWEEP_COMBOS}. Pick fewer markets, timeframes or strategies.`);
  }
  const base = baseSettingsOf(input);
  const byTimeframe = new Map<Interval, Setting[]>();
  const settingsFor = (tf: Interval): Setting[] => {
    let list = byTimeframe.get(tf);
    if (!list) byTimeframe.set(tf, (list = settingsOf(input, base, tf)));
    return list;
  };
  const exitsPer = exitCount(input.exits);
  const passes = input.baseline ? 2 : 1;
  const guard = (): void => {
    if (signal?.aborted) throw abortError();
  };
  guard();

  const tasks: Task[] = input.markets.flatMap((market) => input.timeframes.map((timeframe) => ({ market, timeframe })));
  const startLoad = (t: Task): Promise<Loaded> =>
    Promise.resolve()
      .then(() => load(t.market, t.timeframe, signal))
      .then(
        (candles): Loaded => ({ ok: true, candles }),
        (e: unknown): Loaded => ({ ok: false, reason: msg(e) }),
      );
  /** At most MAX_LOADS loads are started ahead of the series being worked on. */
  const loading: Array<Promise<Loaded> | undefined> = [];
  let started = 0;
  const ensure = (upTo: number): void => {
    for (; started <= Math.min(upTo, tasks.length - 1); started++) loading[started] = startLoad(tasks[started]);
  };

  let candidates: SweepCandidate[] = [];
  const closest: ClosestCandidate[] = [];
  const skipped: SkippedSeries[] = [];
  let tried = 0;
  let met = 0;
  let held = 0;
  const baseline = { series: 0, tried: 0, met: 0, held: 0 };
  let lastPct = 0;
  let sliceStart = Date.now();
  const report = (label: string): void => {
    lastPct = Math.max(lastPct, total ? tried / total : 1);
    onProgress?.({ pct: lastPct, label });
  };
  const breathe = async (): Promise<void> => {
    if (Date.now() - sliceStart < SLICE_MS) return;
    await yieldNow();
    guard();
    sliceStart = Date.now();
  };

  const { targetSets, risk } = input;

  /** Every setting with every exit on the searched part; the ones that meet a set are checked on the hold-out. */
  const searchPass = async (
    label: string,
    market: SweepMarket,
    timeframe: Interval,
    sel: Candle[],
    out: Candle[],
    exits: SweepExit[],
    keep: boolean,
  ): Promise<PassOut & { tried: number }> => {
    const settings = settingsFor(timeframe);
    const selHold = buyHoldOf(sel);
    const outHold = buyHoldOf(out);
    const res: PassOut & { tried: number } = { found: [], best: null, reachedMin: false, met: 0, held: 0, tried: 0 };
    for (const s of settings) {
      guard();
      // Signals are built once per setting; every exit reuses them.
      const selSignals = buildSignals(sel, s.strategyId, s.params);
      let outSignals: unknown[] | null = null;
      for (const x of exits) {
        const config = sweepConfig(risk, s.strategyId, s.params, x);
        const a = figuresOf(runBacktest(sel, selSignals, config), risk.initialCapital);
        tried++;
        res.tried++;
        if (a.trades < MIN_SELECTION_TRADES) continue;
        res.reachedMin = true;
        let setIndex = -1;
        let nearest = -1;
        let nearestSize = Infinity;
        let nearestGaps: Gap[] = [];
        for (let k = 0; k < targetSets.length; k++) {
          const gaps = gapsOf(a, targetSets[k]);
          if (gaps.length === 0) {
            setIndex = k;
            break;
          }
          const size = gapSize(gaps);
          if (size < nearestSize) [nearest, nearestSize, nearestGaps] = [k, size, gaps];
        }
        if (setIndex < 0) {
          if (keep && (!res.best || nearestSize < res.best.size)) {
            res.best = {
              gaps: nearestGaps,
              size: nearestSize,
              c: { market, timeframe, strategyId: s.strategyId, params: s.params, ...exitFields(x), setIndex: nearest, gaps: nearestGaps, selection: { ...a, ...selHold } },
            };
          }
          continue;
        }
        res.met++;
        outSignals ??= buildSignals(out, s.strategyId, s.params);
        const b = figuresOf(runBacktest(out, outSignals, config), risk.initialCapital);
        const isHeld = b.trades >= MIN_HELD_TRADES && gapsOf(b, targetSets[setIndex]).length === 0 && beatsBuyHold(input.beatBuyHold, b, outHold);
        if (isHeld) res.held++;
        if (keep) {
          res.found.push({
            market,
            timeframe,
            strategyId: s.strategyId,
            params: s.params,
            ...exitFields(x),
            setIndex,
            held: isHeld,
            selection: { ...a, ...selHold },
            heldOut: { ...b, ...outHold },
          });
        }
      }
      report(label);
      await breathe();
    }
    return res;
  };

  for (let ti = 0; ti < tasks.length; ti++) {
    ensure(ti + MAX_LOADS - 1);
    const { market, timeframe } = tasks[ti];
    const label = `${market.symbol} ${timeframe}`;
    const perSeries = settingsFor(timeframe).length * exitsPer * passes;
    const loaded = await (loading[ti] as Promise<Loaded>);
    loading[ti] = undefined;
    guard();
    const skip = (reason: string): void => {
      skipped.push({ market, timeframe, reason });
      tried += perSeries;
      report(label);
    };
    if (!loaded.ok) {
      skip(loaded.reason);
      continue;
    }
    const all = loaded.candles.slice(-MAX_BARS);
    const cut = Math.floor((all.length * SELECTION_PCT) / 100);
    const sel = all.slice(0, cut);
    const out = all.slice(cut);
    if (sel.length < 2 || out.length < 2) {
      skip('Too short: not enough candles to split into a searched part and a hold-out.');
      continue;
    }
    const range = typicalRangePct(sel);
    if (!(range > 0)) {
      skip('The candles have no price range, so no stop can be sized.');
      continue;
    }

    const real = await searchPass(label, market, timeframe, sel, out, exitsOf(range, input.exits), true);
    met += real.met;
    held += real.held;
    if (!real.reachedMin) {
      skipped.push({ market, timeframe, reason: `Too short: no strategy reached ${MIN_SELECTION_TRADES} trades on the searched part.` });
    } else if (real.found.length === 0 && real.best) {
      closest.push(real.best.c);
    }
    candidates = candidates.concat(rankCandidates(real.found).slice(0, KEEP_PER_SERIES));
    await breathe();

    if (input.baseline) {
      // The same search on a shuffled copy: counts only, and the stop size comes from the shuffled searched part.
      const copy = shuffledCopy(all, seedOf(`${market.provider}|${market.symbol}|${timeframe}`));
      const cSel = copy.slice(0, cut);
      const cOut = copy.slice(cut);
      const cRange = typicalRangePct(cSel);
      if (cRange > 0) {
        const shuffled = await searchPass(label, market, timeframe, cSel, cOut, exitsOf(cRange, input.exits), false);
        baseline.series++;
        baseline.tried += shuffled.tried;
        baseline.met += shuffled.met;
        baseline.held += shuffled.held;
      } else {
        tried += perSeries / 2;
        report(label);
      }
      await breathe();
    }
  }
  guard();
  report('done');
  return {
    candidates: rankCandidates(candidates),
    closest,
    skipped,
    tried,
    met,
    held,
    ...(input.baseline ? { baseline } : {}),
  };
}
