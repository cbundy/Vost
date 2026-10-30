import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { candlesFromCsvText } from '../csv';
import { buildPineChart, cssColor, separatePosition } from './chartSeries';
import { DOWN_COLOR, UP_COLOR } from '../theme';
import { runPine } from './runtime';
import type { PineResult } from './types';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const candles = candlesFromCsvText(read('../../../../examples/sample-daily.csv')).candles;

async function model(name: string) {
  const r = await runPine(read(`./fixtures/${name}.pine`), candles);
  if (!r.ok) throw new Error(r.error.message);
  return { r: r as PineResult, m: buildPineChart(r as PineResult, candles, '#123456') };
}

describe('buildPineChart', () => {
  it('MACD: separate pane, histogram, na warm-up is whitespace not zero', async () => {
    const { m } = await model('macd');
    expect(m.series.map((s) => [s.title, s.type, s.pane])).toEqual([
      ['MACD', 'line', 'separate'],
      ['Signal', 'line', 'separate'],
      ['Histogram', 'histogram', 'separate'],
    ]);
    const macd = m.series[0];
    expect(macd.data).toHaveLength(candles.length);
    expect(macd.data[0]).toEqual({ time: candles[0].time });
    expect('value' in macd.data[0]).toBe(false);
    expect(macd.data.some((p) => p.value === 0)).toBe(false);
    expect(macd.data[candles.length - 1].value).toBeTypeOf('number');
    expect(macd.color).toMatch(/^#/);
  });

  it('Bollinger: three overlay lines on the price pane', async () => {
    const { m } = await model('bollinger');
    expect(m.series.map((s) => [s.title, s.type, s.pane])).toEqual([
      ['Basis', 'line', 'price'],
      ['Upper', 'line', 'price'],
      ['Lower', 'line', 'price'],
    ]);
    expect(m.markers).toEqual([]);
  });

  it('hline, bgcolor, plotshape and circles are mapped', async () => {
    const { r, m } = await model('overlays');
    expect(r.plots.map((p) => p.kind)).toEqual(['hline', 'bgcolor', 'plotshape', 'plot']);
    const hline = m.series.find((s) => s.title === 'Level')!;
    expect(hline.dashed).toBe(true);
    expect(hline.hline).toBe(true);
    expect(m.series.filter((s) => s.hline).map((s) => s.title)).toEqual(['Level']);
    expect(hline.data.every((p) => p.value === 100)).toBe(true);
    const band = m.series.find((s) => s.title === 'Up bar')!;
    expect(band.band).toBe(true);
    const drawn = band.data.filter((p) => p.value !== undefined);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(candles.length);
    expect(drawn[0].color).toMatch(/^rgba\(/);
    expect(m.series.find((s) => s.title === 'Dots')!.pointsOnly).toBe(true);
    expect(m.markers.length).toBeGreaterThan(0);
    expect(m.markers.every((k) => k.shape === 'arrowUp' && k.position === 'belowBar')).toBe(true);
    expect(m.markers.every((k) => k.pane === 'price')).toBe(true);
  });

  it('a separate-pane script puts its shapes in its pane: belowbar at the bottom, abovebar at the top', async () => {
    const { r, m } = await model('pane-shapes');
    expect(r.plots.filter((p) => p.kind === 'plotshape').every((p) => p.pane === 'separate')).toBe(true);
    const low = m.markers.filter((k) => k.panePosition === 'atPriceBottom');
    const high = m.markers.filter((k) => k.panePosition === 'atPriceTop');
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    expect(low.length + high.length).toBe(m.markers.length);
    expect(m.markers.every((k) => k.pane === 'separate')).toBe(true);
    expect(low.every((k) => k.price === 0 && k.position === 'belowBar')).toBe(true);
    expect(high.every((k) => k.price === 1 && k.position === 'aboveBar')).toBe(true);
  });

  it('separatePosition maps top, bottom, abovebar, belowbar and absolute', () => {
    expect(separatePosition('Top')).toEqual({ panePosition: 'atPriceTop', price: 1 });
    expect(separatePosition('AboveBar')).toEqual({ panePosition: 'atPriceTop', price: 1 });
    expect(separatePosition('Bottom')).toEqual({ panePosition: 'atPriceBottom', price: 0 });
    expect(separatePosition('BelowBar')).toEqual({ panePosition: 'atPriceBottom', price: 0 });
    expect(separatePosition('Absolute')).toEqual({ panePosition: 'atPriceMiddle', price: 0.5 });
    expect(separatePosition(undefined)).toEqual({ panePosition: 'atPriceTop', price: 1 });
  });

  it('an absolute shape in a separate pane sits at its series value', async () => {
    const r = await runPine('//@version=6\nindicator("x", overlay=false)\nplotshape(close, title="A", location=location.absolute)\n', candles);
    if (!r.ok) throw new Error(r.error.message);
    const vals = r.plots[0].values;
    expect(vals.some((v) => v !== null && Number.isFinite(v))).toBe(true);
    const m = buildPineChart(r, candles, '#fff');
    expect(m.markers.length).toBeGreaterThan(0);
    m.markers.forEach((k) => {
      expect(k.panePosition).toBe('atPriceMiddle');
      expect(k.price).toBe(vals[candles.findIndex((c) => c.time === k.time)]);
    });
  });

  it('separatePosition uses a finite value for absolute only', () => {
    expect(separatePosition('Absolute', 42)).toEqual({ panePosition: 'atPriceMiddle', price: 42, onScale: true });
    expect(separatePosition('Absolute', null)).toEqual({ panePosition: 'atPriceMiddle', price: 0.5 });
    expect(separatePosition('AboveBar', 42)).toEqual({ panePosition: 'atPriceTop', price: 1 });
  });

  it('strategy: plots plus entry and exit markers from trades', async () => {
    const { r, m } = await model('strategy-exit');
    expect(r.trades.length).toBeGreaterThan(1);
    const entries = m.markers.filter((k) => k.text === 'L');
    expect(entries).toHaveLength(r.trades.length);
    expect(m.markers.filter((k) => k.shape === 'circle')).toHaveLength(r.trades.filter((t) => t.exitTime !== null).length);
    expect(m.markers.every((k) => k.pane === 'price')).toBe(true);
    const times = m.markers.map((k) => k.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('cssColor converts #RRGGBBAA and passes others through', () => {
    expect(cssColor('#4CAF5033', 'x')).toBe('rgba(76,175,80,0.2)');
    expect(cssColor('#2962FF', 'x')).toBe('#2962FF');
    expect(cssColor(null, 'fb')).toBe('fb');
  });
});

describe('buildPineChart fills', () => {
  it('rsi-band: no series for the fill; one fill joining the hlines with an rgba colour', async () => {
    const { m } = await model('rsi-band');
    expect(m.series.map((s) => s.title)).toEqual(['RSI', 'Upper', 'Lower']);
    expect(m.fills).toHaveLength(1);
    const f = m.fills[0];
    expect(f.pane).toBe('separate');
    expect([f.key1, f.key2]).toEqual([m.series[1].key, m.series[2].key]);
    expect(f.color).toBe(cssColor('#9C27B01A', ''));
    expect(f.color).toMatch(/^rgba\(156,39,176,0\.1/);
    expect(f.colors).toBeUndefined();
  });

  it('cloud: per-bar colours are converted', async () => {
    const { m } = await model('cloud');
    expect(m.series.map((s) => s.title)).toEqual(['Fast', 'Slow']);
    const f = m.fills[0];
    expect(f.pane).toBe('price');
    expect(f.colors).toHaveLength(candles.length);
    const set = new Set((f.colors ?? []).filter((c) => c !== null));
    expect(set.size).toBe(2);
    for (const c of set) expect(c).toMatch(/^rgba\(/);
  });

  it('drops a fill whose hline has no level', async () => {
    const { r } = await model('rsi-band');
    const plots = r.plots.map((p) => (p.kind === 'hline' && p.name === 'Lower' ? { ...p, values: p.values.map(() => null) } : p));
    const m = buildPineChart({ ...r, plots }, candles, '#123456');
    expect(m.fills).toEqual([]);
    expect(m.series.map((s) => s.title)).toEqual(['RSI', 'Upper']);
  });
});

describe('buildPineChart candles, bars, bar colors and arrows', () => {
  it('custom candles: a candle series in the separate pane with per-bar colors', async () => {
    const { m } = await model('custom-candles');
    expect(m.series).toHaveLength(1);
    const s = m.series[0];
    expect([s.type, s.pane]).toEqual(['candle', 'separate']);
    expect(s.data).toHaveLength(candles.length);
    const p = s.data[3];
    const c = candles[3];
    expect(p.ohlc).toEqual([c.open, c.high, c.low, c.close]);
    expect(p.value).toBe(c.close);
    expect(new Set(s.data.map((d) => d.color)).size).toBe(2);
    expect(p.wickColor).toBeTruthy();
    expect(p.borderColor).toBeTruthy();
    expect(p.borderColor).not.toBe(p.color);
  });

  it('custom candles: arrows sit in the script pane, up at the bottom, down at the top, lime/maroon', async () => {
    const { m } = await model('custom-candles');
    const up = m.markers.filter((k) => k.shape === 'arrowUp');
    const down = m.markers.filter((k) => k.shape === 'arrowDown');
    expect(up.length).toBeGreaterThan(0);
    expect(down.length).toBeGreaterThan(0);
    expect(m.markers.every((k) => k.pane === 'separate')).toBe(true);
    expect(up.every((k) => k.panePosition === 'atPriceBottom')).toBe(true);
    expect(down.every((k) => k.panePosition === 'atPriceTop')).toBe(true);
    const byTime = new Map(candles.map((c) => [c.time, c]));
    for (const k of up) expect(byTime.get(k.time)!.close).toBeGreaterThan(byTime.get(k.time)!.open);
    for (const k of down) expect(byTime.get(k.time)!.close).toBeLessThan(byTime.get(k.time)!.open);
    // size grows with the magnitude of the value
    const size = (k: (typeof m.markers)[number]) => Math.abs(byTime.get(k.time)!.close - byTime.get(k.time)!.open);
    const all = [...up, ...down].sort((a, b) => size(a) - size(b));
    expect(all[all.length - 1].size).toBeGreaterThan(all[0].size);
    expect(all[all.length - 1].size).toBeCloseTo(2, 5); // maxheight 100 at the peak
  });

  it('bar colors: a bar series and arrows on the price pane, barColors only where the condition holds', async () => {
    const { m } = await model('bar-colors');
    const s = m.series.find((d) => d.type === 'bar')!;
    expect(s.pane).toBe('price');
    expect(s.data[0]).toEqual({ time: candles[0].time }); // sma warm-up is a gap
    expect(s.data[candles.length - 1].ohlc).toHaveLength(4);
    const expected = candles.filter((c) => c.close > c.open).map((c) => c.time);
    expect([...m.barColors.keys()]).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(candles.length);
    expect([...m.barColors.values()].every((v) => v === m.barColors.get(expected[0]))).toBe(true);
    expect(m.barColors.get(expected[0])).toMatch(/^(#|rgba?\()/);
    expect(m.markers.every((k) => k.pane === 'price')).toBe(true);
    expect(m.markers.filter((k) => k.shape === 'arrowUp').every((k) => k.position === 'belowBar')).toBe(true);
    expect(m.markers.filter((k) => k.shape === 'arrowDown').every((k) => k.position === 'aboveBar')).toBe(true);
  });

  it('plotarrow without colors uses the theme up/down colors; zero draws nothing', async () => {
    const r = await runPine('//@version=5\nindicator("a", overlay=true)\nplotarrow(close - close[1])', candles);
    if (!r.ok) throw new Error(r.error.message);
    const m = buildPineChart(r, candles, '#123456');
    const flat = candles.filter((c, i) => i > 0 && c.close === candles[i - 1].close).length;
    expect(m.markers.length).toBe(candles.length - 1 - flat);
    expect(m.markers.find((k) => k.shape === 'arrowUp')!.color).toBe(UP_COLOR);
    expect(m.markers.find((k) => k.shape === 'arrowDown')!.color).toBe(DOWN_COLOR);
  });

  it('cssColor turns #RRGGBBAA into rgba in barColors', () => {
    const plot = { name: 'b', kind: 'barcolor' as const, values: [1], color: '#2962FF80', style: 'barcolor', pane: 'price' as const };
    const m = buildPineChart(
      { ok: true, kind: 'indicator', declaration: { title: 't', overlay: true }, inputs: [], plots: [plot], trades: [], position: [] },
      [candles[0]],
      '#000',
    );
    expect(m.barColors.get(candles[0].time)).toBe('rgba(41,98,255,0.502)');
  });
});
