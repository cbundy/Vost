import { describe, expect, it } from 'vitest';
import { PriceScaleMode } from 'lightweight-charts';
import { lightweightMode, PRICE_SCALE_MODES, sanitizePriceScaleMode, toggleLogMode } from './priceScaleMode';

describe('priceScaleMode', () => {
  it('maps each id to the chart library mode', () => {
    expect(lightweightMode('linear')).toBe(PriceScaleMode.Normal);
    expect(lightweightMode('log')).toBe(PriceScaleMode.Logarithmic);
    expect(lightweightMode('percent')).toBe(PriceScaleMode.Percentage);
    expect(lightweightMode('indexed')).toBe(PriceScaleMode.IndexedTo100);
  });

  it('labels the four modes', () => {
    expect(PRICE_SCALE_MODES.map((m) => m.label)).toEqual(['Linear', 'Logarithmic', 'Percent', 'Indexed to 100']);
  });

  it('sanitizes a saved value to linear unless it is a known id', () => {
    for (const m of PRICE_SCALE_MODES) expect(sanitizePriceScaleMode(m.id)).toBe(m.id);
    for (const bad of [undefined, null, 'LOG', 'weird', 2, {}, true]) expect(sanitizePriceScaleMode(bad)).toBe('linear');
  });

  it('the L button turns log off, and otherwise on', () => {
    expect(toggleLogMode('log')).toBe('linear');
    expect(toggleLogMode('linear')).toBe('log');
    expect(toggleLogMode('percent')).toBe('log');
    expect(toggleLogMode('indexed')).toBe('log');
  });
});
