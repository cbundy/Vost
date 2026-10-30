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

describe('copy and paste keys', () => {
  it('maps copy with Ctrl or Cmd and a selection, paste with Ctrl or Cmd', () => {
    expect(drawingKeyAction(key('c', { ctrlKey: true }), ctx())).toBe('copy');
    expect(drawingKeyAction(key('C', { metaKey: true }), ctx())).toBe('copy');
    expect(drawingKeyAction(key('v', { ctrlKey: true }), ctx())).toBe('paste');
    expect(drawingKeyAction(key('v', { metaKey: true }), ctx({ hasSelection: false }))).toBe('paste');
    expect(drawingKeyAction(key('c', { ctrlKey: true }), ctx({ hasSelection: false }))).toBeNull();
    expect(drawingKeyAction(key('c'), ctx())).toBeNull();
    expect(drawingKeyAction(key('v'), ctx())).toBeNull();
  });
  it('maps neither with Alt or Shift, in a text field, during a drag or on an inactive chart', () => {
    for (const k of ['c', 'v']) {
      expect(drawingKeyAction(key(k, { ctrlKey: true, altKey: true }), ctx())).toBeNull();
      expect(drawingKeyAction(key(k, { ctrlKey: true, shiftKey: true }), ctx())).toBeNull();
      expect(drawingKeyAction(key(k, { ctrlKey: true }), ctx({ editable: true }))).toBeNull();
      expect(drawingKeyAction(key(k, { ctrlKey: true }), ctx({ dragging: true }))).toBeNull();
      expect(drawingKeyAction(key(k, { ctrlKey: true }), ctx({ active: false }))).toBeNull();
    }
  });
});

describe('keys while an open-ended drawing is placed', () => {
  const drafting = ctx({ drafting: true });
  it('Enter ends it and Backspace removes the last point, even with a selection', () => {
    expect(drawingKeyAction(key('Enter'), drafting)).toBe('end-draft');
    expect(drawingKeyAction(key('Backspace'), drafting)).toBe('undo-point');
    expect(drawingKeyAction(key('Backspace'), ctx({ drafting: true, hasSelection: false }))).toBe('undo-point');
    expect(drawingKeyAction(key('Escape'), drafting)).toBe('escape');
  });
  it('without a draft Backspace still deletes the selection and Enter does nothing', () => {
    expect(drawingKeyAction(key('Backspace'), ctx())).toBe('delete');
    expect(drawingKeyAction(key('Backspace'), ctx({ hasSelection: false }))).toBeNull();
    expect(drawingKeyAction(key('Enter'), ctx())).toBeNull();
  });
  it('does nothing in a text field, on an inactive chart or while dragging', () => {
    for (const over of [{ editable: true }, { active: false }, { dragging: true }]) {
      expect(drawingKeyAction(key('Enter'), ctx({ drafting: true, ...over }))).toBeNull();
      expect(drawingKeyAction(key('Backspace'), ctx({ drafting: true, hasSelection: false, ...over }))).toBeNull();
    }
  });
});
