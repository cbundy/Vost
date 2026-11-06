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
import { exitCount, exitFields, exitsOf, typicalRangePct, DEFAULT_EXITS } from './exits';
import type {
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

function settingsOf(input: SweepInput): Setting[] {
  const direction = { long: 1, short: 2, both: 3 }[input.direction];
  const out: Setting[] = [];
  for (const id of new Set(input.families)) {
    const sweeps: SweepParam[] = input.space?.[id] ?? DEFAULT_SPACE[id];
    for (const c of candidatesOf(id, sweeps, direction)) out.push(c);
  }
  return out;
}

function check(input: SweepInput): void {
  if (input.markets.length === 0) throw new Error('Pick at least one market.');
  if (input.timeframes.length === 0) throw new Error('Pick at least one timeframe.');
  if (input.targetSets.length < 1 || input.targetSets.length > 4) throw new Error('Give 1 to 4 target sets.');
  if (input.families.length === 0) throw new Error('Pick at least one strategy family.');
  for (const id of input.families) {
    if (!(SIGNAL_FAMILIES as readonly string[]).includes(id)) {
      throw new Error(`Unknown strategy family "${id}". The search can use: ${SIGNAL_FAMILIES.join(', ')}.`);
    }
  }
  if (exitCount(input.exits) === 0) throw new Error('Give at least one exit.');
  if (!(input.risk.riskPct > 0)) throw new Error('Risk per trade must be above 0.');
}

/** Combinations a run would try: markets x timeframes x signal settings x exits. Counted before anything loads. */
export function sweepCombos(input: SweepInput): number {
  return input.markets.length * input.timeframes.length * settingsOf(input).length * exitCount(input.exits);
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

/** Runs the search. Rejects with an AbortError when `signal` aborts, and with the count when the run is over budget. */
export async function runSweep(
  input: SweepInput,
  load: SweepLoad,
  onProgress?: (p: SweepProgress) => void,
  signal?: AbortSignal,
): Promise<SweepResult> {
  check(input);
  const settings = settingsOf(input);
  const exitsPer = exitCount(input.exits);
  const perSeries = settings.length * exitsPer;
  const total = perSeries * input.markets.length * input.timeframes.length;
  if (total > MAX_SWEEP_COMBOS) {
    throw new Error(`Search has ${total} combinations; the limit is ${MAX_SWEEP_COMBOS}. Pick fewer markets, timeframes or strategies.`);
  }
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

  for (let ti = 0; ti < tasks.length; ti++) {
    ensure(ti + MAX_LOADS - 1);
    const { market, timeframe } = tasks[ti];
    const label = `${market.symbol} ${timeframe}`;
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
    const exits = exitsOf(range, input.exits);

    const found: SweepCandidate[] = [];
    let best: { gaps: Gap[]; size: number; c: ClosestCandidate } | null = null;
    let reachedMin = false;

    for (const s of settings) {
      guard();
      // Signals are built once per setting; every exit reuses them.
      const selSignals = buildSignals(sel, s.strategyId, s.params);
      let outSignals: unknown[] | null = null;
      for (const x of exits) {
        const config = sweepConfig(risk, s.strategyId, s.params, x);
        const a = figuresOf(runBacktest(sel, selSignals, config), risk.initialCapital);
        tried++;
        if (a.trades < MIN_SELECTION_TRADES) continue;
        reachedMin = true;
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
          if (!best || nearestSize < best.size) {
            best = {
              gaps: nearestGaps,
              size: nearestSize,
              c: { market, timeframe, strategyId: s.strategyId, params: s.params, ...exitFields(x), setIndex: nearest, gaps: nearestGaps, selection: a },
            };
          }
          continue;
        }
        met++;
        outSignals ??= buildSignals(out, s.strategyId, s.params);
        const b = figuresOf(runBacktest(out, outSignals, config), risk.initialCapital);
        const isHeld = b.trades >= MIN_HELD_TRADES && gapsOf(b, targetSets[setIndex]).length === 0;
        if (isHeld) held++;
        found.push({ market, timeframe, strategyId: s.strategyId, params: s.params, ...exitFields(x), setIndex, held: isHeld, selection: a, heldOut: b });
      }
      report(label);
      await breathe();
    }

    if (!reachedMin) {
      skipped.push({ market, timeframe, reason: `Too short: no strategy reached ${MIN_SELECTION_TRADES} trades on the searched part.` });
    } else if (found.length === 0 && best) {
      closest.push(best.c);
    }
    candidates = candidates.concat(rankCandidates(found).slice(0, KEEP_PER_SERIES));
    await breathe();
  }
  guard();
  report('done');
  return { candidates: rankCandidates(candidates), closest, skipped, tried, met, held };
}
