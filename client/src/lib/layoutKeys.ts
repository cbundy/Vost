/**
 * Which layout action a key press means: Ctrl/Cmd+S saves (even in a text field, so the browser's save dialog never
 * opens) and "." opens the layout list (only outside text fields, with no modifier and no dialog open).
 */
import type { KeyLike } from './drawingKeys';

export type LayoutKeyAction = 'save' | 'open' | null;

export interface LayoutKeyContext {
  /** The key went to a text field. */
  editable: boolean;
  /** A modal dialog is open. */
  dialogOpen: boolean;
  /** The platform uses Cmd rather than Ctrl. */
  mac: boolean;
}

export function layoutKeyAction(e: KeyLike, ctx: LayoutKeyContext): LayoutKeyAction {
  if (ctx.dialogOpen) return null;
  const k = e.key.toLowerCase();
  const mod = ctx.mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (k === 's' && mod && !e.altKey && !e.shiftKey) return 'save';
  if (e.key === '.' && !e.ctrlKey && !e.metaKey && !e.altKey && !ctx.editable) return 'open';
  return null;
}
