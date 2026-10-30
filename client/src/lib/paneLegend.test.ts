import { describe, expect, it } from 'vitest';
import { paneLegendHtml } from './paneLegend';

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
