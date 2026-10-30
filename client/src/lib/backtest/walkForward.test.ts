import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { MAX_GRID_COMBOS, runOptimizeAsync, type OptimizeConfig } from './optimizer';
import { runFullBacktest } from './runner';
import { defaultBacktestConfig, type EquityPoint, type Metrics } from './types';
import { runValidatedOptimize, totalBacktests, validationProblem } from './validation';
import {
  combineWalkForward,
  runWalkForward,
  stitchEquity,
  walkForwardProblem,
  walkForwardWindows,
  type WalkForwardConfig,
  type WalkForwardWindow,
} from './walkForward';

function series(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + i * 0.05;
    return { time: 1_600_000_000 + i * 86400, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 };
  });
}
const wf = (windows: number, inSamplePct: number, anchored = false): WalkForwardConfig => ({ method: 'walk-forward', windows, inSamplePct, anchored });
const base = defaultBacktestConfig();
const opt = (cfg: WalkForwardConfig, patch: Partial<OptimizeConfig> = {}): OptimizeConfig => ({
  sweeps: [{ key: 'fast', from: 5, to: 8, step: 1 }],
  metric: 'totalReturnPct',
  validation: cfg,
  ...patch,
});

describe('walkForwardWindows', () => {
  it('n=100, 5 windows, 70%: blocks start at 35, 48, 61, 74, 87', () => {
    const w = walkForwardWindows(100, wf(5, 70));
    expect(w.map((x) => x.heldOut)).toEqual([
      { from: 35, to: 48 }, { from: 48, to: 61 }, { from: 61, to: 74 }, { from: 74, to: 87 }, { from: 87, to: 100 },
    ]);
    expect(w[0].inSample).toEqual({ from: 0, to: 35 });
    expect(w[4].inSample).toEqual({ from: 52, to: 87 });
    expect(walkForwardWindows(100, wf(5, 70, true))[4].inSample).toEqual({ from: 0, to: 87 });
  });

  it('n=103, 3 windows, 80%: oosLen 14 (floor(103 / 7)), isLen 61', () => {
    // 80/20 = 4, so 103 / 7 = 14.7 -> 14; isLen = 103 - 42 = 61
    const w = walkForwardWindows(103, wf(3, 80));
    expect(w.map((x) => x.heldOut)).toEqual([{ from: 61, to: 75 }, { from: 75, to: 89 }, { from: 89, to: 103 }]);
    expect(w[1].inSample).toEqual({ from: 14, to: 75 });
    expect(walkForwardWindows(103, wf(3, 80, true))[1].inSample).toEqual({ from: 0, to: 75 });
  });

  it.each([100, 103])('held-out blocks are contiguous, do not overlap and end at the last bar (n=%i)', (n) => {
    for (const k of [2, 3, 5]) {
      for (const p of [70, 80]) {
        for (const anchored of [false, true]) {
          const w = walkForwardWindows(n, wf(k, p, anchored));
          expect(w).toHaveLength(k);
          expect(w[k - 1].heldOut.to).toBe(n);
          for (let i = 1; i < k; i++) expect(w[i].heldOut.from).toBe(w[i - 1].heldOut.to);
          for (const x of w) {
            expect(x.inSample.to).toBe(x.heldOut.from);
            expect(x.heldOut.to - x.heldOut.from).toBe(w[0].heldOut.to - w[0].heldOut.from);
          }
          if (!anchored) for (const x of w) expect(x.inSample.to - x.inSample.from).toBe(w[0].inSample.to);
        }
      }
    }
  });
});

describe('walkForwardProblem', () => {
  it('accepts a valid setting', () => {
    expect(walkForwardProblem(wf(5, 70), 100)).toBeNull();
    expect(validationProblem(wf(5, 70), 100)).toBeNull();
  });
  it('refuses out-of-range and fractional settings', () => {
    for (const k of [1, 21, 2.5, NaN]) expect(walkForwardProblem(wf(k, 70), 300)).toMatch(/Windows/);
    for (const p of [49, 96, 70.5, NaN]) expect(walkForwardProblem(wf(5, p), 300)).toMatch(/In-sample %/);
    expect(validationProblem(wf(1, 70), 300)).toMatch(/Windows/);
  });
  it('names the part under 3 bars and its size', () => {
    // 20 bars, 5 windows, 70%: oosLen 2, isLen 10
    expect(walkForwardProblem(wf(5, 70), 20)).toBe('Held-out part has 2 bars; it needs at least 3');
    // 4 windows at 95% on 30 bars: oosLen floor(30 / (4 + 19)) = 1
    expect(walkForwardProblem(wf(4, 95), 30)).toBe('Held-out part has 1 bars; it needs at least 3');
    expect(walkForwardProblem(wf(2, 50), 5)).toBe('Held-out part has 1 bars; it needs at least 3');
    // 20 windows at 50% on 100 bars: oosLen 4, isLen 20 - fine
    expect(walkForwardProblem(wf(20, 50), 100)).toBeNull();
    // the in-sample part is at least as long as a held-out block, so the held-out check is the one that trips
    expect(walkForwardProblem(wf(20, 50), 60)).toBe('Held-out part has 2 bars; it needs at least 3');
  });
});

describe('stitchEquity', () => {
  const pt = (time: number, equity: number): EquityPoint => ({ time, equity, drawdownPct: 0, position: 0 });
  const parts = [
    [pt(1, 100), pt(2, 120), pt(3, 110)],
    [pt(4, 100), pt(5, 90), pt(6, 105)],
    [pt(7, 100), pt(8, 130), pt(9, 80)],
  ];
  const out = stitchEquity(parts, 100);
  it('scales each window by the earlier windows final / initial ratios', () => {
    expect(out.map((p) => p.equity).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([100, 120, 110, 110, 99, 115.5, 115.5, 150.15, 92.4]);
    expect(out.map((p) => p.time)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('recomputes the drawdown with the peak carried across windows', () => {
    const dd = out.map((p) => p.drawdownPct);
    expect(dd[2]).toBeCloseTo((110 / 120 - 1) * 100, 9);
    expect(dd[4]).toBeCloseTo((99 / 120 - 1) * 100, 9); // spans the boundary: peak 120 is in window 1
    expect(dd[7]).toBe(0);
    expect(dd[8]).toBeCloseTo((92.4 / 150.15 - 1) * 100, 9);
    expect(Math.min(...dd)).toBeCloseTo((92.4 / 150.15 - 1) * 100, 9);
  });
});

describe('combineWalkForward', () => {
  const m = (over: Partial<Metrics>): Metrics => ({ ...runFullBacktest(series(30), base).metrics, ...over });
  const win = (i: number, inCagr: number | null, outCagr: number | null, ret: number, trades: number): WalkForwardWindow => ({
    index: i,
    inSample: { from: 0, to: 1, bars: 1 },
    heldOut: { from: 1, to: 2, bars: 1 },
    status: 'ok',
    params: { fast: 5 },
    inSampleMetrics: m({ cagrPct: inCagr }),
    inSampleValue: 1,
    heldOutMetrics: m({ cagrPct: outCagr, totalReturnPct: ret, trades }),
    heldOutValue: 1,
  });
  it('multiplies the window returns, sums trades and divides the CAGR means', () => {
    const c = combineWalkForward([win(1, 20, 10, 10, 3), win(2, 40, 20, -5, 4), win(3, 30, 0, 5, 1)], []);
    expect(c.totalReturnPct).toBeCloseTo((1.1 * 0.95 * 1.05 - 1) * 100, 9);
    expect(c.trades).toBe(8);
    expect(c.efficiency).toBeCloseTo(10 / 30, 9);
  });
  it('efficiency is n/a when a CAGR is missing or the in-sample mean is not positive', () => {
    expect(combineWalkForward([win(1, 20, null, 1, 1), win(2, 20, 5, 1, 1)], []).efficiency).toBeNull();
    expect(combineWalkForward([win(1, null, 5, 1, 1)], []).efficiency).toBeNull();
    expect(combineWalkForward([win(1, -10, 5, 1, 1), win(2, 10, 5, 1, 1)], []).efficiency).toBeNull();
  });
});

describe('runWalkForward', () => {
  const candles = series(300);
  const cfg = wf(3, 70);

  for (const anchored of [false, true]) {
    it(`each window equals single runs (${anchored ? 'anchored' : 'rolling'})`, async () => {
      const c = { ...cfg, anchored };
      const o = opt(c);
      const { walkForward: w, grid } = await runWalkForward(candles, base, o, c);
      const ranges = walkForwardWindows(candles.length, c);
      expect(w.results).toHaveLength(3);
      for (const [i, r] of ranges.entries()) {
        const inBars = candles.slice(r.inSample.from, r.inSample.to);
        const outBars = candles.slice(r.heldOut.from, r.heldOut.to);
        const g = await runOptimizeAsync(inBars, base, o);
        const winner = g.rows.find((x) => x.value != null)!;
        expect(w.results[i].params).toEqual(winner.params);
        expect(w.results[i].inSampleMetrics).toEqual(winner.metrics);
        expect(w.results[i].inSample).toEqual({ from: inBars[0].time, to: inBars[inBars.length - 1].time, bars: inBars.length });
        expect(w.results[i].heldOut).toEqual({ from: outBars[0].time, to: outBars[outBars.length - 1].time, bars: outBars.length });
        expect(w.results[i].heldOutMetrics).toEqual(runFullBacktest(outBars, { ...base, params: { ...base.params, ...winner.params } }).metrics);
        if (i === 2) expect(grid.rows).toEqual(g.rows);
      }
      const product = w.results.reduce((a, r) => a * (1 + r.heldOutMetrics!.totalReturnPct / 100), 1);
      expect(w.combined!.totalReturnPct).toBeCloseTo((product - 1) * 100, 9);
      expect(w.combined!.trades).toBe(w.results.reduce((a, r) => a + r.heldOutMetrics!.trades, 0));
      const last = w.equity[w.equity.length - 1];
      expect(last.equity / base.initialCapital - 1).toBeCloseTo(product - 1, 9);
      expect(w.equity[w.equity.length - 1].time).toBe(candles[candles.length - 1].time);
      expect(w.incomplete).toBe(0);
    });
  }

  it('reports monotonic progress ending at 1', async () => {
    const seen: number[] = [];
    await runWalkForward(candles, base, opt(cfg), cfg, (p) => seen.push(p));
    expect(seen.length).toBeGreaterThan(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('refuses a total over MAX_GRID_COMBOS before any backtest', async () => {
    const big = opt(cfg, { sweeps: [{ key: 'fast', from: 1, to: 40_000, step: 1 }] });
    expect(totalBacktests(big)).toBe(3 * 40_000 + 3);
    expect(3 * 40_000 + 3).toBeGreaterThan(MAX_GRID_COMBOS);
    await expect(runWalkForward(candles, base, big, cfg)).rejects.toThrow(/limit is 100000/);
    await expect(runValidatedOptimize(candles, base, big)).rejects.toThrow(/limit is 100000/);
  });

  it('runValidatedOptimize returns the last window grid with the walk-forward beside it', async () => {
    const out = await runValidatedOptimize(candles, base, opt(cfg));
    expect(out.validation).toBeUndefined();
    expect(out.walkForward?.windows).toBe(3);
    expect(out.rows).toHaveLength(4);
  });

  it('rejects an invalid setting', async () => {
    await expect(runWalkForward(candles, base, opt(wf(1, 70)), wf(1, 70))).rejects.toThrow(/Windows/);
  });
});
