import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ISeriesApi } from 'lightweight-charts';
import { subscribeClipboard } from '../lib/drawingClipboard';
import type { DrawingActions, DrawingInfo } from './chart/useDrawingActions';

interface Menu {
  x: number;
  y: number;
  price: number;
  label: string;
  /** Set when the pointer was over a drawing: the menu is that drawing's. */
  drawing?: DrawingInfo;
}

/**
 * Right-click on the chart: a small menu at the pointer. Over empty chart it holds "Add alert at <price>", Paste and
 * Remove drawings; over a drawing (which it selects) it holds that drawing's actions.
 * The browser's own menu is suppressed over the chart only, and only while data is loaded.
 */
export function ChartContextMenu({
  containerRef,
  seriesRef,
  precision,
  enabled,
  onAddAlert,
  drawings,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>;
  precision: number;
  enabled: boolean;
  onAddAlert: (level: number) => void;
  drawings: DrawingActions;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [, bump] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => subscribeClipboard(() => bump((n) => n + 1)), []);
  const actions = useRef(drawings);
  actions.current = drawings;
  useEffect(() => setRenaming(false), [menu]);

  /* The menu stays inside the window whatever the size of the screen. */
  useLayoutEffect(() => {
    const m = menuRef.current;
    if (!menu || !m) return setShift(null);
    const r = m.getBoundingClientRect();
    const left = Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4));
    const top = Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4));
    setShift(left === menu.x && top === menu.y ? null : { left, top });
  }, [menu, renaming]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) {
      setMenu(null);
      return;
    }
    const onContext = (ev: MouseEvent): void => {
      const series = seriesRef.current;
      if (!series) return;
      ev.preventDefault();
      const drawing = actions.current.drawingAt(ev.clientX, ev.clientY);
      if (drawing) return setMenu({ x: ev.clientX, y: ev.clientY, price: 0, label: '', drawing });
      const price = series.coordinateToPrice(ev.clientY - el.getBoundingClientRect().top);
      if (price == null) return setMenu(null);
      const label = price.toFixed(precision);
      setMenu({ x: ev.clientX, y: ev.clientY, price: Number(label), label });
    };
    el.addEventListener('contextmenu', onContext);
    return () => el.removeEventListener('contextmenu', onContext);
  }, [containerRef, seriesRef, precision, enabled]);

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close();
    };
    const onDown = (ev: MouseEvent): void => {
      if (!(ev.target instanceof Element) || !ev.target.closest('.chart-context-menu')) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu) return null;
  const close = (): void => setMenu(null);
  const run = (f: () => void) => () => {
    close();
    f();
  };
  const pos = shift ?? { left: menu.x, top: menu.y };
  const d = menu.drawing;
  if (d) {
    const item = (label: string, f: () => void) => (
      <button role="menuitem" onClick={run(f)}>
        {label}
      </button>
    );
    return (
      <div ref={menuRef} className="chart-context-menu" role="menu" aria-label={d.title} style={pos}>
        <div className="chart-context-menu-title">{d.title}</div>
        {d.hasSettings && item('Settings', () => actions.current.edit(d.ids[0]))}
        {d.count > 1 ? null : renaming ? (
          <input
            className="chart-context-menu-input"
            aria-label="Name"
            autoFocus
            defaultValue={d.name}
            maxLength={60}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                const name = ev.currentTarget.value;
                close();
                actions.current.rename(d.ids[0], name);
              }
            }}
          />
        ) : (
          <button role="menuitem" onClick={() => setRenaming(true)}>
            Rename
          </button>
        )}
        {d.table && (
          <>
            <button role="menuitem" disabled={!d.table.canAddRow} onClick={run(() => actions.current.editTable(d.ids[0], 'addRow', d.table!.row, d.table!.col))}>
              Add row below
            </button>
            <button role="menuitem" disabled={!d.table.canAddColumn} onClick={run(() => actions.current.editTable(d.ids[0], 'addColumn', d.table!.row, d.table!.col))}>
              Add column right
            </button>
            <button role="menuitem" disabled={!d.table.canDeleteRow} onClick={run(() => actions.current.editTable(d.ids[0], 'deleteRow', d.table!.row, d.table!.col))}>
              Delete row
            </button>
            <button role="menuitem" disabled={!d.table.canDeleteColumn} onClick={run(() => actions.current.editTable(d.ids[0], 'deleteColumn', d.table!.row, d.table!.col))}>
              Delete column
            </button>
          </>
        )}
        {item('Clone', () => actions.current.clone(d.ids))}
        {item('Copy', () => actions.current.copy(d.ids))}
        {item(d.locked ? 'Unlock' : 'Lock', () => actions.current.toggleLock(d.ids))}
        {item('Hide', () => actions.current.setHidden(d.ids, true))}
        {item('Bring to front', () => actions.current.reorder(d.ids, 'front'))}
        {item('Bring forward', () => actions.current.reorder(d.ids, 'forward'))}
        {item('Send backward', () => actions.current.reorder(d.ids, 'backward'))}
        {item('Send to back', () => actions.current.reorder(d.ids, 'back'))}
        {item('Delete', () => actions.current.remove(d.ids))}
      </div>
    );
  }
  return (
    <div ref={menuRef} className="chart-context-menu" role="menu" style={pos}>
      <button
        role="menuitem"
        onClick={() => {
          setMenu(null);
          onAddAlert(menu.price);
        }}
      >
        Add alert at {menu.label}
      </button>
      <button role="menuitem" disabled={!drawings.canPaste()} onClick={run(() => actions.current.paste())}>
        Paste
      </button>
      <button
        role="menuitem"
        disabled={!drawings.canRemoveAll()}
        onClick={run(() => actions.current.removeAll())}
      >
        Remove drawings
      </button>
    </div>
  );
}
