import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flyoutStep, type RailEntry, type RailGroup } from '../lib/drawingRail';
import { StarIcon } from './DrawingIcons';

export type FlyoutProps = {
  group: RailGroup;
  /** The group button's box; the menu sits beside it. */
  anchor: DOMRect;
  /** Icon of an entry. */
  icon: (e: RailEntry) => ReactNode;
  isPressed: (e: RailEntry) => boolean;
  isDisabled: (e: RailEntry) => boolean;
  favorites: readonly string[];
  onPick: (e: RailEntry) => void;
  onToggleFavorite: (key: string) => void;
  /** Close; `restoreFocus` puts focus back on the group button. */
  onClose: (restoreFocus: boolean) => void;
};

const GAP = 4;
const MARGIN = 8;

/** The pop-out list of a rail family: sections of radio items with a star each. Fully keyboard operable. */
export function DrawingFlyout({ group, anchor, icon, isPressed, isDisabled, favorites, onPick, onToggleFavorite, onClose }: FlyoutProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  /* Beside the rail, moved to stay inside the viewport. */
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = anchor.right + GAP;
    if (left + w > window.innerWidth - MARGIN) left = Math.max(MARGIN, anchor.left - GAP - w);
    const top = Math.max(MARGIN, Math.min(anchor.top, window.innerHeight - h - MARGIN));
    setPos({ left, top });
  }, [anchor]);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not(:disabled)') ?? []);

  /* Focus lands on the current entry, else the first. */
  useEffect(() => {
    const list = items();
    (list.find((b) => b.getAttribute('aria-checked') === 'true') ?? list[0] ?? menuRef.current)?.focus();
  }, []);

  useEffect(() => {
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (menuRef.current?.contains(t)) return;
      // the group's own button toggles the menu itself
      if ((t as Element).closest?.(`[data-rail-group="${group.id}"]`)) return;
      onClose(false);
    };
    const onResize = () => onClose(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [group.id, onClose]);

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
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = flyoutStep(at, list.length, e.key);
    if (next !== null) {
      e.preventDefault();
      list[next]?.focus();
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      const entry = group.entries.find((x) => x.key === (document.activeElement as HTMLElement | null)?.dataset.entry);
      if (entry) {
        e.preventDefault();
        onToggleFavorite(entry.key);
      }
    }
  };

  return (
    <div
      ref={menuRef}
      className="drawing-flyout"
      role="menu"
      tabIndex={-1}
      aria-label={`${group.label} tools`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onKeyDown={onKeyDown}
    >
      {group.sections.map((s) => (
        <div key={s.title} className="fly-section" role="group" aria-label={s.title}>
          <div className="fly-heading" aria-hidden="true">
            {s.title}
          </div>
          {s.entries.map((e) => {
            const fav = favorites.includes(e.key);
            return (
              <div key={e.key} className="fly-row">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isPressed(e)}
                  className={`fly-item${isPressed(e) ? ' active' : ''}`}
                  data-entry={e.key}
                  title={e.label}
                  disabled={isDisabled(e)}
                  aria-keyshortcuts="F"
                  onClick={() => onPick(e)}
                >
                  <span className="fly-icon">{icon(e)}</span>
                  <span className="fly-label">{e.label}</span>
                </button>
                <button
                  type="button"
                  className={`fly-star${fav ? ' on' : ''}`}
                  aria-label={`Favorite ${e.label}`}
                  aria-pressed={fav}
                  title={fav ? 'Remove from favorites' : 'Add to favorites'}
                  tabIndex={-1}
                  onClick={() => onToggleFavorite(e.key)}
                >
                  <StarIcon filled={fav} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
