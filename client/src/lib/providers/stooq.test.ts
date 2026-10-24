import { describe, expect, it } from 'vitest';
import { stooqProvider } from './stooq';
import { STOOQ_SYMBOLS } from './stooqSymbols';

describe('stooq symbol list', () => {
  it('is large, unique and complete', async () => {
    const list = await stooqProvider.listSymbols!();
    expect(list).toBe(STOOQ_SYMBOLS);
    expect(list.length).toBeGreaterThan(200);
    expect(new Set(list.map((s) => s.symbol)).size).toBe(list.length);
    for (const s of list) {
      expect(s.exchange).toBeTruthy();
      expect(s.type).toBeTruthy();
      expect(s.label).toBeTruthy();
    }
  });
  it('finds spy.us by name', async () => {
    const r = await stooqProvider.searchSymbols!('spdr');
    expect(r.map((s) => s.symbol)).toContain('spy.us');
  });
});
