import { describe, expect, it } from 'vitest';
import { isComparePath } from './route';

describe('isComparePath', () => {
  it('matches /compare and /compare/', () => {
    expect(isComparePath('/compare')).toBe(true);
    expect(isComparePath('/compare/')).toBe(true);
  });
  it('rejects everything else', () => {
    for (const p of ['/', '/compare/x', '/Compare', '/comparex', '/index.html', '', '/compare//']) expect(isComparePath(p)).toBe(false);
  });
});
