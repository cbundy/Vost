import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useActiveDrawings } from './chart/activeDrawings';
import { getTool } from './chart/tools';
import { EyeIcon, EyeOffIcon, LockIcon, TrashIcon } from './DrawingIcons';
import type { Drawing } from '../lib/drawings';

/** Pointer travel before a press on a row becomes a drag. */
const DRAG_PX = 4;

type Drag = { id: string; x: number; y: number; moving: boolean };
type Drop = { id: string; after: boolean };

/** Pencil glyph for the rename button. */
const PencilIcon = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20l1-4L15 6l3 3L8 19z" />
  </svg>
);

/**
 * The active chart's drawings, top-most first: select, hide, lock, rename, delete and drag to a new place in the paint
 * order. Every edit goes through the chart's own actions, so it is one step in that chart's undo history.
 */
export function ObjectTree() {
  const entry = useActiveDrawings();
  const [editing, setEditing] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const justDragged = useRef(false);

  const known = entry ? entry.drawings.filter((d) => !!getTool(d.tool)) : [];
  const rows = [...known].reverse();
  const selected = new Set(entry?.selected ?? []);
  const off = new Set(entry?.offTimeframe ?? []);

  const dropAt = (x: number, y: number): Drop | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-row-id]');
    if (!el?.dataset.rowId) return null;
    const r = el.getBoundingClientRect();
    return { id: el.dataset.rowId, after: y > r.top + r.height / 2 };
  };

  const onDown = (e: ReactPointerEvent<HTMLElement>, d: Drawing) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button,input')) return;
    dragRef.current = { id: d.id, x: e.clientX, y: e.clientY, moving: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = dragRef.current;
    if (!g) return;
    if (!g.moving) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_PX) return;
      g.moving = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDragId(g.id);
    }
    const t = dropAt(e.clientX, e.clientY);
    setDrop(t && t.id !== g.id ? t : null);
  };
  const end = (e: ReactPointerEvent<HTMLElement>, commit: boolean) => {
    const g = dragRef.current;
    dragRef.current = null;
    if (!g?.moving) return;
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    const t = commit ? dropAt(e.clientX, e.clientY) : null;
    setDrop(null);
    setDragId(null);
    if (!t || t.id === g.id || !entry) return;
    // Target index among the other drawings; a row shown above another paints above it (after = higher paint index).
    const rest = entry.drawings.filter((d) => d.id !== g.id);
    const at = rest.findIndex((d) => d.id === t.id);
    if (at < 0) return;
    entry.actions.moveTo(g.id, t.after ? at : at + 1);
  };

  const commitName = (id: string, name: string) => {
    setEditing(null);
    entry?.actions.rename(id, name);
  };

  const label = (d: Drawing) => d.name ?? getTool(d.tool)?.label ?? d.tool;

  return (
    <section className="sidebar-section object-tree" style={{ borderBottom: 'none' }}>
      <div className="sidebar-title">
        <span>Object tree</span>
        <span className="badge">{rows.length}</span>
      </div>
      {entry?.hidden && <div className="sidebar-empty object-tree-note">All drawings are hidden. Turn off Hide all in the drawing rail to use the list.</div>}
      {rows.length === 0 ? (
        <div className="sidebar-empty">No drawings on this chart</div>
      ) : (
        <div role="list" aria-label="Drawings" className="object-list">
          {rows.map((d) => {
            const name = label(d);
            const tool = getTool(d.tool);
            const hidden = d.hidden === true;
            const cls = ['object-row', selected.has(d.id) && 'selected', (hidden || off.has(d.id)) && 'dim', dragId === d.id && 'dragging', drop?.id === d.id && (drop.after ? 'drop-after' : 'drop-before')]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={d.id}
                role="listitem"
                className={cls}
                data-row-id={d.id}
                aria-selected={selected.has(d.id)}
                title={hidden ? 'Hidden' : off.has(d.id) ? 'Not shown on this timeframe' : undefined}
                onPointerDown={(e) => onDown(e, d)}
                onPointerMove={onMove}
                onPointerUp={(e) => end(e, true)}
                onPointerCancel={(e) => end(e, false)}
                onClick={(e) => {
                  if (justDragged.current || entry!.hidden || hidden) return;
                  const ids = e.shiftKey ? (selected.has(d.id) ? [...selected].filter((x) => x !== d.id) : [...selected, d.id]) : [d.id];
                  entry!.actions.selectIds(ids);
                }}
                onDoubleClick={() => setEditing(d.id)}
              >
                <span className="object-icon" aria-hidden="true">
                  {tool?.icon}
                </span>
                {editing === d.id ? (
                  <input
                    className="object-name-input"
                    aria-label="Name"
                    autoFocus
                    defaultValue={d.name ?? ''}
                    placeholder={tool?.label}
                    maxLength={60}
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitName(d.id, e.currentTarget.value);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    onBlur={(e) => {
                      if (editing === d.id) commitName(d.id, e.currentTarget.value);
                    }}
                  />
                ) : (
                  <span className="object-name">{name}</span>
                )}
                <span className="object-actions">
                  <button type="button" className="ghost icon" aria-label={`${hidden ? 'Show' : 'Hide'} ${name}`} title={hidden ? 'Show' : 'Hide'} aria-pressed={hidden} onClick={(e) => { e.stopPropagation(); entry!.actions.toggleHidden(d.id); }}>
                    {hidden ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                  <button type="button" className="ghost icon" aria-label={`${d.locked ? 'Unlock' : 'Lock'} ${name}`} title={d.locked ? 'Unlock' : 'Lock'} aria-pressed={d.locked === true} onClick={(e) => { e.stopPropagation(); entry!.actions.toggleLock([d.id]); }}>
                    <LockIcon />
                  </button>
                  <button type="button" className="ghost icon" aria-label={`Rename ${name}`} title="Rename" onClick={(e) => { e.stopPropagation(); setEditing(d.id); }}>
                    <PencilIcon />
                  </button>
                  <button type="button" className="ghost icon" aria-label={`Delete ${name}`} title="Delete" onClick={(e) => { e.stopPropagation(); entry!.actions.remove([d.id]); }}>
                    <TrashIcon />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
