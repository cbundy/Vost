import { describe, expect, it } from 'vitest';
import { isComparePath, isStrategyMakerPath } from './route';

describe('isComparePath', () => {
  it('matches /compare and /compare/', () => {
    expect(isComparePath('/compare')).toBe(true);
    expect(isComparePath('/compare/')).toBe(true);
  });
  it('rejects everything else', () => {
    for (const p of ['/', '/compare/x', '/Compare', '/comparex', '/index.html', '', '/compare//', '/strategy-maker']) expect(isComparePath(p)).toBe(false);
  });
});

describe('isStrategyMakerPath', () => {
  it('matches /strategy-maker and /strategy-maker/', () => {
    expect(isStrategyMakerPath('/strategy-maker')).toBe(true);
    expect(isStrategyMakerPath('/strategy-maker/')).toBe(true);
  });
  it('rejects everything else', () => {
    for (const p of ['/', '/strategy-maker/x', '/Strategy-maker', '/strategy-makerx', '/compare', '', '/strategy-maker//']) expect(isStrategyMakerPath(p)).toBe(false);
  });
});
