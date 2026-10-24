import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { candlesFromCsvText } from '../csv';
import { buildPineChart, cssColor } from './chartSeries';
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
  });

  it('strategy: plots plus entry and exit markers from trades', async () => {
    const { r, m } = await model('strategy-exit');
    expect(r.trades.length).toBeGreaterThan(1);
    const entries = m.markers.filter((k) => k.text === 'L');
    expect(entries).toHaveLength(r.trades.length);
    expect(m.markers.filter((k) => k.shape === 'circle')).toHaveLength(r.trades.filter((t) => t.exitTime !== null).length);
    const times = m.markers.map((k) => k.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('cssColor converts #RRGGBBAA and passes others through', () => {
    expect(cssColor('#4CAF5033', 'x')).toBe('rgba(76,175,80,0.2)');
    expect(cssColor('#2962FF', 'x')).toBe('#2962FF');
    expect(cssColor(null, 'fb')).toBe('fb');
  });
});
