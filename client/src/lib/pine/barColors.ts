import type { Candle } from '../../types';
import { runFitsVisible } from '../replay';
import type { PineRunState } from '../../state/chart';
import { buildPineChart } from './chartSeries';

/** The parts of an indicator entry needed here (an `IndicatorSpec` fits). */
interface PineSpecLike {
  id: string;
  kind: string;
  visible: boolean;
  color: string;
}

/**
 * barcolor() of every visible, replay-fitting Pine run, merged into one map of candle time -> CSS color.
 * Scripts apply in indicator order; on a shared bar the last one wins.
 */
export function mergeBarColors(
  indicators: PineSpecLike[],
  pineRuns: Record<string, PineRunState>,
  lastVisibleTime: number | null,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const spec of indicators) {
    const run = pineRuns[spec.id];
    if (spec.kind !== 'pine' || !spec.visible || !run?.result || !run.candles) continue;
    if (!run.result.plots.some((p) => p.kind === 'barcolor')) continue;
    if (!runFitsVisible(run.candles as Candle[], lastVisibleTime)) continue;
    for (const [t, c] of buildPineChart(run.result, run.candles, spec.color).barColors) out.set(t, c);
  }
  return out;
}

/** Whether two bar-color maps hold the same colors on the same bars. */
export function sameBarColors(a: Map<number, string>, b: Map<number, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [t, c] of a) if (b.get(t) !== c) return false;
  return true;
}
