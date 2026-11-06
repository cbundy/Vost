import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { candlesFromCsvText } from '../lib/csv';
import { runBacktest } from '../lib/backtest/engine';
import { atr } from '../lib/indicators';
import { buildSignals, getStrategy } from '../lib/backtest/strategies';
import { runPine } from '../lib/pine/runtime';
import type { Candle } from '../types';
import { synth } from './engine/synthetic';
import { hasPine, pineStrategyText, settingsPlain } from './pineExport';
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
  ['pullback', [{ trend: 20, length: 5, dip: 40, target: 70 }, { trend: 30, length: 7, dip: 45, target: 60 }]],
  ['reversal', [{ length: 20, mult: 2 }, { length: 10, mult: 1.5 }]],
  ['momentum_breakout', [{ entry: 20, exit: 10, volLen: 20, volMult: 1 }, { entry: 10, exit: 5, volLen: 10, volMult: 1 }]],
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
  const exits = engine.flatMap((t) => (t.exitReason === 'stop_loss' || t.exitReason === 'take_profit' || t.exitReason === 'trailing_stop' ? [t.exitReason, ...(t.exitBar > t.entryBar ? [`inner-${t.exitReason}`] : [])] : []));
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

/** A random walk whose volume spikes on some bars, so a volume rule fires on both sides (the sample series has real volume, the synthetic one a flat 1000). */
function spiky(): Candle[] {
  const base = synth(1500, 11);
  return base.map((c, i) => ({ ...c, volume: i % 7 === 0 ? 4000 : 1000 + (i % 5) * 50 }));
}

describe('momentum_breakout Pine export with volume spikes', () => {
  for (const direction of ['long', 'short', 'both'] as const) {
    it(`takes the engine's trades, ${direction}`, async () => {
      const { engine, pine } = await compare(spiky(), 'momentum_breakout', { entry: 15, exit: 7, volLen: 20, volMult: 2 }, direction, risk());
      expect(engine.length).toBeGreaterThan(0);
      if (direction !== 'short') expect(engine.some((t) => t.side === 'long')).toBe(true);
      if (direction !== 'long') expect(engine.some((t) => t.side === 'short')).toBe(true);
      expectSame(pine, engine, 1e-6);
    }, 60000);
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

describe('risk sized export', () => {
  const plain: Run = { direction: 'both', risk: { feeBps: 10, slippageBps: 5, stopLossPct: 2, takeProfitPct: 4 } };
  const risky: Run = { direction: 'both', risk: { ...plain.risk, riskPct: 2 } };
  const cand = { strategyId: 'sma_cross', params: { fast: 8, slow: 34, direction: 3 } };
  it('names risk sizing in the settings text instead of the percent of equity line', () => {
    const text = settingsPlain(cand, risky);
    expect(text).toContain('Position size: risk 2% of equity at the stop');
    expect(text).not.toContain('Position size: 100%');
  });
  it('sizes each entry by risk, with an input and a header comment', () => {
    const t = pineStrategyText(cand, risky);
    expect(t).toContain('riskPct = input.float(2, "Risk per trade %"');
    expect(t).toContain('strategy.entry("Long", strategy.long, qty=strategy.equity * riskPct / 100 / (close * stopPct / 100))');
    expect(t).toContain('strategy.entry("Short", strategy.short, qty=strategy.equity * riskPct / 100 / (close * stopPct / 100))');
    expect(t).toContain('// Position size is by risk');
  });
  it('without riskPct, or without a stop, the script is unchanged', () => {
    expect(pineStrategyText(cand, plain)).not.toMatch(/riskPct|qty=|by risk/);
    const noStop: Run = { direction: 'both', risk: { feeBps: 10, slippageBps: 5, stopLossPct: null, takeProfitPct: null, riskPct: 2 } };
    expect(pineStrategyText(cand, noStop)).toBe(pineStrategyText(cand, { direction: 'both', risk: { ...noStop.risk, riskPct: undefined } }));
  });
  it('the script runs in the Pine runtime', async () => {
    const out = await runPine(pineStrategyText(cand, risky), sample);
    if (!out.ok) throw new Error(out.error.message);
    expect(out.trades.length).toBeGreaterThan(0);
  });
});

const exitRisk = (x: Partial<Run['risk']>): Run['risk'] => ({ ...risk(), ...x });

describe('Pine export with ATR, times-the-stop and trailing exits', () => {
  const groups: Array<[string, Run['risk']]> = [
    ['ATR stop and ATR target', exitRisk({ stopMode: 'atr', stopAtrMult: 2, takeProfitMode: 'atr', takeProfitAtrMult: 3, atrLength: 14 })],
    ['percent stop and 2R target', exitRisk({ stopLossPct: 1.5, takeProfitMode: 'r', takeProfitR: 2 })],
    ['ATR trail alone', exitRisk({ trailMode: 'atr', trailAtrMult: 1.5, atrLength: 10 })],
    ['percent trail alone', exitRisk({ trailMode: 'pct', trailPct: 1.2 })],
    ['ATR trail, percent stop and R target', exitRisk({ stopLossPct: 3, trailMode: 'atr', trailAtrMult: 2, takeProfitMode: 'r', takeProfitR: 1.5, atrLength: 20 })],
  ];
  const seen = new Set<string>();
  for (const [name, r] of groups) {
    for (const [id, settings] of CASES) {
      for (const direction of ['long', 'short', 'both'] as const) {
        for (const [label, candles] of series) {
          it(`${name}: ${id} ${direction} on ${label}`, async () => {
            const { engine, pine, exits } = await compare(candles, id, settings[0], direction, r);
            expect(engine.length).toBeGreaterThan(0);
            expectSameWithStops(pine, engine, 0.01);
            exits.forEach((x) => seen.add(x));
          }, 60000);
        }
      }
    }
  }
  it('the cases above exercise stops, trailing stops and targets, some after the entry bar', () => {
    for (const x of ['stop_loss', 'trailing_stop', 'take_profit', 'inner-stop_loss', 'inner-trailing_stop', 'inner-take_profit']) expect([...seen]).toContain(x);
  });

  for (const [label, candles] of series) {
    it(`computes the ATR as Vost does on ${label}`, async () => {
      const len = 14;
      // Lift the script's own ATR lines into an indicator and plot them.
      const text = pineStrategyText({ strategyId: 'sma_cross', params: { fast: 8, slow: 34, direction: 3 } }, { direction: 'both', risk: exitRisk({ stopMode: 'atr', stopAtrMult: 2, atrLength: len }) });
      const probe = text.replace('strategy(', 'indicator(').split('\n');
      const start = probe.findIndex((l) => l.startsWith('var float atrState'));
      const end = probe.findIndex((l) => l.startsWith('bool atrOk'));
      const script = ['//@version=6', 'indicator("probe")', `atrLength = ${len}`, ...probe.slice(start, end), 'plot(atrV, "atr")'].join('\n');
      const out = await runPine(script, candles);
      if (!out.ok) throw new Error(out.error.message);
      const got = out.plots[0];
      const want = atr(candles, len);
      expect(got.values.length).toBe(want.length);
      let checked = 0;
      want.forEach((v, i) => {
        const g = got.values[i];
        if (v == null) {
          expect(g == null || Number.isNaN(g)).toBe(true);
        } else {
          expect(Math.abs((g as number) - v)).toBeLessThan(1e-9);
          checked++;
        }
      });
      expect(checked).toBeGreaterThan(100);
    });
  }
});

describe('exit options in the copied texts', () => {
  const cand = { strategyId: 'sma_cross', params: { fast: 8, slow: 34, direction: 3 } };
  const base = risk(null, null);
  it('settingsPlain names the modes', () => {
    const t = settingsPlain(cand, { direction: 'both', risk: { ...base, stopMode: 'atr', stopAtrMult: 2, takeProfitMode: 'atr', takeProfitAtrMult: 3, trailMode: 'atr', trailAtrMult: 2.5, atrLength: 20 } });
    for (const part of ['Stop loss: 2 x ATR', 'Take profit: 3 x ATR', 'Trailing stop: 2.5 x ATR', 'ATR length: 20']) expect(t).toContain(part);
    const r = settingsPlain(cand, { direction: 'both', risk: { ...base, stopLossPct: 2, takeProfitMode: 'r', takeProfitR: 2, trailMode: 'pct', trailPct: 1.5 } });
    for (const part of ['Stop loss: 2%', 'Take profit: 2 x the stop', 'Trailing stop: 1.5%']) expect(r).toContain(part);
    expect(r).not.toContain('ATR length');
  });
  it('settingsPlain is unchanged with every option off', () => {
    const t = settingsPlain(cand, { direction: 'both', risk: { ...base, stopLossPct: 2 } });
    expect(t).not.toMatch(/Trailing|ATR/);
    expect(settingsPlain(cand, { direction: 'both', risk: { ...base, stopLossPct: 2, stopMode: 'pct', takeProfitMode: 'pct', trailMode: 'off' } })).toBe(t);
  });
  it('the script is identical with the modes spelled out as off', () => {
    const plain = { ...base, stopLossPct: 2, takeProfitPct: 4, riskPct: 1 };
    expect(pineStrategyText(cand, { direction: 'both', risk: { ...plain, stopMode: 'pct', takeProfitMode: 'pct', trailMode: 'off' } })).toBe(pineStrategyText(cand, { direction: 'both', risk: plain }));
    expect(pineStrategyText(cand, { direction: 'both', risk: plain })).not.toMatch(/ATR|atr|trail/i);
  });
  it('an ATR script has its own ATR and an atrLength input, never ta.atr', () => {
    const t = pineStrategyText(cand, { direction: 'both', risk: { ...base, stopMode: 'atr', stopAtrMult: 2, atrLength: 14 } });
    expect(t).toContain('atrLength = input.int(14,');
    expect(t).toContain('stopAtr = input.float(2,');
    expect(t).not.toContain('ta.atr(');
    expect(t).toContain('not ta.atr');
    expect(t).toContain('target == 0 or atrOk');
  });
  it('a trailing script moves a stop and uses no trail_offset', () => {
    const t = pineStrategyText(cand, { direction: 'both', risk: { ...base, trailMode: 'pct', trailPct: 2 } });
    expect(t).not.toContain('trail_offset');
    expect(t).not.toContain('trail_price');
    expect(t).toContain('stop=trailLvl');
  });
  it('risk sizing divides by the stop distance of whichever stops are on', () => {
    const atrStop = pineStrategyText(cand, { direction: 'both', risk: { ...base, stopMode: 'atr', stopAtrMult: 2, atrLength: 14, riskPct: 1 } });
    expect(atrStop).toContain('qty=strategy.equity * riskPct / 100 / (stopAtr * orderAtr)');
    const both = pineStrategyText(cand, { direction: 'both', risk: { ...base, stopLossPct: 3, trailMode: 'atr', trailAtrMult: 2, atrLength: 14, riskPct: 1 } });
    expect(both).toContain('/ math.min(close * stopPct / 100, trailAtr * orderAtr)');
    const trailOnly = pineStrategyText(cand, { direction: 'both', risk: { ...base, trailMode: 'pct', trailPct: 2, riskPct: 1 } });
    expect(trailOnly).toContain('/ (close * trailPct / 100)');
  });
  it('a risk-sized ATR script runs in the Pine runtime', async () => {
    const run: Run = { direction: 'both', risk: { ...base, stopMode: 'atr', stopAtrMult: 2, atrLength: 14, riskPct: 1 } };
    const out = await runPine(pineStrategyText(cand, run), sample);
    if (!out.ok) throw new Error(out.error.message);
    expect(out.trades.length).toBeGreaterThan(0);
    // The first trade is sized as equity * risk / (2 x ATR), as the engine sizes it.
    const engine = runBacktest(sample, buildSignals(sample, cand.strategyId, { ...cand.params, direction: DIR.both }), configFor(run)).trades;
    const first = [...out.trades].sort((a, b) => a.entryIndex - b.entryIndex)[0];
    expect(Math.abs(first.size / engine[0].qty - 1)).toBeLessThan(0.05);
  });
});

describe('composed has no Pine export', () => {
  it('is not offered, and its settings list shows only the visible ones', () => {
    expect(hasPine('composed')).toBe(false);
    const text = settingsPlain(
      { strategyId: 'composed', params: { entryRule: 2, direction: 1, fast: 12, slow: 26, trendFilter: 0, trendLen: 100 } },
      { direction: 'long', risk: risk() },
    );
    expect(text).toContain('Entry rule: EMA crossover');
    expect(text).not.toContain('Trend average length');
    expect(text).not.toContain('Oversold');
  });
});
