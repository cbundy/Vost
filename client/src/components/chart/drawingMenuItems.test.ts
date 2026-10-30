import { describe, expect, it, vi } from 'vitest';
import { drawingMenuItems } from './drawingMenuItems';
import type { DrawingInfo } from './useDrawingActions';

const single: DrawingInfo = { ids: ['a'], count: 1, title: 'Trend line', name: '', locked: false, hidden: false, hasSettings: true };
const fakes = () => ({ edit: vi.fn(), clone: vi.fn(), copy: vi.fn(), toggleLock: vi.fn(), setHidden: vi.fn(), reorder: vi.fn(), remove: vi.fn() });

describe('drawingMenuItems', () => {
  it('lists a single drawing in the menu order', () => {
    expect(drawingMenuItems(single, fakes()).map((i) => i.label)).toEqual(['Settings', 'Rename', 'Clone', 'Copy', 'Lock', 'Hide', 'Bring to front', 'Bring forward', 'Send backward', 'Send to back', 'Delete']);
  });
  it('drops Settings for a drawing without settings', () => {
    expect(drawingMenuItems({ ...single, hasSettings: false }, fakes())[0].label).toBe('Rename');
  });
  it('drops Settings and Rename for several drawings', () => {
    const items = drawingMenuItems({ ...single, ids: ['a', 'b'], count: 2, hasSettings: false }, fakes());
    expect(items.map((i) => i.key)).toEqual(['clone', 'copy', 'lock', 'hide', 'front', 'forward', 'backward', 'back', 'delete']);
  });
  it('offers Unlock for a locked drawing', () => {
    expect(drawingMenuItems({ ...single, locked: true }, fakes()).find((i) => i.key === 'lock')?.label).toBe('Unlock');
  });
  it('runs each item on the drawings', () => {
    const a = fakes();
    const by = Object.fromEntries(drawingMenuItems({ ...single, ids: ['a', 'b'], count: 2 }, a).map((i) => [i.key, i]));
    by.clone.run();
    by.lock.run();
    by.hide.run();
    by.front.run();
    by.delete.run();
    expect(a.clone).toHaveBeenCalledWith(['a', 'b']);
    expect(a.toggleLock).toHaveBeenCalledWith(['a', 'b']);
    expect(a.setHidden).toHaveBeenCalledWith(['a', 'b'], true);
    expect(a.reorder).toHaveBeenCalledWith(['a', 'b'], 'front');
    expect(a.remove).toHaveBeenCalledWith(['a', 'b']);
  });
});
