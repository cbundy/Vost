/** Pure size math for the two resizable panes (sidebar width, bottom dock height). */

export const SIDEBAR_DEFAULT = 264;
export const SIDEBAR_MIN = 200;
/** The sidebar may take at most this share of the viewport width (never below SIDEBAR_MIN). */
export const SIDEBAR_MAX_RATIO = 0.4;

export const DOCK_DEFAULT = 320;
/** The dock's tab strip: the smallest the dock can be. */
export const DOCK_MIN = 42;
/** Dragging the dock below this height collapses it. */
export const DOCK_COLLAPSE_BELOW = DOCK_MIN + 24;
/** The chart area always keeps at least this much height. */
export const CHART_MIN_HEIGHT = 200;
/** Top bar plus the 1px border above the app body. */
export const TOPBAR_HEIGHT = 49;

export const STEP = 16;
export const STEP_SHIFT = 64;

export interface Limits {
  min: number;
  max: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sidebarLimits(viewportW: number): Limits {
  return { min: SIDEBAR_MIN, max: Math.max(SIDEBAR_MIN, Math.floor(viewportW * SIDEBAR_MAX_RATIO)) };
}

export function dockLimits(viewportH: number): Limits {
  return { min: DOCK_MIN, max: Math.max(DOCK_MIN, Math.floor(viewportH - TOPBAR_HEIGHT - CHART_MIN_HEIGHT)) };
}

/**
 * The next size for a key press, or null when the key does nothing.
 * ArrowRight and ArrowUp grow the pane, ArrowLeft and ArrowDown shrink it; Home goes to the minimum, End to the maximum.
 */
export function step(value: number, key: string, shift: boolean, limits: Limits): number | null {
  const amount = shift ? STEP_SHIFT : STEP;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(value + amount, limits.min, limits.max);
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(value - amount, limits.min, limits.max);
    case 'Home':
      return limits.min;
    case 'End':
      return limits.max;
    default:
      return null;
  }
}

export function shouldCollapseDock(rawHeight: number): boolean {
  return rawHeight < DOCK_COLLAPSE_BELOW;
}

/** A stored size, or the default when it is missing, not a number, not finite or not positive. */
export function sanitizeStoredSize(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

export interface DockResize {
  /** The height to store, or null to leave the stored height as it is. */
  height: number | null;
  collapsed: boolean;
}

/**
 * What a dock resize does. A drag below the collapse threshold stores the height the drag started from
 * (so expanding later restores it) and collapses; arrow-up on a collapsed dock expands it; any other move
 * below the threshold keeps it collapsed; a move above it stores the clamped height and expands.
 */
export function resolveDockResize(
  raw: number,
  via: 'drag' | 'key',
  wasCollapsed: boolean,
  dragStartHeight: number,
  limits: Limits,
): DockResize {
  if (shouldCollapseDock(raw)) {
    if (wasCollapsed && via === 'key' && raw > DOCK_MIN) return { height: null, collapsed: false };
    return { height: via === 'drag' && !wasCollapsed ? dragStartHeight : null, collapsed: true };
  }
  return { height: clamp(raw, limits.min, limits.max), collapsed: false };
}
