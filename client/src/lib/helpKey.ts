/**
 * F1 opens the built-in manual in a new tab, like the Help button, instead of the browser's own help page. It works
 * in text fields and with a dialog open (F1 types nothing); a held key or any modifier does nothing.
 */
import { useEffect } from 'react';
import type { KeyLike } from './drawingKeys';

/** Where the built-in manual lives. */
export const MANUAL_URL = '/docs/';

export function helpKeyAction(e: KeyLike & { repeat?: boolean }): boolean {
  return e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.repeat;
}

/** Opens the manual on F1 and keeps the browser's own help closed. Call once per page. */
export function useHelpKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) e.preventDefault();
      if (!helpKeyAction(e)) return;
      window.open(MANUAL_URL, '_blank', 'noopener');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
