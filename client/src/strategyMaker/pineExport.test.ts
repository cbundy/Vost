import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { candlesFromCsvText } from '../lib/csv';
import { runBacktest } from '../lib/backtest/engine';
import { buildSignals, getStrategy } from '../lib/backtest/strategies';
import { runPine } from '../lib/pine/runtime';
import type { Candle } from '../types';
import { synth } from './engine/synthetic';
import { pineStrategyText, settingsPlain } from './pineExport';
import { configFor, type FindInputs } from './run';

const sample = candlesFromCsvText(readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8')).candles;
const series: Array<[string, Candle[]]> = [
  ['sample-daily', sample],
  ['synthetic', synth(1500, 7)],
];

type Run = Pick<FindInputs, 'direction' | 'risk'>;
const risk = (stopLossPct: number | null = null, takeProfitPct: number | null = null): Run['risk'] => ({ feeBps: 10, slippageBps: 0, stopLossPct, takeProfitPct });
const DIR = { long: 1, short: 2, both: 3 } as const;

const CASES: Array<[string, Record<string, number>[]]> = [
  ['sma_cross', [{ fast: 8, slow: 34 }, { fast: 5, slow: 21 }]],
  ['ema_cross', [{ fast: 12, slow: 26 }, { fast: 5, slow: 50 }]],
  ['macd_cross', [{ fast: 12, slow: 26, signal: 9 }, { fast: 8, slow: 17, signal: 5 }]],
  ['rsi_reversion', [{ length: 14, oversold: 30, overbought: 70 }, { length: 7, oversold: 35, overbought: 60 }]],
  ['bollinger', [{ length: 20, mult: 2, mode: 0 }, { length: 15, mult: 1.5, mode: 1 }]],
  ['donchian', [{ entry: 20, exit: 10 }, { entry: 30, exit: 8 }]],
];

/** What both sides did, as comparable rows. */
async function compare(candles: Candle[], strategyId: string, base: Record<string, number>, direction: 'long' | 'short' | 'both', r: Run['risk']) {
  const params = { ...base, direction: DIR[direction] };
  const run: Run = { direction, risk: r };
  const engine = runBacktest(candles, buildSignals(candles, strategyId, params), configFor(run)).trades;
  const out = await runPine(pineStrategyText({ strategyId, params }, run), candles);
  if (!out.ok) throw new Error(out.error.message);
  const pine = [...out.trades].sort((a, b) => a.entryIndex - b.entryIndex);
  const row = (t: { side: string; entryBar: number; exitBar: number | null; entryPrice: number; exitPrice: number | null }) => t;
  const exits = engine.flatMap((t) => (t.exitReason === 'stop_loss' || t.exitReason === 'take_profit' ? [t.exitReason, ...(t.exitBar > t.entryBar ? [`inner-${t.exitReason}`] : [])] : []));
  return {
    exits,
    engine: engine.map((t) => row({ side: t.side, entryBar: t.entryBar, exitBar: t.exitReason === 'end_of_data' ? null : t.exitBar, entryPrice: t.entryPrice, exitPrice: t.exitReason === 'end_of_data' ? null : t.exitPrice })),
    pine: pine.map((t) => row({ side: t.direction, entryBar: t.entryIndex, exitBar: t.exitIndex, entryPrice: t.entryPrice, exitPrice: t.exitPrice })),
  };
}

type Row = Awaited<ReturnType<typeof compare>>['engine'][number];

/** Same trades: sides and bars exactly, prices within `tol` (Pine rounds a stop or target price to the tick). */
function expectSame(pine: Row[], engine: Row[], tol: number) {
  expect(pine.map((t) => [t.side, t.entryBar, t.exitBar])).toEqual(engine.map((t) => [t.side, t.entryBar, t.exitBar]));
  pine.forEach((t, i) => {
    expect(Math.abs(t.entryPrice - engine[i].entryPrice)).toBeLessThanOrEqual(tol);
    expect(Math.abs((t.exitPrice ?? 0) - (engine[i].exitPrice ?? 0))).toBeLessThanOrEqual(tol);
  });
}

describe('Pine export trades like the built-in strategy', () => {
  for (const [id, settings] of CASES) {
    for (const [i, p] of settings.entries()) {
      for (const direction of ['long', 'short', 'both'] as const) {
        for (const [label, candles] of series) {
          it(`${id} #${i + 1} ${direction} on ${label}`, async () => {
            const { engine, pine } = await compare(candles, id, p, direction, risk());
            expect(engine.length).toBeGreaterThan(0);
            expectSame(pine, engine, 1e-6);
          }, 60000);
        }
      }
    }
  }
});

/**
 * A stop or target counts from the bar after the entry in Pine (the exit order is placed once the entry has filled),
 * while Vost's engine also checks the entry bar itself. So a trade the engine closes on its entry bar ends one or more
 * bars later in the script. Every other trade must be identical, and no trade may be added or lost.
 */
function expectSameWithStops(pine: Row[], engine: Row[], tol: number) {
  expect(pine.map((t) => [t.side, t.entryBar])).toEqual(engine.map((t) => [t.side, t.entryBar]));
  engine.forEach((e, i) => {
    const t = pine[i];
    if (e.exitBar != null && e.exitBar === e.entryBar) {
      expect(t.exitBar == null || t.exitBar > e.entryBar).toBe(true);
      return;
    }
    expect(t.exitBar).toBe(e.exitBar);
    expect(Math.abs(t.entryPrice - e.entryPrice)).toBeLessThanOrEqual(tol);
    expect(Math.abs((t.exitPrice ?? 0) - (e.exitPrice ?? 0))).toBeLessThanOrEqual(tol);
  });
}

describe('Pine export with a stop and a target', () => {
  const stopped = new Set<string>();
  for (const [id, settings] of CASES) {
    for (const direction of ['long', 'short', 'both'] as const) {
      for (const [label, candles] of series) {
        it(`${id} ${direction} on ${label}`, async () => {
          const { engine, pine, exits } = await compare(candles, id, settings[0], direction, risk(1.5, 3));
          expect(engine.length).toBeGreaterThan(0);
          expectSameWithStops(pine, engine, 0.01);
          exits.forEach((x) => stopped.add(x));
        }, 60000);
      }
    }
  }
  it('the cases above exercise both stops and targets, some with the exit after the entry bar', () => {
    expect([...stopped].sort()).toEqual(['inner-stop_loss', 'inner-take_profit', 'stop_loss', 'take_profit']);
  });
});

describe('settingsPlain', () => {
  it('names every setting', () => {
    const text = settingsPlain({ strategyId: 'bollinger', params: { length: 15, mult: 1.5, mode: 1, direction: 3 } }, { direction: 'both', risk: { feeBps: 10, slippageBps: 5, stopLossPct: 2, takeProfitPct: null } });
    for (const part of ['Bollinger Bands', 'Length: 15', 'Std dev mult: 1.5', 'Mode: Mean reversion', 'Direction: Both', 'Fee: 10 bps', 'Slippage: 5 bps', 'Stop loss: 2%', 'Take profit: off', 'Initial capital: 10000', 'Position size: 100%']) {
      expect(text).toContain(part);
    }
  });
  it('has a label for every parameter of every template', () => {
    for (const [id] of CASES) {
      const text = settingsPlain({ strategyId: id, params: {} }, { direction: 'long', risk: risk() });
      for (const p of getStrategy(id).params) expect(text).toContain(`${p.label}: `);
    }
  });
});

describe('pineStrategyText', () => {
  const run: Run = { direction: 'both', risk: { feeBps: 10, slippageBps: 5, stopLossPct: 2, takeProfitPct: 4 } };
  it('declares the strategy settings and the risk', () => {
    const t = pineStrategyText({ strategyId: 'sma_cross', params: { fast: 8, slow: 34, direction: 3 } }, run);
    expect(t).toContain('//@version=6');
    expect(t).toContain('initial_capital=10000');
    expect(t).toContain('default_qty_type=strategy.percent_of_equity, default_qty_value=100');
    expect(t).toContain('commission_type=strategy.commission.percent, commission_value=0.1');
    expect(t).toContain('input.int(8, "Fast period"');
    expect(t).toContain('input.string("Both", "Direction"');
    expect(t).toContain('stop=avg * (1 - stopPct / 100)');
    expect(t).toContain('stopPct = input.float(2,');
  });
  it('leaves the exit out when neither stop nor target is set', () => {
    const t = pineStrategyText({ strategyId: 'donchian', params: { entry: 20, exit: 10, direction: 1 } }, { direction: 'long', risk: risk() });
    expect(t).not.toContain('strategy.exit');
  });
  it('refuses a strategy it has no script for', () => {
    expect(() => pineStrategyText({ strategyId: 'buy_hold', params: {} }, run)).toThrow();
  });
});
