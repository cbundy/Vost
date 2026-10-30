/**
 * Which drawing action a key press means for one chart. Every chart panel listens on the window, so only the
 * active chart's panel may act: one Ctrl+Z must undo on one chart, not on all of them.
 */
export type DrawingKeyAction = 'escape' | 'undo' | 'redo' | 'delete' | 'copy' | 'paste' | null;

export interface DrawingKeyContext {
  /** This chart is the one the top bar and panels act on. */
  active: boolean;
  /** The key went to a text field. */
  editable: boolean;
  /** A drawing is being dragged. */
  dragging: boolean;
  /** A drawing is selected. */
  hasSelection: boolean;
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function drawingKeyAction(e: KeyLike, ctx: DrawingKeyContext): DrawingKeyAction {
  if (!ctx.active || ctx.editable || ctx.dragging) return null;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') return 'escape';
  if (mod && !e.altKey && (k === 'z' || k === 'y')) return k === 'y' || e.shiftKey ? 'redo' : 'undo';
  if (mod && !e.altKey && !e.shiftKey && k === 'c' && ctx.hasSelection) return 'copy';
  if (mod && !e.altKey && !e.shiftKey && k === 'v') return 'paste';
  if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && ctx.hasSelection) return 'delete';
  return null;
}
