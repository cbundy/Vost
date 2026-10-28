import { describe, expect, it } from 'vitest';
import { detectPineVersion, legacyMessage } from './version';

describe('detectPineVersion', () => {
  it('no marker is legacy', () => {
    expect(detectPineVersion('plot(close)')).toEqual({ version: null, legacy: true });
    expect(detectPineVersion('')).toEqual({ version: null, legacy: true });
  });
  it('reads v1 to v6', () => {
    for (let v = 1; v <= 6; v++) {
      expect(detectPineVersion(`//@version=${v}\nplot(close)`)).toEqual({ version: v, legacy: v < 5 });
    }
  });
  it('allows spaces and a marker that is not on line 1', () => {
    expect(detectPineVersion('// a\n  //  @version = 5  \nplot(close)').version).toBe(5);
  });
  it('ignores text that is not a whole marker line', () => {
    expect(detectPineVersion('x = "//@version=6"').version).toBeNull();
    expect(detectPineVersion('plot(close) //@version=6').version).toBeNull();
    expect(detectPineVersion('//@version=6 extra').version).toBeNull();
  });
  it('messages', () => {
    expect(legacyMessage(null)).toMatch(/no \/\/@version line/);
    expect(legacyMessage(4)).toBe('This is a Pine v4 script. Vost runs Pine v5 and v6: use Convert to v6.');
  });
});
