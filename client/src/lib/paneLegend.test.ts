import { describe, expect, it } from 'vitest';
import { legendValueText, paneLegendHtml, priceLegendRows } from './paneLegend';
import { defaultIndicator, type IndicatorSpec } from './indicatorCompute';
import type { PineRunState } from '../state/chart';

describe('paneLegendHtml', () => {
  it('shows the name, its parameters and each entry in its colour', () => {
    const html = paneLegendHtml({
      name: 'MACD',
      params: ['12', '26', '9'],
      entries: [
        { title: 'MACD', color: '#3b82f6', value: 1.5 },
        { title: 'Signal', color: '#f97316', value: -0.25 },
      ],
    });
    expect(html).toContain('<span class="pane-legend-title">MACD</span>');
    expect(html).toContain('<span class="pane-legend-params">12 26 9</span>');
    expect(html).toContain('style="color:#3b82f6"><span class="pane-legend-plot">MACD</span> <b>1.50</b>');
    expect(html).toContain('style="color:#f97316"><span class="pane-legend-plot">Signal</span> <b>-0.2500</b>');
  });

  it('shows a plain dash for na and omits params when there are none', () => {
    const html = paneLegendHtml({ name: 'X', params: [], entries: [{ title: 'a', color: 'red', value: null }] });
    expect(html).toContain('<b>-</b>');
    expect(html).not.toContain('pane-legend-params');
  });

  it('lists a plot with an empty title by value only', () => {
    const html = paneLegendHtml({ name: 'X', params: [], entries: [{ title: '', color: 'red', value: 70 }] });
    expect(html).not.toContain('pane-legend-plot');
    expect(html).toContain('<b>70.00</b>');
  });

  it('escapes names, params, titles and colours', () => {
    const html = paneLegendHtml({
      name: '<img src=x>',
      params: ['<i>'],
      entries: [{ title: '<b>bold</b>', color: '"><script>', value: 1 }],
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>bold');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});

const spec = (kind: Parameters<typeof defaultIndicator>[0], patch: Partial<IndicatorSpec> = {}): IndicatorSpec => ({ ...defaultIndicator(kind), ...patch });
const pineSource = (title: string) => `//@version=6\nindicator("${title}", overlay=true)\nplot(close)`;
const okRun = (plots: Array<{ pane: 'price' | 'separate' }>, inputs: Array<{ name: string; defval: unknown }> = []) =>
  ({ running: false, result: { ok: true, declaration: { title: 'Run title' }, inputs, plots } }) as unknown as PineRunState;

describe('legendValueText', () => {
  it('shows na as a plain dash and volumes compactly', () => {
    expect(legendValueText(null)).toBe('-');
    expect(legendValueText(undefined)).toBe('-');
    expect(legendValueText(NaN)).toBe('-');
    expect(legendValueText(1.5)).toBe('1.50');
    expect(legendValueText(36940, true)).toBe('36.94K');
  });
});

describe('priceLegendRows', () => {
  it('lists the price-pane indicators in list order: SMA, Volume, a Pine overlay', () => {
    const sma = spec('sma', { params: { length: 50 } });
    const vol = spec('volume');
    const pine = spec('pine', { source: pineSource('My overlay'), inputs: { Fast: 5 } });
    const runs = { [pine.id]: okRun([{ pane: 'price' }], [{ name: 'Fast', defval: 9 }, { name: 'Slow', defval: 21 }]) };
    const rows = priceLegendRows([sma, vol, pine], '1d', runs);
    expect(rows.map((r) => [r.id, r.name, r.params, r.hidden, r.pending])).toEqual([
      [sma.id, 'SMA 50', [], false, false],
      [vol.id, 'Volume', [], false, false],
      [pine.id, 'My overlay', ['5', '21'], false, false],
    ]);
  });

  it('keeps a hidden overlay in place, dimmed', () => {
    const a = spec('ema');
    const b = spec('sma', { visible: false });
    const c = spec('vwap');
    const rows = priceLegendRows([a, b, c], '1d', {});
    expect(rows.map((r) => [r.id, r.hidden])).toEqual([[a.id, false], [b.id, true], [c.id, false]]);
  });

  it('lists a hidden RSI or MACD on the price pane, and leaves a shown one to its own pane', () => {
    const rsi = spec('rsi', { visible: false });
    const macd = spec('macd');
    const hiddenMacd = spec('macd', { visible: false });
    const rows = priceLegendRows([rsi, macd, hiddenMacd], '1d', {});
    expect(rows.map((r) => [r.id, r.name, r.params, r.hidden])).toEqual([
      [rsi.id, 'RSI', ['14'], true],
      [hiddenMacd.id, 'MACD', ['12', '26', '9'], true],
    ]);
  });

  it('gives a timeframe kind that is turned off no row, hidden or not', () => {
    const off = spec('ema', { hideOn: ['minutes'] });
    const keep = spec('sma');
    expect(priceLegendRows([off, keep], '5m', {}).map((r) => r.id)).toEqual([keep.id]);
    expect(priceLegendRows([off, keep], '1d', {}).map((r) => r.id)).toEqual([off.id, keep.id]);
    // A hidden indicator that is also off for the kind has no row either: Show would draw nothing.
    const hiddenOff = spec('ema', { hideOn: ['minutes'], visible: false });
    expect(priceLegendRows([hiddenOff], '5m', {})).toEqual([]);
    expect(priceLegendRows([hiddenOff], '1d', {}).map((r) => r.hidden)).toEqual([true]);
  });

  it('shows a Pine script with a pending run by its source name and no values', () => {
    const p = spec('pine', { source: pineSource('Waiting one') });
    const [row] = priceLegendRows([p], '1d', { [p.id]: { running: true } });
    expect(row).toMatchObject({ name: 'Waiting one', params: [], pending: true, hidden: false });
    const [none] = priceLegendRows([p], '1d', {});
    expect(none.pending).toBe(true);
  });

  it('shows a failed run by name, and one failed script does not drop the others', () => {
    const bad = spec('pine', { source: pineSource('Broken one') });
    const good = spec('pine', { source: pineSource('Fine one') });
    const sma = spec('sma');
    const rows = priceLegendRows([bad, sma, good], '1d', {
      [bad.id]: { running: false, error: { message: 'x', line: 1, col: 1 } } as unknown as PineRunState,
      [good.id]: okRun([{ pane: 'price' }]),
    });
    expect(rows.map((r) => [r.name, r.pending])).toEqual([['Broken one', true], ['SMA 50', false], ['Fine one', false]]);
  });

  it('leaves a Pine script whose plots are all in its own pane to that pane, unless it is hidden', () => {
    const p = spec('pine', { source: pineSource('Own pane') });
    const runs = { [p.id]: okRun([{ pane: 'separate' }, { pane: 'separate' }]) };
    expect(priceLegendRows([p], '1d', runs)).toEqual([]);
    expect(priceLegendRows([{ ...p, visible: false }], '1d', runs).map((r) => r.hidden)).toEqual([true]);
    const mixed = { [p.id]: okRun([{ pane: 'price' }, { pane: 'separate' }]) };
    expect(priceLegendRows([p], '1d', mixed)).toHaveLength(1);
  });
});
