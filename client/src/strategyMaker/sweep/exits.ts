/** The exit grid of the market search: a stop sized by the typical bar range, with a take profit as a multiple of it. */
import type { Candle } from '../../types';
import { DEFAULT_ATR_LENGTH } from '../../lib/backtest/exits';
import type { BacktestConfig } from '../../lib/backtest/types';
import type { ExitGrid, ExitKind, SweepCandidate, SweepExit } from './types';

export const EXIT_KINDS: readonly ExitKind[] = ['range', 'atr', 'atr_trail'];

export const DEFAULT_EXITS: ExitGrid = { stopMults: [1, 2, 4], tpMults: [1, 1.5, 2, 3, 4, 5], kinds: ['range'] };

/** The kinds a grid asks for, in the fixed order; unknown ones are dropped and none left reads as range. */
export function kindsOf(g: ExitGrid): ExitKind[] {
  const asked = (g.kinds ?? []) as unknown[];
  const out = EXIT_KINDS.filter((k) => asked.includes(k));
  return out.length ? out : ['range'];
}

export const exitCount = (g: ExitGrid): number => kindsOf(g).length * g.stopMults.length * g.tpMults.length;

/** The median of (high - low) / close over the candles, in percent. 0 without candles. */
export function typicalRangePct(candles: Candle[]): number {
  const r = candles.filter((c) => c.close > 0).map((c) => ((c.high - c.low) / c.close) * 100);
  if (!r.length) return 0;
  r.sort((a, b) => a - b);
  const m = r.length >> 1;
  return r.length % 2 ? r[m] : (r[m - 1] + r[m]) / 2;
}

/** Every exit the grid asks for: kinds outermost (range, ATR, trailing), then stop, then take profit. */
export function exitsOf(range: number, g: ExitGrid): SweepExit[] {
  const out: SweepExit[] = [];
  for (const kind of kindsOf(g)) {
    for (const s of g.stopMults) {
      for (const t of g.tpMults) {
        const config: Partial<BacktestConfig> =
          kind === 'range'
            ? { stopLossPct: range * s, takeProfitPct: range * s * t }
            : kind === 'atr'
              ? { stopLossPct: null, takeProfitPct: null, stopMode: 'atr', stopAtrMult: s, takeProfitMode: 'r', takeProfitR: t, atrLength: DEFAULT_ATR_LENGTH }
              : { stopLossPct: null, takeProfitPct: null, trailMode: 'atr', trailAtrMult: s, takeProfitMode: 'r', takeProfitR: t, atrLength: DEFAULT_ATR_LENGTH };
        out.push({ kind, stopMult: s, tpMult: t, config });
      }
    }
  }
  return out;
}

/** The percents a candidate records for an exit: those of the range kind, null for the ATR kinds. */
export const exitFields = (x: SweepExit): { exit: SweepExit; stopLossPct: number | null; takeProfitPct: number | null } => ({
  exit: x,
  stopLossPct: x.config.stopLossPct ?? null,
  takeProfitPct: x.config.takeProfitPct ?? null,
});

/** The exit of a candidate; for a result stored before exit kinds existed, the range exit built from its percents. */
export function exitOfCandidate(c: Pick<SweepCandidate, 'exit' | 'stopLossPct' | 'takeProfitPct'>): SweepExit {
  if (c.exit) return c.exit;
  const s = c.stopLossPct ?? 0;
  const p = c.takeProfitPct ?? 0;
  return { kind: 'range', stopMult: 0, tpMult: s > 0 ? p / s : 0, config: { stopLossPct: c.stopLossPct, takeProfitPct: c.takeProfitPct } };
}

const num = (n: number): string => String(Number(n.toFixed(4)));
const pct2 = (n: number | null | undefined): string => `${(n ?? 0).toFixed(2)}%`;

/** The exit in words: `stop 2.10%, take profit 4.20%`, `stop 2 ATR, take profit 3R`, `trailing stop 2 ATR, take profit 3R`. */
export function exitWords(x: SweepExit): string {
  if (x.kind === 'range') return `stop ${pct2(x.config.stopLossPct)}, take profit ${pct2(x.config.takeProfitPct)}`;
  return `${x.kind === 'atr' ? 'stop' : 'trailing stop'} ${num(x.stopMult)} ATR, take profit ${num(x.tpMult)}R`;
}

/** The exit in a table cell: `2.10% / 4.20%`, `2 ATR / 3R`, `2 ATR trailing / 3R`. */
export function exitShort(x: SweepExit): string {
  if (x.kind === 'range') return `${pct2(x.config.stopLossPct)} / ${pct2(x.config.takeProfitPct)}`;
  return `${num(x.stopMult)} ATR${x.kind === 'atr_trail' ? ' trailing' : ''} / ${num(x.tpMult)}R`;
}

/** A sort value that orders by kind (range, ATR, trailing), then by stop. */
export const exitSortValue = (x: SweepExit): number => EXIT_KINDS.indexOf(x.kind) * 1e9 + (x.kind === 'range' ? x.config.stopLossPct ?? 0 : x.stopMult);

/** A key that is unique per exit. */
export const exitKey = (x: SweepExit): string => `${x.kind}|${x.config.stopLossPct ?? ''}|${x.config.takeProfitPct ?? ''}|${x.stopMult}|${x.tpMult}`;
