import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { candlesFromCsvText } from '../csv';
import { runPine } from '../pine/runtime';
import { defaultOptimizeConfig, runOptimizeAsync } from './optimizer';
import { INDICATOR_MESSAGE, runPineBacktest } from './pine';
import { runAnyBacktest } from './runner';
import { defaultBacktestConfig, type BacktestConfig } from './types';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const fixture = (name: string) => read(`../pine/fixtures/${name}.pine`);
const candles = candlesFromCsvText(read('../../../../examples/sample-daily.csv')).candles;

const cfg = (pineCode: string, patch: Partial<BacktestConfig> = {}): BacktestConfig => ({
  ...defaultBacktestConfig(),
  strategyId: 'pine',
  params: {},
  pineCode,
  feeBps: 0,
  ...patch,
});

describe('runPineBacktest', () => {
  for (const name of ['strategy-sma-cross', 'strategy-exit']) {
    it(`${name}: trades match runPine and equity ends at capital + pnl`, async () => {
      const pine = await runPine(fixture(name), candles);
      if (!pine.ok) throw new Error(pine.error.message);
      const r = await runPineBacktest(candles, cfg(fixture(name)));
      expect(r.trades).toHaveLength(pine.trades.length);
      expect(r.trades.length).toBeGreaterThan(0);
      const byEntry = [...pine.trades].sort((a, b) => a.entryIndex - b.entryIndex);
      r.trades.forEach((t, i) => {
        const p = byEntry[i];
        expect(t.entryBar).toBe(p.entryIndex);
        expect(t.entryPrice).toBe(p.entryPrice);
        expect(t.side).toBe(p.direction);
        if (p.exitIndex != null) {
          expect(t.exitBar).toBe(p.exitIndex);
          expect(t.exitPrice).toBe(p.exitPrice);
          expect(t.pnl).toBeCloseTo(p.profit!, 6);
          expect(t.exitReason).toBe('signal');
        } else {
          expect(t.exitReason).toBe('end_of_data');
          expect(t.exitBar).toBe(candles.length - 1);
          expect(t.exitPrice).toBe(candles[candles.length - 1].close);
        }
      });
      expect(r.equity).toHaveLength(candles.length);
      const sum = r.trades.reduce((a, t) => a + t.pnl, 0);
      expect(r.equity[r.equity.length - 1].equity).toBeCloseTo(10000 + sum, 6);
      expect(r.metrics.finalEquity).toBeCloseTo(10000 + sum, 6);
      for (const v of [r.metrics.totalReturnPct, r.metrics.maxDrawdownPct, r.metrics.exposurePct]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    });
  }

  it('input overrides change the trades', async () => {
    const src = `//@version=6
strategy("In", overlay=true)
len = input.int(10, "Fast")
slow = ta.sma(close, 30)
fast = ta.sma(close, len)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")`;
    const a = await runPineBacktest(candles, cfg(src));
    const b = await runPineBacktest(candles, cfg(src, { params: { Fast: 3 } }));
    expect(b.trades.map((t) => t.entryBar)).not.toEqual(a.trades.map((t) => t.entryBar));
  });

  it('script initial_capital and commission win over the panel', async () => {
    const body = `if bar_index % 30 == 0
    strategy.entry("L", strategy.long)
if bar_index % 30 == 10
    strategy.close("L")`;
    const plain = `//@version=6\nstrategy("S", overlay=true)\n${body}`;
    const scripted = `//@version=6\nstrategy("S", overlay=true, initial_capital=5000, commission_type=strategy.commission.percent, commission_value=0.1)\n${body}`;
    const panel = await runPineBacktest(candles, cfg(plain, { initialCapital: 20000, feeBps: 25 }));
    expect(panel.metrics.initialCapital).toBe(20000);
    expect(panel.config.feeBps).toBe(25);
    const t = panel.trades[0];
    expect(t.fees).toBeCloseTo(((t.entryPrice + t.exitPrice) * t.qty * 25) / 10000, 8);
    const script = await runPineBacktest(candles, cfg(scripted, { initialCapital: 20000, feeBps: 25 }));
    expect(script.metrics.initialCapital).toBe(5000);
    expect(script.config.feeBps).toBeCloseTo(10, 8);
    expect(script.trades[0].fees).toBeCloseTo(((t.entryPrice + t.exitPrice) * t.qty * 10) / 10000, 6);
    expect(script.buyHold).toHaveLength(script.equity.length);
    expect(script.buyHold[0]).toBe(5000);
    expect(panel.buyHold[0]).toBe(20000);
    const sum = script.trades.reduce((a, x) => a + x.pnl, 0);
    expect(script.equity[script.equity.length - 1].equity).toBeCloseTo(5000 + sum, 6);
  });

  it('rejects an indicator script', async () => {
    await expect(runPineBacktest(candles, cfg(fixture('ema-cross')))).rejects.toThrow(INDICATOR_MESSAGE);
  });

  it('rejects a syntax error with its line number', async () => {
    await expect(runPineBacktest(candles, cfg(fixture('syntax-error')))).rejects.toThrow(/\d+/);
    await expect(runAnyBacktest(candles, cfg(fixture('syntax-error')))).rejects.toThrow(/line \d+|at \d+:\d+/);
  });
});

describe('runOptimizeAsync over a Pine script', () => {
  it('2x2 sweep returns 4 ranked rows', async () => {
    const src = `//@version=6
strategy("In", overlay=true)
f = input.int(10, "Fast")
s = input.int(30, "Slow")
fast = ta.sma(close, f)
slow = ta.sma(close, s)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")`;
    const base = cfg(src);
    const progress: number[] = [];
    const out = await runOptimizeAsync(
      candles,
      base,
      {
        ...defaultOptimizeConfig(base),
        sweeps: [{ key: 'Fast', from: 5, to: 10, step: 5 }, { key: 'Slow', from: 20, to: 40, step: 20 }],
        metric: 'totalReturnPct',
      },
      (p) => progress.push(p),
    );
    expect(out.rows).toHaveLength(4);
    expect(out.errored).toBe(0);
    const vals = out.rows.map((r) => r.value as number);
    expect([...vals].sort((a, b) => b - a)).toEqual(vals);
    expect(progress[progress.length - 1]).toBe(1);
    expect(out.keys).toEqual(['Fast', 'Slow']);
    for (const row of out.rows) {
      expect(Object.keys(row.params)).toEqual(['Fast', 'Slow']);
      const single = await runAnyBacktest(candles, { ...base, params: { ...base.params, ...row.params } });
      expect(row.metrics).toEqual(single.metrics);
    }
  });
});

describe('runPineBacktest progress', () => {
  it('reports pine then metrics, non-decreasing, ends at 1, same result as without a callback', async () => {
    const config = cfg(fixture('strategy-sma-cross'));
    const calls: [number, string][] = [];
    const withCb = await runAnyBacktest(candles, config, (p, s) => calls.push([p, s]));
    const without = await runAnyBacktest(candles, config);
    expect(withCb).toEqual(without);
    expect(calls[0]).toEqual([0, 'pine']);
    expect(calls[calls.length - 1]).toEqual([1, 'metrics']);
    for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
    expect(calls.filter(([, s]) => s === 'pine').every(([p]) => p <= 0.9)).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(110);
  });
});
