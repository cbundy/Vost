import { describe, expect, it } from 'vitest';
import { computeIndicator, defaultIndicator, hexToRgba, type IndicatorKind, type IndicatorSpec } from './indicatorCompute';
import type { PineSeriesDesc } from './pine/chartSeries';
import {
  colorToHex,
  plotRowsBuiltin,
  plotRowsPine,
  resolveRow,
  sanitizeIndicatorStyle,
  seriesFormat,
  styledBuiltin,
  styledPine,
  tidy,
  withOpacity,
  withPlotStyle,
  withStyleOptions,
  type IndicatorStyle,
} from './plotStyle';
import type { Candle } from '../types';

const candles: Candle[] = Array.from({ length: 60 }, (_, i) => {
  const close = 100 + Math.sin(i / 4) * 10 + i * 0.1;
  return { time: 86400 * (i + 1), open: close - 1, high: close + 2, low: close - 2, close, volume: 1000 + i };
});
const times = candles.map((c) => c.time);
const KINDS: IndicatorKind[] = ['sma', 'ema', 'bb', 'vwap', 'rsi', 'macd', 'volume'];
const spec = (kind: IndicatorKind, patch: Partial<IndicatorSpec> = {}): IndicatorSpec => ({ ...defaultIndicator(kind), color: '#22d3ee', ...patch });

describe('styledBuiltin with no style', () => {
  it.each(KINDS)('%s draws exactly as computeIndicator gives it', (kind) => {
    const s = spec(kind);
    for (const cs of computeIndicator(s, candles)) {
      const st = styledBuiltin(cs, undefined, times);
      expect(st.data).toBe(cs.data);
      expect(st).toMatchObject({
        visible: true,
        type: cs.kind === 'histogram' ? 'histogram' : 'line',
        color: cs.color,
        width: cs.lineWidth ?? 2,
        lineStyle: cs.dashed ? 'dashed' : 'solid',
        priceLine: false,
      });
    }
  });
  it('an unrelated plot key in the style changes nothing', () => {
    const s = spec('ema');
    const [cs] = computeIndicator(s, candles);
    const st = styledBuiltin(cs, { plots: { ghost_Plot: { color: '#ff0000', visible: false } } }, times);
    expect(st.data).toBe(cs.data);
    expect(st.color).toBe(cs.color);
    expect(st.visible).toBe(true);
  });
});

describe('styledBuiltin with a style', () => {
  const ema = spec('ema');
  const [cs] = computeIndicator(ema, candles);
  const style = (p: IndicatorStyle['plots'] = {}): IndicatorStyle => ({ plots: { ema_EMA: p[Object.keys(p)[0]] ?? {} } });

  it('maps each plot type', () => {
    expect(styledBuiltin(cs, style({ a: { plotType: 'step' } }), times).type).toBe('step');
    expect(styledBuiltin(cs, style({ a: { plotType: 'histogram' } }), times).type).toBe('histogram');
    expect(styledBuiltin(cs, style({ a: { plotType: 'area' } }), times).type).toBe('area');
    expect(styledBuiltin(cs, style({ a: { plotType: 'circles' } }), times).type).toBe('circles');
    expect(styledBuiltin(cs, style({ a: { plotType: 'line' } }), times).type).toBe('line');
  });
  it('line removes gaps, line with breaks puts whitespace at every bar without a value', () => {
    const line = styledBuiltin(cs, style({ a: { plotType: 'line' } }), times);
    expect(line.data.every((p) => p.value !== undefined)).toBe(true);
    expect(line.data.length).toBe(cs.data.length);
    const br = styledBuiltin(cs, style({ a: { plotType: 'linebr' } }), times);
    expect(br.data.map((p) => p.time)).toEqual(times);
    expect(br.data.filter((p) => p.value === undefined).length).toBe(times.length - cs.data.length);
    expect(br.data.filter((p) => p.value === undefined).length).toBeGreaterThan(0);
  });
  it('visible, width, line style and price line', () => {
    const st = styledBuiltin(cs, style({ a: { visible: false, width: 4, lineStyle: 'dotted', priceLine: true } }), times);
    expect(st).toMatchObject({ visible: false, width: 4, lineStyle: 'dotted', priceLine: true });
  });
  it('a colour override replaces per-bar colours; opacity alone scales them', () => {
    const vol = computeIndicator(spec('volume'), candles)[0];
    const key = vol.key;
    const over = styledBuiltin(vol, { plots: { [key]: { color: '#ff0000' } } }, times);
    expect(over.color).toBe('#ff0000');
    expect(over.data.every((p) => p.color === undefined)).toBe(true);
    const half = styledBuiltin(vol, { plots: { [key]: { opacity: 50 } } }, times);
    expect(half.data[0].color).toBe(withOpacity(vol.data[0].color!, 50));
    expect(half.data[0].color).toMatch(/^rgba\(\d+,\d+,\d+,0\.175\)$/);
  });
  it('opacity alone scales the alpha of the base colour (BB upper keeps its 0.55)', () => {
    const bb = computeIndicator(spec('bb'), candles);
    const upper = bb.find((c) => c.key === 'bb_Upper')!;
    expect(upper.color).toBe(hexToRgba('#22d3ee', 0.55));
    expect(styledBuiltin(upper, { plots: { bb_Upper: { opacity: 50 } } }, times).color).toBe('rgba(34,211,238,0.275)');
    const mid = bb.find((c) => c.key === 'bb_Middle')!;
    expect(styledBuiltin(mid, { plots: { bb_Middle: { color: '#ff0000', opacity: 40 } } }, times).color).toBe('rgba(255,0,0,0.4)');
  });
  it('a histogram drawn as a line uses the series colour, not per-bar colours', () => {
    const hist = computeIndicator(spec('macd'), candles).find((c) => c.key === 'macd_hist')!;
    const st = styledBuiltin(hist, { plots: { macd_hist: { plotType: 'line' } } }, times);
    expect(st.type).toBe('line');
    expect(st.data.every((p) => p.color === undefined)).toBe(true);
  });
});

describe('withOpacity', () => {
  it('handles hex, rgb and rgba input', () => {
    expect(withOpacity('#ff0000', 50)).toBe('rgba(255,0,0,0.5)');
    expect(withOpacity('#f00', 50)).toBe('rgba(255,0,0,0.5)');
    expect(withOpacity('#ff000080', 50)).toBe('rgba(255,0,0,0.251)');
    expect(withOpacity('rgb(10, 20, 30)', 25)).toBe('rgba(10,20,30,0.25)');
    expect(withOpacity('rgba(10,20,30,0.5)', 50)).toBe('rgba(10,20,30,0.25)');
    expect(withOpacity('#ff0000', 0)).toBe('rgba(255,0,0,0)');
  });
  it('leaves what it cannot read', () => {
    expect(withOpacity('tomato', 50)).toBe('tomato');
  });
  it('colorToHex drops alpha', () => {
    expect(colorToHex('rgba(255,0,0,0.5)')).toBe('#ff0000');
    expect(colorToHex('nope')).toBeNull();
  });
});

describe('seriesFormat', () => {
  it('gives no format and today\'s last value rule when nothing is set', () => {
    expect(seriesFormat(undefined, true)).toEqual({ lastValueVisible: true });
    expect(seriesFormat({}, false)).toEqual({ lastValueVisible: false });
  });
  it('precision gives priceFormat and minMove; labelsOnScale decides the last value', () => {
    expect(seriesFormat({ precision: 2, labelsOnScale: false }, true)).toEqual({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 }, lastValueVisible: false });
    expect(seriesFormat({ precision: 0 }, true).priceFormat).toEqual({ type: 'price', precision: 0, minMove: 1 });
  });
});

describe('sanitizeIndicatorStyle', () => {
  it('cleans garbage and clamps', () => {
    const out = sanitizeIndicatorStyle({
      plots: {
        a: { color: 'red', opacity: 150, width: 9, lineStyle: 'wavy', plotType: 'bars', visible: 'no', priceLine: true, extra: 1 },
        b: { color: '#ABCDEF', opacity: -4, width: 0, lineStyle: 'dashed', plotType: 'step' },
        c: 'x',
        d: {},
      },
      precision: 12,
      labelsOnScale: 'yes',
      valuesInStatusLine: false,
      unknown: 1,
    });
    expect(out).toEqual({
      plots: { a: { opacity: 100, width: 4, priceLine: true }, b: { color: '#abcdef', opacity: 0, width: 1, lineStyle: 'dashed', plotType: 'step' } },
      precision: 8,
      valuesInStatusLine: false,
    });
  });
  it('accepts rgba() and rejects other colour forms', () => {
    expect(sanitizeIndicatorStyle({ plots: { a: { color: 'rgba(1, 2, 3, 0.5)' } } })?.plots?.a.color).toBe('rgba(1,2,3,0.5)');
    expect(sanitizeIndicatorStyle({ plots: { a: { color: 'rgb(1,2,3)' } } })).toBeUndefined();
    expect(sanitizeIndicatorStyle({ plots: { a: { color: '#fff' } } })).toBeUndefined();
  });
  it('gives undefined for empty or non-object input', () => {
    for (const bad of [undefined, null, 4, 'x', [], {}, { plots: [] }, { plots: { a: {} } }]) expect(sanitizeIndicatorStyle(bad)).toBeUndefined();
  });
});

describe('style helpers', () => {
  it('withPlotStyle sets and removes fields and drops what becomes empty', () => {
    const s1 = withPlotStyle(undefined, 'k', { color: '#ff0000', width: 3 });
    expect(s1).toEqual({ plots: { k: { color: '#ff0000', width: 3 } } });
    const s2 = withPlotStyle(s1, 'k', { color: undefined, width: undefined });
    expect(s2).toBeUndefined();
  });
  it('withStyleOptions keeps the plots and removes an option set to undefined', () => {
    const s = withStyleOptions(withPlotStyle(undefined, 'k', { visible: false }), { precision: 2 });
    expect(s).toEqual({ plots: { k: { visible: false } }, precision: 2 });
    expect(withStyleOptions(s, { precision: undefined })).toEqual({ plots: { k: { visible: false } } });
    expect(tidy({})).toBeUndefined();
  });
});

describe('rows', () => {
  it('lists the built-in plots in drawing order', () => {
    expect(plotRowsBuiltin(spec('bb')).map((r) => r.key)).toEqual(['bb_Upper', 'bb_Middle', 'bb_Lower']);
    expect(plotRowsBuiltin(spec('macd')).map((r) => r.title)).toEqual(['Histogram', 'MACD', 'Signal']);
    expect(plotRowsBuiltin(spec('volume')).map((r) => [r.key, r.type])).toEqual([['volume', 'histogram']]);
    expect(plotRowsBuiltin(spec('ema')).map((r) => r.key)).toEqual(['ema_EMA']);
  });
  it('a row under a style shows the plot as it is drawn', () => {
    const [row] = plotRowsBuiltin(spec('ema'));
    const r = resolveRow(row, { plotType: 'step', color: '#ff0000', opacity: 50, width: 3, visible: false });
    expect(r).toMatchObject({ type: 'step', color: 'rgba(255,0,0,0.5)', width: 3, visible: false, opacity: 50 });
    expect(resolveRow(row, undefined)).toMatchObject({ visible: true, opacity: 100, priceLine: false, color: row.color });
  });
  it('Pine rows skip candle, bar and band plots and keep hlines', () => {
    const d = (over: Partial<PineSeriesDesc>): PineSeriesDesc => ({ key: 'k', title: 't', type: 'line', pane: 'price', color: '#fff', lineWidth: 1, data: [], ...over });
    const rows = plotRowsPine([
      d({ key: '0_A' }),
      d({ key: '1_B', type: 'candle' }),
      d({ key: '2_C', type: 'bar' }),
      d({ key: '3_D', type: 'histogram', band: true }),
      d({ key: '4_E', hline: true, lineStyle: 'dashed' }),
      d({ key: '5_F', type: 'histogram' }),
      d({ key: '6_G', pointsOnly: true }),
      d({ key: '7_H', lineType: 'steps' }),
    ]);
    expect(rows.map((r) => [r.key, r.hline, r.type])).toEqual([
      ['0_A', false, 'linebr'],
      ['4_E', true, 'linebr'],
      ['5_F', false, 'histogram'],
      ['6_G', false, 'circles'],
      ['7_H', false, 'step'],
    ]);
  });
});

describe('styledPine', () => {
  const desc = (over: Partial<PineSeriesDesc> = {}): PineSeriesDesc => ({
    key: '0_Fast',
    title: 'Fast',
    type: 'line',
    pane: 'price',
    color: '#ff9800',
    lineWidth: 1,
    data: [{ time: 1, value: 1, color: 'rgba(1,2,3,1)' }, { time: 2 }, { time: 3, value: 3 }],
    ...over,
  });
  it('returns the description itself with no style', () => {
    const d = desc();
    expect(styledPine(d, undefined)).toEqual({ desc: d, visible: true, priceLine: false });
    expect(styledPine(d, undefined).desc).toBe(d);
    expect(styledPine(d, { plots: { other: { color: '#000000' } } }).desc).toBe(d);
  });
  it('keeps candle, bar and band series as they are', () => {
    for (const d of [desc({ type: 'candle' }), desc({ type: 'bar' }), desc({ type: 'histogram', band: true })]) {
      expect(styledPine(d, { plots: { '0_Fast': { visible: false, color: '#000000' } }, labelsOnScale: false }).desc).toBe(d);
      expect(styledPine(d, { plots: { '0_Fast': { visible: false } }, labelsOnScale: false }).visible).toBe(true);
    }
  });
  it('applies colour, width, line style, visibility and price line', () => {
    const st = styledPine(desc(), { plots: { '0_Fast': { color: '#ff0000', width: 3, lineStyle: 'dashed', visible: false, priceLine: true } } });
    expect(st).toMatchObject({ visible: false, priceLine: true, desc: { color: '#ff0000', lineWidth: 3, lineStyle: 'dashed' } });
    expect(st.desc.data[0].color).toBeUndefined();
  });
  it('opacity alone scales plot and per-bar colours', () => {
    const st = styledPine(desc(), { plots: { '0_Fast': { opacity: 50 } } });
    expect(st.desc.color).toBe('rgba(255,152,0,0.5)');
    expect(st.desc.data[0].color).toBe('rgba(1,2,3,0.5)');
  });
  it('plot types: step, circles, histogram, area, line and line with breaks', () => {
    const run = (t: Parameters<typeof withPlotStyle>[2]['plotType']) => styledPine(desc(), { plots: { '0_Fast': { plotType: t } } }).desc;
    expect(run('step')).toMatchObject({ type: 'line', lineType: 'steps' });
    expect(run('circles')).toMatchObject({ type: 'line', pointsOnly: true });
    expect(run('histogram')).toMatchObject({ type: 'histogram', base: 0 });
    expect(run('area')).toMatchObject({ type: 'area', base: 0 });
    expect(run('line').data.map((p) => p.time)).toEqual([1, 3]);
    expect(run('linebr').data.map((p) => p.time)).toEqual([1, 2, 3]);
    const stepSrc = desc({ lineType: 'steps', pointsOnly: true });
    const back = styledPine(stepSrc, { plots: { '0_Fast': { plotType: 'line' } } }).desc;
    expect(back.lineType).toBeUndefined();
    expect(back.pointsOnly).toBeUndefined();
    expect(styledPine(desc({ type: 'area', base: 5 }), { plots: { '0_Fast': { plotType: 'histogram' } } }).desc.base).toBe(5);
  });
  it('an hline takes colour, width and style but no type or price line', () => {
    const h = desc({ hline: true, lineStyle: 'dashed' });
    const st = styledPine(h, { plots: { '0_Fast': { plotType: 'histogram', priceLine: true, lineStyle: 'dotted', color: '#00ff00' } } });
    expect(st.desc).toMatchObject({ type: 'line', lineStyle: 'dotted', color: '#00ff00' });
    expect(st.priceLine).toBe(false);
  });
  it('labelsOnScale is reported only when set', () => {
    expect(styledPine(desc(), undefined).lastValueVisible).toBeUndefined();
    expect(styledPine(desc(), { labelsOnScale: false }).lastValueVisible).toBe(false);
  });
});
