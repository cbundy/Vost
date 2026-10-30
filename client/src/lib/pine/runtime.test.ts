import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { candlesFromCsvText } from '../csv';
import { bollinger, ema, macd, rsi } from '../indicators';
import { logicalToTime } from '../drawingGeometry';
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

  it('runtime.error stops the run with its message', async () => {
    const r = await runPine('//@version=6\nindicator("x")\nif bar_index == 3\n    runtime.error("boom")\nplot(close)', candles);
    expect(r).toEqual({ ok: false, error: { message: 'boom' } });
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

describe('runPine library imports', () => {
  const INNER = '//@version=6\nlibrary("Inner")\nexport double(float x) => x * 2\n';
  const OUTER = '//@version=6\nlibrary("Outer")\nimport bob/Inner/1 as inner\nexport plusOne(float x) => inner.double(x) + 1\n';
  const libs: Record<string, string> = { 'alice/Outer/1': OUTER, 'bob/Inner/1': INNER };
  const resolver = (p: string) => libs[p] ?? null;
  const script = '//@version=6\nindicator("uses lib")\nimport alice/Outer/1 as o\nplot(o.plusOne(close))\n';

  it('runs a script through a library that imports another library', async () => {
    const r = await runPine(script, candles, {}, { resolver });
    if (!r.ok) throw new Error(r.error.message);
    const plot = r.plots[0].values;
    expect(plot.slice(0, 5)).toEqual(closes.slice(0, 5).map((c) => c * 2 + 1));
  });

  it('a missing library gives a plain error that names it', async () => {
    const r = await runPine(script, candles, {}, { resolver: () => null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.library).toBe('alice/Outer/1');
    expect(r.error.message).toMatch(/^Library "alice\/Outer\/1" could not be loaded/);
  });

  it('a library that imports a missing library names the inner one', async () => {
    const r = await runPine(script, candles, {}, { resolver: (p) => (p === 'alice/Outer/1' ? OUTER : null) });
    if (r.ok) throw new Error('should fail');
    expect(r.error.library).toBe('bob/Inner/1');
  });

  it('with no resolver and no location the message says there is no Vost server', async () => {
    const r = await runPine(script, candles);
    if (r.ok) throw new Error('should fail');
    expect(r.error.library).toBe('alice/Outer/1');
    expect(r.error.message).toContain('no Vost server');
  });

  it('a strategy that imports a library still returns trades, and inputs are still reported', async () => {
    const src = [
      '//@version=6',
      'strategy("lib strat", overlay=true, initial_capital=10000)',
      'import bob/Inner/1 as inner',
      'len = input.int(10, "Len")',
      'ma = ta.sma(inner.double(close) / 2, len)',
      'if ta.crossover(close, ma)',
      '    strategy.entry("L", strategy.long)',
      'if ta.crossunder(close, ma)',
      '    strategy.close("L")',
    ].join('\n');
    const r = await runPine(src, candles, { Len: 5 }, { resolver });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.kind).toBe('strategy');
    expect(r.trades.length).toBeGreaterThan(0);
    expect(r.inputs.map((i) => i.name)).toEqual(['Len']);
  });
});

describe('runPine with onProgress (paged run)', () => {
  const names = ['strategy-sma-cross', 'strategy-exit', 'ema-cross', 'macd', 'rsi', 'bollinger', 'overlays', 'wavetrend-v6'];
  for (const name of names) {
    it(`${name}: paged outcome deep-equals the unpaged one; progress is non-decreasing and ends at 1`, async () => {
      const plain = await runPine(fixture(name), candles);
      const calls: number[] = [];
      const paged = await runPine(fixture(name), candles, {}, { onProgress: (p) => calls.push(p) });
      expect(plain.ok).toBe(true);
      expect(paged).toEqual(plain);
      expect(calls.length).toBeGreaterThan(1);
      expect(calls.length).toBeLessThanOrEqual(110);
      expect(calls[calls.length - 1]).toBe(1);
      for (let i = 1; i < calls.length; i++) expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1]);
    });
  }
});

describe('runPine fill', () => {
  it('rsi-band: one fill joining the two hlines in the separate pane', async () => {
    const r = await ok('rsi-band');
    const fills = r.plots.filter((p) => p.kind === 'fill');
    expect(fills).toHaveLength(1);
    const f = fills[0];
    expect(f.pane).toBe('separate');
    expect(r.plots[f.plot1!].name).toBe('Upper');
    expect(r.plots[f.plot2!].name).toBe('Lower');
    expect(r.plots[f.plot1!].kind).toBe('hline');
    expect(f.color).toBe('#9C27B01A');
    expect(f.values.every((v) => v === null)).toBe(true);
    // no empty line plot named after the fill remains
    expect(r.plots.filter((p) => p.kind === 'plot' && p.values.every((v) => v === null))).toEqual([]);
  });

  it('cloud: one fill joining the two SMAs on the price pane with varying colors', async () => {
    const r = await ok('cloud');
    const fills = r.plots.filter((p) => p.kind === 'fill');
    expect(fills).toHaveLength(1);
    const f = fills[0];
    expect(f.pane).toBe('price');
    expect(r.plots[f.plot1!].name).toBe('Fast');
    expect(r.plots[f.plot2!].name).toBe('Slow');
    expect(new Set((f.colors ?? []).filter((c) => c !== null)).size).toBe(2);
  });

  it('drops a gradient fill', async () => {
    const grad = await runPine(
      '//@version=6\nindicator("g", overlay=true)\np1 = plot(close)\np2 = plot(open)\nfill(p1, p2, close, open, color.green, color.red)\n',
      candles,
    );
    if (!grad.ok) throw new Error(grad.error.message);
    expect(grad.plots.map((p) => p.kind)).toEqual(['plot', 'plot']);
  });

  it('drops a fill whose plot cannot be resolved', async () => {
    const r = await runPine(
      '//@version=6\nindicator("u", overlay=true)\np1 = plot(close, "__x")\np2 = plot(open)\nfill(p1, p2, color.red)\n',
      candles,
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.plots.some((p) => p.kind === 'fill')).toBe(false);
    expect(r.plots.length).toBeGreaterThan(0);
  });

  it('drops a fill joining plots in different panes', async () => {
    const r = await runPine(
      '//@version=6\nindicator("x", overlay=false)\np1 = plot(close, force_overlay=true)\np2 = plot(ta.rsi(close, 14))\nfill(p1, p2, color.red)\n',
      candles,
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.plots.map((p) => p.pane)).toEqual(['price', 'separate']);
    expect(r.plots.some((p) => p.kind === 'fill')).toBe(false);
  });
});

describe('runPine market context', () => {
  const hourly = Array.from({ length: 40 }, (_, i) => ({
    time: 1_700_000_000 + i * 3600, open: 100.25 + i, high: 102.5 + i, low: 99.1 + i, close: 101.05 + i, volume: 10,
  }));
  const twoHour = hourly.filter((_, i) => i % 2 === 0).map((c, i) => ({ ...c, time: 1_700_000_000 + i * 7200 }));
  const binance = (interval: string) => ({ providerId: 'binance', symbol: 'BTCUSDT', interval });
  const last = (r: Awaited<ReturnType<typeof runPine>>, name: string) => {
    if (!r.ok) throw new Error(r.error.message);
    return r.plots.find((p) => p.name === name)!.values.at(-1);
  };
  const info = [
    '//@version=6',
    'indicator("info")',
    'plot(timeframe.in_seconds(), "secs")',
    'plot(timeframe.isintraday ? 1 : 0, "intraday")',
    'plot(syminfo.mintick, "tick")',
    'plot(syminfo.tickerid == "BINANCE:BTCUSDT" ? 1 : 0, "id")',
    'plot(math.round_to_mintick(close), "rounded")',
  ].join('\n');

  it('shows the chart timeframe and symbol on 1h and 2h candles', async () => {
    const a = await runPine(info, hourly, {}, { market: binance('1h') });
    expect(last(a, 'secs')).toBe(3600);
    expect(last(a, 'intraday')).toBe(1);
    expect(last(a, 'tick')).toBe(0.01);
    expect(last(a, 'id')).toBe(1);
    expect(last(a, 'rounded')).toBeCloseTo(hourly.at(-1)!.close, 6);
    const b = await runPine(info, twoHour, {}, { market: binance('2h') });
    expect(last(b, 'secs')).toBe(7200);
  });

  it('takes the timeframe from the candle spacing without a market', async () => {
    expect(last(await runPine(info, hourly), 'secs')).toBe(3600);
    expect(last(await runPine(info, hourly), 'id')).toBe(0);
  });

  it('a daily market is not intraday', async () => {
    expect(last(await runPine(info, hourly, {}, { market: binance('1d') }), 'intraday')).toBe(0);
  });

  it('fails a request for another symbol with a message naming it, and for another timeframe the feed cannot serve', async () => {
    const feed = { bars: async () => { throw new Error('HTTP 503'); } };
    const tf = await runPine('//@version=6\nindicator("a")\nplot(request.security(syminfo.tickerid, "D", close))', hourly, {}, { market: binance('1h'), feed });
    expect(tf.ok).toBe(false);
    if (!tf.ok) expect(tf.error.message).toMatch(/BTCUSDT.*D.*HTTP 503/);
    const sym = await runPine('//@version=6\nindicator("a")\nplot(request.security("ETHUSDT", timeframe.period, close))', hourly, {}, { market: binance('1h'), feed });
    expect(sym.ok).toBe(false);
    // ETHUSDT is read from the chart's provider now, so the failed fetch names it with its prefix.
    if (!sym.ok) expect(sym.error.message).toContain('request.security(BINANCE:ETHUSDT, 60): could not load 60 bars of BINANCE:ETHUSDT: HTTP 503');
  });

  it('a same-symbol, same-timeframe request equals the chart series', async () => {
    const r = await runPine(
      '//@version=6\nindicator("a")\nplot(request.security(syminfo.tickerid, timeframe.period, close), "sec")',
      hourly, {}, { market: binance('1h') },
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.plots[0].values).toEqual(hourly.map((c) => c.close));
  });

  it('time_close of a bar before a gap is open plus the interval', async () => {
    const gapped = [...hourly.slice(0, 5), ...hourly.slice(10, 15)];
    const r = await runPine('//@version=6\nindicator("a")\nplot(time_close - time, "len")', gapped, {}, { market: binance('1h') });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.plots[0].values[4]).toBe(3600 * 1000 - 1);
  });
});

describe('runPine candle, bar, barcolor and arrow plots', () => {
  const run = async (src: string) => {
    const r = await runPine(`//@version=5\n${src}`, candles);
    if (!r.ok) throw new Error(r.error.message);
    return r;
  };

  it('plotcandle: kind candle, ohlc 1:1 with the candles, per-bar colors', async () => {
    const r = await run(
      'indicator("c", overlay=false)\nplotcandle(open, high, low, na(close[1]) ? na : close, title="C", color=close > open ? color.green : color.red, wickcolor=color.gray, bordercolor=color.blue)',
    );
    const p = r.plots[0];
    expect(p.kind).toBe('candle');
    expect(p.pane).toBe('separate');
    expect(p.ohlc).toHaveLength(candles.length);
    expect(p.ohlc![0]).toBeNull(); // na close on the first bar
    const c = candles[5];
    expect(p.ohlc![5]).toEqual([c.open, c.high, c.low, c.close]);
    expect(p.values[5]).toBe(c.close);
    expect(p.values[0]).toBeNull();
    expect(new Set(p.colors!.filter((x) => x !== null)).size).toBeGreaterThan(1);
    expect(p.wickColors![5]).toBeTruthy();
    expect(p.borderColors![5]).toBeTruthy();
  });

  it('plotbar: kind bar', async () => {
    const r = await run('indicator("b", overlay=true)\nplotbar(open, high, low, close, title="B", color=color.orange)');
    expect(r.plots[0].kind).toBe('bar');
    expect(r.plots[0].pane).toBe('price');
    expect(r.plots[0].ohlc![3]).toEqual([candles[3].open, candles[3].high, candles[3].low, candles[3].close]);
  });

  it('barcolor: kind barcolor with colors where the condition holds', async () => {
    const r = await run('indicator("bc", overlay=true)\nbarcolor(close > open ? color.blue : na)');
    const p = r.plots[0];
    expect(p.kind).toBe('barcolor');
    candles.forEach((c, i) => {
      if (c.close > c.open) {
        expect(p.values[i]).toBe(1);
        expect(p.colors?.[i] ?? p.color).toBeTruthy();
      } else {
        expect(p.values[i]).toBeNull();
      }
    });
  });

  it('plotarrow: kind plotarrow with signed numbers; plotshape(arrowup) stays plotshape', async () => {
    const r = await run(
      'indicator("a", overlay=true)\nplotarrow(close - open, title="A", colorup=color.green, colordown=color.red, maxheight=50)\nplotshape(close > open, title="S", style=shape.arrowup)',
    );
    expect(r.plots.map((p) => p.kind)).toEqual(['plotarrow', 'plotshape']);
    const p = r.plots[0];
    expect(p.maxHeight).toBe(50);
    expect(p.minHeight).toBe(5);
    candles.forEach((c, i) => {
      if (c.close !== c.open) expect(p.values[i]).toBeCloseTo(c.close - c.open, 6);
    });
    expect(p.values.some((v) => v !== null && v > 0)).toBe(true);
    expect(p.values.some((v) => v !== null && v < 0)).toBe(true);
  });
});

describe('runPine plot options', () => {
  const style = async (code: string) => {
    const r = await runPine(`//@version=6\nindicator("s", overlay=true)\n${code}`, candles);
    if (!r.ok) throw new Error(r.error.message);
    return r;
  };

  it('reads linewidth, offset, style, histbase, text, size, char and linestyle', async () => {
    const r = await style([
      'plot(close, "Step", linewidth=3, offset=2, style=plot.style_stepline)',
      'plot(close, "Area", style=plot.style_area, histbase=100)',
      'plot(close, "Cols", style=plot.style_columns, linewidth=4)',
      'plotshape(close > open, "Sh", text="Up", size=size.small)',
      'plotchar(close > open, "Ch", char="X", size=size.tiny)',
      'plotchar(close > open, "Em", char="\u{1F680}", offset=-1)',
      'plotchar(close > open, "Def")',
      'hline(100, "H", linestyle=hline.style_dotted, linewidth=2)',
    ].join('\n'));
    const by = Object.fromEntries(r.plots.map((p) => [p.name, p]));
    expect(by.Step).toMatchObject({ lineWidth: 3, offset: 2, style: 'stepline' });
    expect(by.Area).toMatchObject({ style: 'area', histbase: 100 });
    expect(by.Cols).toMatchObject({ style: 'columns', lineWidth: 4 });
    expect(by.Sh).toMatchObject({ kind: 'plotshape', text: 'Up', size: 'small' });
    expect(by.Sh.char).toBeUndefined();
    expect(by.Ch).toMatchObject({ kind: 'plotshape', char: 'X', size: 'tiny' });
    expect(by.Em.char).toBe('\u{1F680}');
    expect(by.Def.char).toBe('\u2605');
    expect(by.H).toMatchObject({ kind: 'hline', lineStyle: 'dotted', lineWidth: 2 });
    expect(by.Area.lineWidth).toBeUndefined();
  });

  it('offset shifts the values right, dropping what passes the last bar; negative shifts left', async () => {
    const r = await style('plot(close, "A")\nplot(close, "B", offset=2)\nplot(close, "C", offset=-3)');
    const [a, b, c] = r.plots.map((p) => p.values);
    const n = candles.length;
    expect(b.slice(0, 2)).toEqual([null, null]);
    expect(b.slice(2)).toEqual(a.slice(0, n - 2));
    expect(b).toHaveLength(n);
    expect(c.slice(0, n - 3)).toEqual(a.slice(3));
    expect(c.slice(n - 3)).toEqual([null, null, null]);
  });

  it('offset shifts bgcolor colors and plotcandle ohlc', async () => {
    const r = await style([
      'bgcolor(close > open ? color.green : na, title="Bg", offset=1)',
      'bgcolor(close > open ? color.green : na, title="Bg0")',
      'plotcandle(open, high, low, close, title="Cn", offset=1)',
      'plotcandle(open, high, low, close, title="Cn0")',
    ].join('\n'));
    const by = Object.fromEntries(r.plots.map((p) => [p.name, p]));
    expect(by.Bg.values[0]).toBeNull();
    expect(by.Bg.values.slice(1)).toEqual(by.Bg0.values.slice(0, -1));
    expect(by.Cn.ohlc![0]).toBeNull();
    expect(by.Cn.ohlc!.slice(1)).toEqual(by.Cn0.ohlc!.slice(0, -1));
    expect(by.Cn.ohlc![1]).toEqual([candles[0].open, candles[0].high, candles[0].low, candles[0].close]);
  });
});

describe('runPine messages', () => {
  const cross = `//@version=6
indicator("Msg", overlay=true)
fast = ta.sma(close, 3)
slow = ta.sma(close, 8)
up = ta.crossover(fast, slow)
if up
    alert("crossed up", alert.freq_once_per_bar_close)
alertcondition(up, "Cross up", "fast crossed slow")
alertcondition(close < 0, "Never", "never")
plot(fast)`;
  const crossTimes = () => {
    const f = ema(closes, 1); void f;
    const sma = (n: number, i: number) => (i < n - 1 ? null : closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n);
    const out: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const [f0, s0, f1, s1] = [sma(3, i - 1), sma(8, i - 1), sma(3, i), sma(8, i)];
      if (f0 !== null && s0 !== null && f1 !== null && s1 !== null && f0 <= s0 && f1 > s1) out.push(candles[i].time);
    }
    return out;
  };
  const run = async (src: string, opts = {}) => {
    const r = await runPine(src, candles, {}, opts);
    if (!r.ok) throw new Error(r.error.message);
    return r;
  };

  it('lists alerts on every bar, not only the last', async () => {
    const m = (await run(cross)).messages!;
    const times = crossTimes();
    expect(times.length).toBeGreaterThan(1);
    expect(m.alerts.map((a) => a.time)).toEqual(times);
    expect(m.alerts[0]).toMatchObject({ message: 'crossed up', frequency: 'once_per_bar_close' });
  });

  it('lists a condition that came true, not one that never did', async () => {
    const m = (await run(cross)).messages!;
    expect(m.alertConditions).toHaveLength(1);
    expect(m.alertConditions[0]).toMatchObject({ title: 'Cross up', message: 'fast crossed slow', times: crossTimes() });
    expect(m.alertConditions[0].count).toBe(crossTimes().length);
  });

  it('captures log lines with level, formatted text and bar time', async () => {
    const src = `//@version=6
indicator("L")
if bar_index == 2
    log.info("bar {0}", bar_index)
    log.warning("warn")
    log.error("err")
plot(close)`;
    const spy = vi.spyOn(console, 'log');
    const w = vi.spyOn(console, 'warn');
    const e = vi.spyOn(console, 'error');
    const m = (await run(src)).messages!;
    expect(spy).not.toHaveBeenCalled();
    expect(w).not.toHaveBeenCalled();
    expect(e).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(m.logs).toEqual([
      { time: candles[2].time, level: 'info', text: 'bar 2' },
      { time: candles[2].time, level: 'warning', text: 'warn' },
      { time: candles[2].time, level: 'error', text: 'err' },
    ]);
  });

  it('cuts long lists to the newest 500 and counts the rest', async () => {
    const many: typeof candles = Array.from({ length: 700 }, (_, i) => ({ ...candles[0], time: candles[0].time + i * 86400 }));
    const src = `//@version=6
indicator("C")
alert("a", alert.freq_all)
log.info("l {0}", bar_index)
plot(close)`;
    const r = await runPine(src, many);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.messages!.alerts).toHaveLength(500);
    expect(r.messages!.logs).toHaveLength(500);
    expect(r.messages!.logs[499].text).toBe('l 699');
    expect(r.messages!.alerts[499].time).toBe(many[699].time);
    expect(r.messages!.omitted).toMatchObject({ alerts: 200, logs: 200 });
  });

  it('a paged run gives the same messages as an unpaged one', async () => {
    const a = await run(cross);
    const b = await run(cross, { onProgress: () => {} });
    expect(b.messages).toEqual(a.messages);
  });

  it('two runs at once keep their own logs', async () => {
    const mk = (t: string) => `//@version=6\nindicator("I")\nif bar_index == 1\n    log.info("${t}")\nplot(close)`;
    const [a, b] = await Promise.all([run(mk('alpha')), run(mk('beta'))]);
    expect(a.messages!.logs.map((l) => l.text)).toEqual(['alpha']);
    expect(b.messages!.logs.map((l) => l.text)).toEqual(['beta']);
  });

  it('a strategy with alert() on fills has the same trades as without', async () => {
    const base = fixture('strategy-sma-cross');
    const withAlert = base + '\nif strategy.position_size != strategy.position_size[1]\n    alert("fill", alert.freq_all)\n';
    const a = await run(base);
    const b = await run(withAlert);
    expect(b.trades).toEqual(a.trades);
    expect(b.position).toEqual(a.position);
    expect(b.messages!.alerts.length).toBeGreaterThan(0);
  });
});

describe('runPine drawing objects', () => {
  const times = candles.map((c) => c.time);
  const last = candles.length - 1;
  const draw = async (src: string, opts?: Parameters<typeof runPine>[3]) => {
    const r = await runPine(src, candles, {}, opts);
    if (!r.ok) throw new Error(r.error.message);
    return r;
  };

  it('gives lines, boxes, polylines and linefills in their final state, and leaves plots alone', async () => {
    const r = await draw(fixture('drawings'));
    const d = r.drawings!;
    expect(r.plots).toEqual([]);
    expect(d.boxes).toHaveLength(2);
    expect(d.polylines).toHaveLength(2);
    expect(d.linefills).toHaveLength(1);
    const [centred, wrapped] = d.boxes;
    expect(centred).toMatchObject({ pane: 'price', text: 'Range', halign: 'center', valign: 'center', wrap: false, borderWidth: 2, textSize: 12 });
    expect(centred.time1).toBe(times[last - 120]);
    expect(centred.bgColor).toBe('#2962FF33');
    expect(wrapped).toMatchObject({ halign: 'left', valign: 'top', wrap: true });
    const [closed, curved] = d.polylines;
    expect(closed).toMatchObject({ closed: true, curved: false, fillColor: '#E040FB33' });
    expect(closed.points).toHaveLength(3);
    expect(curved).toMatchObject({ closed: false, curved: true, fillColor: null, width: 2 });
    expect(d.linefills[0].color).toBe('#FDD8354D');
    expect(d.linefills[0].line1.price1).not.toBe(d.linefills[0].line2.price1);
  });

  it('moves a line with set_xy2 past the last bar, in bar time', async () => {
    const d = (await draw(fixture('drawings'))).drawings!;
    const ray = d.lines.find((l) => l.extend === 'r')!;
    expect(ray).toMatchObject({ style: 'dashed', width: 2, arrows: 'none', color: '#F23645' });
    expect(ray.time1).toBe(times[last - 60]);
    expect(ray.time2).toBe(logicalToTime(times, last + 20));
    expect(ray.time2).toBeGreaterThan(times[last]);
  });

  it('maps arrows, extend left and bar_time lines', async () => {
    const d = (await draw(fixture('drawings'))).drawings!;
    expect(d.lines.find((l) => l.arrows === 'both')).toMatchObject({ style: 'solid', color: '#089981' });
    expect(d.lines.find((l) => l.extend === 'l')).toMatchObject({ style: 'dotted' });
    const byTime = d.lines.find((l) => l.width === 3)!;
    expect(byTime.time1).toBe(times[last - 80]);
    expect(byTime.time2).toBe(times[last - 50]);
  });

  it('drops the lines the script deleted', async () => {
    const d = (await draw(fixture('drawings'))).drawings!;
    // One thin line per odd bar is left; the even bars' were deleted.
    const thin = d.lines.filter((l) => l.time1 === l.time2 && l.color === '#787B8626');
    expect(thin.length).toBeGreaterThan(50);
    expect(thin.every((l) => candles.findIndex((c) => c.time === l.time1) % 2 === 1)).toBe(true);
  });

  it('keeps the newest max_lines_count lines', async () => {
    const r = await draw(`//@version=6
indicator("Limit", overlay=true, max_lines_count=3)
line.new(bar_index, close, bar_index + 1, close)`);
    expect(r.drawings!.lines.map((l) => l.time1)).toEqual([last - 2, last - 1, last].map((i) => times[i]));
  });

  it('keeps the newest max_boxes_count boxes', async () => {
    const r = await draw(`//@version=6
indicator("Limit", overlay=true, max_boxes_count=2)
box.new(bar_index, high, bar_index + 1, low)`);
    expect(r.drawings!.boxes).toHaveLength(2);
    expect(r.drawings!.boxes.map((b) => b.time1)).toEqual([times[last - 1], times[last]]);
  });

  it('keeps the newest max_polylines_count polylines', async () => {
    const r = await draw(`//@version=6
indicator("Limit", overlay=true, max_polylines_count=2)
polyline.new(array.from(chart.point.from_index(bar_index, close), chart.point.from_index(bar_index + 1, open)))`);
    expect(r.drawings!.polylines.map((p) => p.points[0].time)).toEqual([times[last - 1], times[last]]);
  });

  it('puts a separate-pane script objects in its pane and force_overlay ones on the price pane', async () => {
    const r = await draw(`//@version=6
indicator("Pane", overlay=false)
plot(close)
if barstate.islast
    line.new(bar_index - 5, 1, bar_index, 2)
    box.new(bar_index - 5, high, bar_index, low, force_overlay=true)`);
    expect(r.drawings!.lines.map((l) => l.pane)).toEqual(['separate']);
    expect(r.drawings!.boxes.map((b) => b.pane)).toEqual(['price']);
  });

  it('gives no drawings field for a script without objects', async () => {
    const r = await draw(fixture('rsi'));
    expect(r.drawings).toBeUndefined();
  });

  it('gives the same drawings in a paged run', async () => {
    const single = await draw(fixture('drawings'));
    const paged = await draw(fixture('drawings'), { onProgress: () => {} });
    expect(paged.drawings).toEqual(single.drawings);
  });
});

describe('runPine labels and tables', () => {
  const times = candles.map((c) => c.time);
  const last = candles.length - 1;
  const draw = async (src: string, opts?: Parameters<typeof runPine>[3]) => {
    const r = await runPine(src, candles, {}, opts);
    if (!r.ok) throw new Error(r.error.message);
    return r;
  };

  it('gives the labels the script left, in order, with the text after set_text and without the deleted one', async () => {
    // The fixture makes ten labels and deletes one.
    const { labels } = (await draw(fixture('labels'))).drawings!;
    expect(labels.map((l) => l.text)).toEqual(['Down', 'Up', 'Above', 'Below', 'Price', 'Two\nlines', 'At time', 'Hover me', 'edited']);
    expect(labels.every((l) => l.pane === 'price')).toBe(true);
  });

  it('resolves the position, style, colours and size of each label', async () => {
    const { labels } = (await draw(fixture('labels'))).drawings!;
    const by = (text: string) => labels.find((l) => l.text === text)!;
    expect(by('Price')).toMatchObject({ style: 'circle', yloc: 'price', color: '#9C27B0', textColor: '#FFFFFF', textSize: 12, time: times[last - 44] });
    expect(by('Price').price).toBeCloseTo(candles[last].close * 0.97, 6);
    expect(by('Up')).toMatchObject({ style: 'label_up', yloc: 'price', textSize: 16, price: candles[last].low });
    expect(by('Above')).toMatchObject({ style: 'triangledown', textSize: 10 });
    // abovebar takes the high of its bar, belowbar the low
    expect(by('Above')).toMatchObject({ yloc: 'abovebar', time: times[last - 60], price: candles[last - 60].high });
    expect(by('Below')).toMatchObject({ style: 'arrowup', yloc: 'belowbar', price: candles[last - 52].low });
    expect(by('Two\nlines')).toMatchObject({ style: 'label_down', yloc: 'abovebar', textAlign: 'left', time: times[last - 36], price: candles[last - 36].high });
    expect(by('edited')).toMatchObject({ style: 'label_up', yloc: 'belowbar', time: times[last - 12], price: candles[last - 12].low });
    // a bar_time label lands on its bar
    expect(by('At time')).toMatchObject({ style: 'label_left', time: times[last - 28], price: candles[last].high });
    expect(by('Hover me').tooltip).toBe('The tooltip text');
  });

  it('keeps the newest max_labels_count labels', async () => {
    const r = await draw(`//@version=6
indicator("Limit", overlay=true, max_labels_count=3)
label.new(bar_index, close, str.tostring(bar_index))`);
    expect(r.drawings!.labels.map((l) => l.text)).toEqual([last - 2, last - 1, last].map(String));
    expect(r.drawings!.labels.map((l) => l.time)).toEqual([last - 2, last - 1, last].map((i) => times[i]));
  });

  it('gives a table with its position, sizes, colours, cell text, tooltip and one merge', async () => {
    const [t] = (await draw(fixture('labels'))).drawings!.tables;
    expect(t).toMatchObject({ pane: 'price', position: 'top_right', columns: 3, rows: 3, frameWidth: 2, borderWidth: 1, borderColor: '#FFFFFF' });
    expect(t.bgColor).toBe('#787B86CC');
    expect(t.merges).toEqual([{ startCol: 0, startRow: 0, endCol: 2, endRow: 0 }]);
    expect(t.cells[0][0]).toMatchObject({ text: 'Header', bgColor: '#311B92', textColor: '#FFFFFF', hidden: false });
    expect(t.cells[0][1]!.hidden).toBe(true);
    expect(t.cells[1][0]).toMatchObject({ text: 'Open', halign: 'left', bgColor: null });
    expect(t.cells[1][1]).toMatchObject({ textSize: 10, textColor: '#FDD835' });
    expect(t.cells[1][2]!.tooltip).toBe('A cell tooltip');
    expect(t.cells[2][1]!.bgColor).toMatch(/^#[0-9A-F]{6}[0-9A-F]{2}$/);
  });

  it('puts the table and plain label of an overlay=false script in its pane and a force_overlay label on the candles', async () => {
    const d = (await draw(fixture('labels-pane'))).drawings!;
    expect(d.tables.map((t) => [t.pane, t.position])).toEqual([['separate', 'bottom_left']]);
    expect(d.labels.map((l) => [l.text, l.pane])).toEqual([['In the pane', 'separate'], ['On the candles', 'price']]);
  });

  it('gives the same labels and tables in a paged run', async () => {
    const single = await draw(fixture('labels'));
    const paged = await draw(fixture('labels'), { onProgress: () => {} });
    expect(paged.drawings).toEqual(single.drawings);
  });
});

describe('runPine input types', () => {
  const echo = [
    '//@version=6',
    'indicator("Echo", overlay=true)',
    'col = input.color(#FF0000FF, "Col")',
    'src = input.source(close, "Src")',
    't = input.time(0, "T")',
    'tf = input.timeframe("", "Tf")',
    'ses = input.session("0000-0100", "Ses")',
    'sym = input.symbol("A", "Sym")',
    'txt = input.text_area("x", "Txt")',
    'px = input.price(1.0, "Px")',
    'if bar_index == 0',
    '    log.info("t={0} tf={1} ses={2} sym={3} txt={4} px={5}", t, timeframe.in_seconds(tf), ses, sym, txt, px)',
    'plot(src, "Src", color=col)',
  ].join('\n');

  it('returns each input with its type, group, tooltip and inline, leaving out what the script did not set', async () => {
    const r = await ok('inputs');
    const by = Object.fromEntries(r.inputs.map((i) => [i.name, i]));
    expect(r.inputs.map((i) => i.type)).toEqual(['int', 'source', 'float', 'bool', 'color', 'color', 'timeframe', 'symbol', 'session', 'time', 'text_area', 'price']);
    expect(by.Length).toMatchObject({ tooltip: 'Bars in the average' });
    expect(by.Length).not.toHaveProperty('group');
    expect(by.Length).not.toHaveProperty('inline');
    expect(by.Multiplier).toMatchObject({ group: 'Bands', inline: 'mult' });
    expect(by['Show bands']).toMatchObject({ group: 'Bands', inline: 'mult' });
    expect(by['Line color']).toMatchObject({ group: 'Style', tooltip: 'Color of the average' });
    expect(by.Source.options).toContain('hl2');
  });

  it('every type has an override that changes what the script sees', async () => {
    const run = async (inputs?: Record<string, number | string>) => {
      const r = await runPine(echo, candles, inputs);
      if (!r.ok) throw new Error(r.error.message);
      return r;
    };
    const base = await run();
    const set = await run({
      Col: '#00FF0080',
      Src: 'open',
      T: 1704067200000,
      Tf: '240',
      Ses: '1000-1100,1200-1300',
      Sym: 'ETHUSDT',
      Txt: 'a\nb',
      Px: 42.5,
    });
    const log = (r: PineResult) => r.messages?.logs[0]?.text.replace(/(\d),(?=\d{3})/g, '$1');
    expect(log(base)).toBe('t=0 tf=86400 ses=0000-0100 sym=A txt=x px=1');
    // The log formatter groups digits, so the test strips the commas (the session's comma too) from what it reads.
    expect(log(set)).toBe('t=1704067200000 tf=14400 ses=1000-11001200-1300 sym=ETHUSDT txt=a\nb px=42.5');
    expect(set.plots[0].values).toEqual(candles.map((c) => c.open));
    expect(base.plots[0].values).toEqual(candles.map((c) => c.close));
    expect(String(set.plots[0].color).toLowerCase()).toContain('00ff00');
    expect(String(base.plots[0].color).toLowerCase()).toContain('ff0000');
  });
});
