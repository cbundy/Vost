import { describe, expect, it } from 'vitest';
import { groupSymbols } from './symbolMatch';

describe('groupSymbols', () => {
  it('groups by quote asset in first-seen order', () => {
    const g = groupSymbols(
      [
        { symbol: 'A', label: 'A / USDT' },
        { symbol: 'B', label: 'B / BTC' },
        { symbol: 'C', label: 'C / USDT' },
      ],
      'quote',
    );
    expect(g.map((x) => x.title)).toEqual(['USDT', 'BTC']);
    expect(g[0].items.map((s) => s.symbol)).toEqual(['A', 'C']);
  });
  it('groups by type', () => {
    const g = groupSymbols([{ symbol: 'A', type: 'etf' }, { symbol: 'B', type: 'stock' }, { symbol: 'C' }, { symbol: 'D', type: 'etf' }], 'type');
    expect(g.map((x) => x.title)).toEqual(['etf', 'stock', 'other']);
    expect(g[0].items).toHaveLength(2);
  });
});
