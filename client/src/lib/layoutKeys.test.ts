import { describe, expect, it } from 'vitest';
import { layoutKeyAction } from './layoutKeys';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});
const ctx = { editable: false, dialogOpen: false, mac: false };

describe('layoutKeyAction', () => {
  it('Ctrl+S saves, and Cmd+S on a Mac', () => {
    expect(layoutKeyAction(key('s', { ctrlKey: true }), ctx)).toBe('save');
    expect(layoutKeyAction(key('S', { ctrlKey: true }), ctx)).toBe('save');
    expect(layoutKeyAction(key('s', { metaKey: true }), { ...ctx, mac: true })).toBe('save');
  });

  it('saves even in a text field, so the browser save dialog never opens', () => {
    expect(layoutKeyAction(key('s', { ctrlKey: true }), { ...ctx, editable: true })).toBe('save');
  });

  it('does nothing while a dialog is open', () => {
    expect(layoutKeyAction(key('s', { ctrlKey: true }), { ...ctx, dialogOpen: true })).toBeNull();
    expect(layoutKeyAction(key('.'), { ...ctx, dialogOpen: true })).toBeNull();
  });

  it('"." opens the list only outside text fields, with no modifier', () => {
    expect(layoutKeyAction(key('.'), ctx)).toBe('open');
    expect(layoutKeyAction(key('.'), { ...ctx, editable: true })).toBeNull();
    expect(layoutKeyAction(key('.', { ctrlKey: true }), ctx)).toBeNull();
    expect(layoutKeyAction(key('.', { metaKey: true }), ctx)).toBeNull();
    expect(layoutKeyAction(key('.', { altKey: true }), ctx)).toBeNull();
  });

  it('gives null for other keys and for S with the wrong modifiers', () => {
    expect(layoutKeyAction(key('s'), ctx)).toBeNull();
    expect(layoutKeyAction(key('a', { ctrlKey: true }), ctx)).toBeNull();
    expect(layoutKeyAction(key('s', { ctrlKey: true, shiftKey: true }), ctx)).toBeNull();
    expect(layoutKeyAction(key('s', { metaKey: true }), ctx)).toBeNull();
    expect(layoutKeyAction(key('Escape'), ctx)).toBeNull();
  });
});
