import { describe, expect, it } from 'vitest';
import { drawingKeyAction, type DrawingKeyContext, type KeyLike } from './drawingKeys';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
const ctx = (over: Partial<DrawingKeyContext> = {}): DrawingKeyContext => ({ active: true, editable: false, dragging: false, hasSelection: true, ...over });

describe('drawingKeyAction', () => {
  it('maps the drawing shortcuts for the active chart', () => {
    expect(drawingKeyAction(key('Escape'), ctx())).toBe('escape');
    expect(drawingKeyAction(key('z', { ctrlKey: true }), ctx())).toBe('undo');
    expect(drawingKeyAction(key('Z', { metaKey: true }), ctx())).toBe('undo');
    expect(drawingKeyAction(key('z', { ctrlKey: true, shiftKey: true }), ctx())).toBe('redo');
    expect(drawingKeyAction(key('y', { ctrlKey: true }), ctx())).toBe('redo');
    expect(drawingKeyAction(key('Delete'), ctx())).toBe('delete');
    expect(drawingKeyAction(key('Backspace'), ctx())).toBe('delete');
  });

  it('does nothing for a chart that is not the active one: one Ctrl+Z undoes on one chart only', () => {
    const inactive = ctx({ active: false });
    for (const e of [key('Escape'), key('z', { ctrlKey: true }), key('y', { ctrlKey: true }), key('Delete'), key('Backspace')]) {
      expect(drawingKeyAction(e, inactive)).toBeNull();
    }
    const panels = [true, false, false, false].map((active) => drawingKeyAction(key('z', { ctrlKey: true }), ctx({ active })));
    expect(panels.filter((a) => a === 'undo')).toHaveLength(1);
  });

  it('ignores keys in a text field or during a drag, a delete with nothing selected, and other keys', () => {
    expect(drawingKeyAction(key('z', { ctrlKey: true }), ctx({ editable: true }))).toBeNull();
    expect(drawingKeyAction(key('Escape'), ctx({ dragging: true }))).toBeNull();
    expect(drawingKeyAction(key('Delete'), ctx({ hasSelection: false }))).toBeNull();
    expect(drawingKeyAction(key('Delete', { ctrlKey: true }), ctx())).toBeNull();
    expect(drawingKeyAction(key('z', { ctrlKey: true, altKey: true }), ctx())).toBeNull();
    expect(drawingKeyAction(key('a'), ctx())).toBeNull();
  });
});
