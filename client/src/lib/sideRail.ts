export type RailMode = 'panel' | 'drawer';

export interface RailState<T extends string = string> {
  active: T;
  collapsed: boolean;
  /** Whether the narrow-screen drawer is open (drawer mode only). */
  drawerOpen?: boolean;
}

export type RailClick<T extends string = string> =
  | { section: T; collapsed: boolean; openDrawer?: undefined }
  | { section: T; openDrawer: true; collapsed?: undefined };

/**
 * What a rail button click does. Panel mode (desktop): the active open section collapses the panel,
 * any other click shows that section with the panel open. Drawer mode: a click always opens the drawer
 * on that section and never touches the saved desktop collapsed pref.
 */
export function railClick<T extends string>(mode: RailMode, state: RailState<T>, id: T): RailClick<T> {
  if (mode === 'drawer') return { section: id, openDrawer: true };
  if (!state.collapsed && state.active === id) return { section: id, collapsed: true };
  return { section: id, collapsed: false };
}

/** Whether a rail button shows as pressed: the open panel's section on desktop; never in drawer mode (the drawer covers the rail). */
export function railPressed<T extends string>(mode: RailMode, state: RailState<T>, id: T): boolean {
  if (mode === 'drawer') return false;
  return !state.collapsed && state.active === id;
}
