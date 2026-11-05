import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface LegendMenuItem {
  label: string;
  onChoose: () => void;
}

/**
 * The "more" menu of a legend row. It is drawn in the page body (the legend layers clip what overflows them) at the
 * button's corner, and closes on Escape, on a click outside it and after a choice.
 */
export function IndicatorLegendMenu({ anchor, items, onClose }: { anchor: HTMLElement; items: LegendMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 160;
    setAt({ left: Math.max(4, Math.min(a.left, window.innerWidth - w - 4)), top: a.bottom + 4 });
  }, [anchor]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  const move = (dir: 1 | -1) => {
    const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + dir + all.length) % all.length]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      className="legend-menu"
      role="menu"
      style={{ left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? 'visible' : 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
        else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
      }}
    >
      {items.map((it): ReactNode => (
        <button
          key={it.label}
          role="menuitem"
          className="legend-menu-item"
          onClick={() => {
            onClose();
            it.onChoose();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
