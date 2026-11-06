/**
 * The strategy maker's two standard jobs of the Settings benchmark (a find and a market search), each forced to
 * one place. They live here, and Settings loads this file only when the benchmark runs, so the main bundle does
 * not carry the strategy maker. The constants are in `lib/benchmark.ts`.
 */
import { benchmarkInputs, BENCHMARK_INPUTS, BENCHMARK_SCOPE } from '../lib/benchmark';
import { ServerUnavailableError } from '../lib/serverJobs';
import { createEngineClient, type EngineClient } from './engineClient';
import type { SeriesInput } from './engine/types';
import type { FindInputs } from './run';
import type { SweepInput } from './sweep/types';

export function makerInputs(): { series: SeriesInput[]; find: FindInputs; sweep: SweepInput } {
  const { candles, trades } = benchmarkInputs();
  const f = BENCHMARK_INPUTS.find;
  const s = BENCHMARK_INPUTS.sweep;
  return {
    series: [{ candles, trades: trades.map((t) => ({ side: t.side, entryTime: t.entryTime, exitTime: t.exitTime })) }],
    find: { direction: 'long', families: [...f.families], risk: { feeBps: f.feeBps, slippageBps: f.slippageBps, stopLossPct: null, takeProfitPct: null }, targets: {} },
    sweep: {
      markets: [{ ...s.market }],
      timeframes: [s.timeframe],
      families: [s.family],
      direction: 'long',
      targetSets: [{ minHitRatePct: 0 }],
      risk: { initialCapital: s.initialCapital, riskPct: s.riskPct, feeBps: s.feeBps, slippageBps: s.slippageBps },
      exits: { stopMults: [...s.stopMults], tpMults: [...s.tpMults] },
    },
  };
}

/** The engine client falls back to the browser when the server cannot take a job; the benchmark wants the refusal instead. */
function refuse(reason: string): never {
  throw new ServerUnavailableError(reason);
}

export function createMakerRunner(): { run(kind: 'find' | 'sweep', where: 'browser' | 'server', signal: AbortSignal): Promise<unknown>; dispose(): void } {
  const clients: Partial<Record<'browser' | 'server', EngineClient>> = {};
  const clientFor = (where: 'browser' | 'server'): EngineClient =>
    (clients[where] ??= createEngineClient(where === 'browser' ? { place: () => 'browser' } : { place: () => 'server', scope: BENCHMARK_SCOPE }));
  return {
    run(kind, where, signal) {
      const i = makerInputs();
      const client = clientFor(where);
      return kind === 'find' ? client.find(i.series, i.find, { signal, onFallback: refuse }) : client.sweep(i.sweep, { signal, onFallback: refuse });
    },
    dispose() {
      clients.browser?.dispose();
      clients.server?.dispose();
    },
  };
}
