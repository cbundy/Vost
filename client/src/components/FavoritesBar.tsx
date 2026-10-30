import { useLayoutEffect, useRef, useState } from 'react';
import { allEntries, clampBarPos, entryPressed, type BarPos } from '../lib/drawingRail';
import { entryDisabled, entryIcon, type DrawingControls } from './DrawingRail';
import { GripIcon } from './DrawingIcons';
import { useStore } from '../state/store';

/** The favourites, floating over the chart: one button per starred entry, moved by its grip. Shown only with a favourite. */
export function FavoritesBar(c: DrawingControls) {
  const pos = useStore((s) => s.favoritesBarPos);
  const ref = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: Infinity, h: Infinity });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<BarPos | null>(null);
  const grab = useRef<{ x: number; y: number } | null>(null);
  const entries = c.favorites.map((k) => allEntries().find((e) => e.key === k)).filter((e) => e !== undefined);

  /* Track the chart area and the bar's own size so the position can be clamped on resize. */
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const measure = () => {
      setArea({ w: parent.clientWidth, h: parent.clientHeight });
      setSize({ w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    ro.observe(el);
    return () => ro.disconnect();
  }, [entries.length]);

  if (entries.length === 0) return null;
  const shown = clampBarPos(drag ?? pos, size, area);

  /** Where the bar goes when the pointer is at (x, y): the grab offset kept, clamped inside the chart area. */
  const place = (x: number, y: number): BarPos | null => {
    const g = grab.current;
    const parent = ref.current?.offsetParent?.getBoundingClientRect();
    if (!g || !parent) return null;
    return clampBarPos({ x: x - parent.left - g.x, y: y - parent.top - g.y }, size, area);
  };

  return (
    <div ref={ref} className="favorites-bar" role="toolbar" aria-label="Favorite drawing tools" style={{ left: shown.x, top: shown.y }}>
      <div
        className="fav-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Move favorites bar"
        title="Drag to move"
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = ref.current?.getBoundingClientRect();
          if (!r) return;
          grab.current = { x: e.clientX - r.left, y: e.clientY - r.top };
          setDrag(shown);
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const next = place(e.clientX, e.clientY);
          if (next) setDrag(next);
        }}
        onPointerUp={(e) => {
          if (!drag) return;
          const next = place(e.clientX, e.clientY) ?? drag;
          grab.current = null;
          setDrag(null);
          useStore.getState().setFavoritesBarPos(next);
        }}
        onPointerCancel={() => {
          grab.current = null;
          setDrag(null);
        }}
      >
        <GripIcon />
      </div>
      {entries.map((e) => {
        const on = entryPressed(e, c.tool, c.cursorKind);
        return (
          <button
            key={e.key}
            type="button"
            className={`ghost icon rail-btn${on ? ' active' : ''}`}
            title={e.label}
            aria-label={e.label}
            aria-pressed={on}
            disabled={entryDisabled(e, c)}
            onClick={() => c.onPick(e)}
          >
            {entryIcon(e)}
          </button>
        );
      })}
    </div>
  );
}
