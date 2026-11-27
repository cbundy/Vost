import { describe, expect, it } from 'vitest';
import { helpKeyAction } from './helpKey';

const key = (k: string, extra: object = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

describe('helpKeyAction', () => {
  it('opens the manual on a plain F1', () => {
    expect(helpKeyAction(key('F1'))).toBe(true);
  });
  it('ignores F1 with a modifier', () => {
    for (const m of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) expect(helpKeyAction(key('F1', { [m]: true }))).toBe(false);
  });
  it('ignores a held key', () => {
    expect(helpKeyAction(key('F1', { repeat: true }))).toBe(false);
  });
  it('ignores other keys', () => {
    for (const k of ['F2', 'f', 'Help', '?']) expect(helpKeyAction(key(k))).toBe(false);
  });
});
