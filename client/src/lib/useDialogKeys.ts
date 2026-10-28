import { useEffect, useRef, type RefObject } from 'react';

export const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, oldest first: only the newest reacts to keys, so a modal over the Pine dialog closes alone. */
const stack: object[] = [];

/**
 * While active, calls handler for each keydown, but only when this is the newest open dialog. The handler is read
 * through a ref, so a new function each render does not reorder the stack, and a close that re-renders the page
 * in the middle of a key press cannot drop the next dialog's listener before it runs.
 */
export function useTopKeydown(active: boolean, handler: (ev: KeyboardEvent) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!active) return;
    const token = {};
    stack.push(token);
    const onKey = (ev: KeyboardEvent) => {
      if (stack[stack.length - 1] === token) latest.current(ev);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(token), 1);
    };
  }, [active]);
}

/** While active: Escape calls onClose and Tab stays inside root. */
export function useDialogKeys(root: RefObject<HTMLElement | null>, active: boolean, onClose: (() => void) | undefined): void {
  useTopKeydown(active, (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      onClose?.();
      return;
    }
    if (ev.key !== 'Tab') return;
    const el = root.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length > 0);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (!current || !el.contains(current)) {
      ev.preventDefault();
      (ev.shiftKey ? last : first).focus();
    } else if (ev.shiftKey && current === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && current === last) {
      ev.preventDefault();
      first.focus();
    }
  });
}
