import { describe, expect, it } from 'vitest';
import { legendHtml } from './legend';

const bar = { time: 1700000000, open: 100, high: 120, low: 90, close: 112.34, volume: 1500000 };

describe('legendHtml', () => {
  it('keeps the label exactly and escapes it', () => {
    const h = legendHtml(bar, 'Demo · DEMO · 1d', 'UTC');
    expect(h).toContain('<span class="legend-title">Demo · DEMO · 1d</span>');
    expect(legendHtml(bar, 'Local · <b>x</b>', 'UTC')).toContain('Local · &lt;b&gt;x&lt;/b&gt;');
  });
  it('colours up bars pos and down bars neg', () => {
    expect(legendHtml(bar, 'a', 'UTC')).toContain('legend-ohlc pos');
    expect(legendHtml({ ...bar, close: 90 }, 'a', 'UTC')).toContain('legend-ohlc neg');
  });
  it('shows the change as absolute and percent', () => {
    expect(legendHtml(bar, 'a', 'UTC')).toContain('+12.34 (+12.34%)');
    expect(legendHtml({ ...bar, close: 90 }, 'a', 'UTC')).toContain('-10.00 (-10.00%)');
  });
  it('gives 0% for a zero open', () => {
    expect(legendHtml({ ...bar, open: 0, close: 5 }, 'a', 'UTC')).toContain('(0.00%)');
  });
  it('formats volume compactly and time in the zone', () => {
    const utc = legendHtml(bar, 'a', 'UTC');
    expect(utc).toContain('<b>1.50M</b>');
    expect(utc).toContain('22:13');
    expect(legendHtml(bar, 'a', 'Asia/Tehran')).toContain('01:43');
  });
});
