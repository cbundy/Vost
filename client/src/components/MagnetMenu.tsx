import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flyoutStep } from '../lib/drawingRail';

export type MagnetMode = 'off' | 'weak' | 'strong';

export const MAGNET_MODES: readonly { mode: MagnetMode; label: string }[] = [
  { mode: 'off', label: 'Off' },
  { mode: 'weak', label: 'Weak magnet' },
  { mode: 'strong', label: 'Strong magnet' },
];

const GAP = 4;
const MARGIN = 8;

/** The magnet's three modes as a pop-out radio menu beside the rail; keyboard operable like the family flyouts. */
export function MagnetMenu({ anchor, mode, onPick, onClose }: { anchor: DOMRect; mode: MagnetMode; onPick: (m: MagnetMode) => void; onClose: (restoreFocus: boolean) => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = anchor.right + GAP;
    if (left + w > window.innerWidth - MARGIN) left = Math.max(MARGIN, anchor.left - GAP - w);
    setPos({ left, top: Math.max(MARGIN, Math.min(anchor.top, window.innerHeight - h - MARGIN)) });
  }, [anchor]);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);

  useEffect(() => {
    const list = items();
    (list.find((b) => b.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
  }, []);

  useEffect(() => {
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (menuRef.current?.contains(t)) return;
      if ((t as Element).closest?.('[data-rail-group="magnet"]')) return; // its own buttons toggle the menu
      onClose(false);
    };
    const onResize = () => onClose(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
      return;
    }
    if (e.key === 'Tab') {
      onClose(false);
      return;
    }
    const list = items();
    const next = flyoutStep(list.indexOf(document.activeElement as HTMLElement), list.length, e.key);
    if (next !== null) {
      e.preventDefault();
      list[next]?.focus();
    }
  };

  return (
    <div
      ref={menuRef}
      className="drawing-flyout"
      role="menu"
      tabIndex={-1}
      aria-label="Magnet modes"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onKeyDown={onKeyDown}
    >
      {MAGNET_MODES.map((m) => (
        <div key={m.mode} className="fly-row">
          <button type="button" role="menuitemradio" aria-checked={mode === m.mode} className={`fly-item${mode === m.mode ? ' active' : ''}`} onClick={() => onPick(m.mode)}>
            <span className="fly-label">{m.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
