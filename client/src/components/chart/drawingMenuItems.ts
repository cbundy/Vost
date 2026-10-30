import type { DrawingActions, DrawingInfo } from './useDrawingActions';

/** The actions the drawing menus run. */
export type MenuActions = Pick<DrawingActions, 'edit' | 'clone' | 'copy' | 'toggleLock' | 'setHidden' | 'reorder' | 'remove'>;

export type MenuItem = {
  key: string;
  label: string;
  run(): void;
  /** Rename opens an inline input in the menu instead of running: the menu draws it. */
  special?: 'rename';
};

/**
 * The drawing items of the right-click menu and of the floating toolbar's "more" menu, in order. Settings and Rename
 * are for a single drawing. A table's cell items need a pointer cell, so the right-click menu adds them itself.
 */
export function drawingMenuItems(d: DrawingInfo, actions: MenuActions): MenuItem[] {
  const ids = d.ids;
  const items: MenuItem[] = [];
  if (d.hasSettings && d.count === 1) items.push({ key: 'settings', label: 'Settings', run: () => actions.edit(ids[0]) });
  if (d.count === 1) items.push({ key: 'rename', label: 'Rename', run: () => {}, special: 'rename' });
  items.push(
    { key: 'clone', label: 'Clone', run: () => actions.clone(ids) },
    { key: 'copy', label: 'Copy', run: () => actions.copy(ids) },
    { key: 'lock', label: d.locked ? 'Unlock' : 'Lock', run: () => actions.toggleLock(ids) },
    { key: 'hide', label: 'Hide', run: () => actions.setHidden(ids, true) },
    { key: 'front', label: 'Bring to front', run: () => actions.reorder(ids, 'front') },
    { key: 'forward', label: 'Bring forward', run: () => actions.reorder(ids, 'forward') },
    { key: 'backward', label: 'Send backward', run: () => actions.reorder(ids, 'backward') },
    { key: 'back', label: 'Send to back', run: () => actions.reorder(ids, 'back') },
    { key: 'delete', label: 'Delete', run: () => actions.remove(ids) },
  );
  return items;
}
