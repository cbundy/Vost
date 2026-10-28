import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { candlesFromCsvText } from '../csv';
import { bollinger, ema, macd, rsi } from '../indicators';
import { convertToV6 } from './convert';
import { runPine } from './runtime';
import type { PineResult } from './types';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const fixture = (name: string) => read(`./fixtures/${name}.pine`);
const candles = candlesFromCsvText(read('../../../../examples/sample-daily.csv')).candles;
const closes = candles.map((c) => c.close);

async function ok(name: string, inputs?: Record<string, number>): Promise<PineResult> {
  const r = await runPine(fixture(name), candles, inputs);
  if (!r.ok) throw new Error(r.error.message);
  return r;
}

/** Compare after warm-up: every bar where both series are defined must match; require a minimum count. */
function expectParity(actual: (number | null)[], expected: (number | null)[], minCompared: number) {
  expect(actual).toHaveLength(expected.length);
  let compared = 0;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    if (e === null || a === null) continue;
    expect(Math.abs(a - e)).toBeLessThan(1e-6);
    compared++;
  }
  expect(compared).toBeGreaterThanOrEqual(minCompared);
}

describe('runPine indicators', () => {
  it('EMA cross: plots align 1:1 and match ema()', async () => {
    const r = await ok('ema-cross');
    expect(r.kind).toBe('indicator');
    expect(r.declaration).toEqual({ title: 'EMA Cross', overlay: true });
    expect(r.inputs.map((i) => [i.name, i.type, i.defval])).toEqual([
      ['Fast', 'int', 9],
      ['Slow', 'int', 21],
    ]);
    expect(r.plots.map((p) => p.name)).toEqual(['Fast', 'Slow']);
    for (const p of r.plots) {
      expect(p.values).toHaveLength(candles.length);
      expect(p.pane).toBe('price');
    }
    expect(r.plots[0].color).toBeTruthy();
    expect(r.plots[0].values[0]).toBeNull();
    expectParity(r.plots[0].values, ema(closes, 9), 100);
    expectParity(r.plots[1].values, ema(closes, 21), 100);
  });

  it('MACD matches macd()', async () => {
    const r = await ok('macd');
    const m = macd(closes, 12, 26, 9);
    expect(r.declaration.overlay).toBe(false);
    expect(r.plots.every((p) => p.pane === 'separate')).toBe(true);
    expect(r.plots[2].style).toBe('histogram');
    expectParity(r.plots[0].values, m.macd, 100);
    expectParity(r.plots[1].values, m.signal, 100);
    expectParity(r.plots[2].values, m.histogram, 100);
  });

  it('RSI uses input.int default and accepts an override', async () => {
    const r = await ok('rsi');
    expect(r.inputs[0]).toMatchObject({ name: 'Length', type: 'int', defval: 14, minval: 1 });
    expectParity(r.plots[0].values, rsi(closes, 14), 100);
    const r7 = await ok('rsi', { Length: 7 });
    expectParity(r7.plots[0].values, rsi(closes, 7), 100);
  });

  it('Bollinger Bands match bollinger()', async () => {
    const r = await ok('bollinger');
    const b = bollinger(closes, 20, 2);
    expect(r.inputs.map((i) => i.defval)).toEqual([20, 2]);
    expectParity(r.plots[0].values, b.middle, 100);
    expectParity(r.plots[1].values, b.upper, 100);
    expectParity(r.plots[2].values, b.lower, 100);
  });
});

describe('runPine strategies', () => {
  it('SMA cross produces long trades and a consistent position series', async () => {
    const r = await ok('strategy-sma-cross');
    expect(r.kind).toBe('strategy');
    expect(r.trades.length).toBeGreaterThan(0);
    expect(r.trades.every((t) => t.direction === 'long')).toBe(true);
    expect(r.position).toHaveLength(candles.length);
    const t = r.trades.find((x) => x.exitIndex !== null && x.exitIndex > x.entryIndex)!;
    expect(t.exitTime).toBe(candles[t.exitIndex!].time);
    expect(r.position[t.entryIndex]).toBe(t.size);
    expect(r.position[t.exitIndex!]).toBe(0);
    expect(r.plots).toHaveLength(2);
  });

  it('strategy.exit stop/limit closes trades at the bracket prices', async () => {
    const r = await ok('strategy-exit');
    const closed = r.trades.filter((t) => t.exitIndex !== null);
    expect(closed.length).toBeGreaterThan(0);
    for (const t of closed) {
      expect(t.exitId).toBe('Exit');
      const ratio = t.exitPrice! / t.entryPrice;
      expect(ratio > 1 ? ratio : 1 / ratio).toBeLessThan(1.011);
      expect(Math.abs(t.exitPrice! - t.entryPrice)).toBeGreaterThan(0);
    }
  });

  it('maps short trades to direction short with negative position', async () => {
    const src = `//@version=6
strategy("Short")
if bar_index == 5
    strategy.entry("S", strategy.short)
if bar_index == 10
    strategy.close("S")`;
    const r = await runPine(src, candles);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.trades[0].direction).toBe('short');
    expect(r.position[7]).toBeLessThan(0);
  });
});

describe('runPine errors', () => {
  it('syntax error resolves to ok:false with line and column', async () => {
    const r = await runPine(fixture('syntax-error'), candles);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Failed to transpile/);
    expect(r.error.line).toBeGreaterThan(0);
    expect(r.error.column).toBeGreaterThan(0);
  });

  it('runtime error resolves to ok:false', async () => {
    const r = await runPine('//@version=6\nindicator("x")\nplot(foo)', candles);
    expect(r.ok).toBe(false);
  });

  it('a script with no version line gets a plain message, not a parser error', async () => {
    const r = await runPine(fixture('legacy-wavetrend'), candles);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/no \/\/@version line/);
    expect(r.error.message).not.toMatch(/Unexpected token/);
    expect(r.error.line).toBeUndefined();
  });

  it('versions 1 to 4 name the version', async () => {
    const r = await runPine(`//@version=4\n${fixture('legacy-wavetrend')}`, candles);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toBe('This is a Pine v4 script. Vost runs Pine v5 and v6: use Convert to v6.');
    expect(r.error.line).toBeUndefined();
  });

  it('versions 5 and 6 still run', async () => {
    expect((await runPine('//@version=5\nindicator("a")\nplot(close)', candles)).ok).toBe(true);
    expect((await runPine('//@version=6\nindicator("a")\nplot(close)', candles)).ok).toBe(true);
  });

  it('empty candles resolve to ok:false', async () => {
    expect((await runPine(fixture('rsi'), [])).ok).toBe(false);
  });
});

describe('convertToV6 end to end', () => {
  it('the converted legacy script runs and draws the same lines as the hand-written v6 one', async () => {
    const converted = convertToV6(fixture('legacy-wavetrend'));
    expect(converted.notes).toEqual([]);
    const a = await runPine(converted.code, candles);
    const b = await ok('wavetrend-v6');
    if (!a.ok) throw new Error(a.error.message);
    expect(a.plots).toHaveLength(b.plots.length);
    const lines = a.plots.map((p, i) => [p, b.plots[i]] as const).filter(([p]) => p.style !== 'barcolor'); // PineTS reports barcolor() as a plot
    expect(lines).toHaveLength(10);
    for (const [p, q] of lines) expectParity(p.values, q.values, 1);
    expectParity(a.plots[5].values, b.plots[5].values, 100);
  });
});
