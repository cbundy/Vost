import { describe, expect, it } from 'vitest';
import type { SymbolSuggestion } from './http';
import { groupSymbols, matchSymbols } from './symbolMatch';

const quotes = ['USDT', 'USDC', 'BTC', 'ETH', 'EUR'];
function fixture(): SymbolSuggestion[] {
  const out: SymbolSuggestion[] = [];
  for (let i = 0; i < 700; i++) {
    const base = `COIN${i}`;
    for (const q of quotes) out.push({ symbol: base + q, label: `${base} / ${q}`, exchange: 'Binance', type: 'crypto' });
  }
  out.push({ symbol: 'BTCUSDT', label: 'BTC / USDT', exchange: 'Binance', type: 'crypto' });
  out.push({ symbol: 'WBTCBTC', label: 'WBTC / BTC', exchange: 'Binance', type: 'crypto' });
  out.push({ symbol: 'XBTCZ', label: 'XBTC / Z', exchange: 'Binance', type: 'crypto' });
  out.push({ symbol: 'SPY', label: 'SPDR S&P 500 ETF', type: 'etf' });
  return out;
}

describe('matchSymbols', () => {
  const all = fixture();
  it('has 3000+ fixture symbols and returns more than 12 matches', () => {
    expect(all.length).toBeGreaterThan(3000);
    expect(matchSymbols(all, 'USDT').length).toBeGreaterThan(500 - 1);
    expect(matchSymbols(all, 'BTC').length).toBeGreaterThan(12);
  });
  it('ranks exact, prefix, base/quote, then substring', () => {
    const r = matchSymbols(all, 'btc', 10000).map((s) => s.symbol);
    expect(r[0]).toBe('BTCUSDT');
    expect(r.indexOf('BTCUSDT')).toBeLessThan(r.indexOf('COIN0BTC'));
    // quote match (COIN0BTC has quote BTC) before plain substring (XBTCZ)
    expect(r.indexOf('COIN0BTC')).toBeLessThan(r.indexOf('XBTCZ'));
    expect(r.indexOf('WBTCBTC')).toBeLessThan(r.indexOf('XBTCZ'));
  });
  it('matches names', () => {
    expect(matchSymbols(all, 'spdr').map((s) => s.symbol)).toEqual(['SPY']);
  });
  it('empty query returns everything up to the limit', () => {
    expect(matchSymbols(all, '  ', 100000)).toHaveLength(all.length);
    expect(matchSymbols(all, '', 10)).toHaveLength(10);
  });
  it('respects the limit', () => {
    expect(matchSymbols(all, 'USDT', 20)).toHaveLength(20);
  });
});

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
