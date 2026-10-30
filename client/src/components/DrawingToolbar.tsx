import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { colorHex, LINE_STYLES } from '../lib/drawingStyle';
import { placeToolbar, type ToolbarSpot } from '../lib/toolbarPlacement';
import { SWATCHES, widthChoices } from '../lib/toolbarPickers';
import { theme } from '../lib/theme';
import { drawingMenuItems } from './chart/drawingMenuItems';
import type { ToolbarModel } from './chart/useDrawingToolbar';
import type { DrawingActions } from './chart/useDrawingActions';
import { LockIcon, TrashIcon } from './DrawingIcons';

type Popover = 'color' | 'width' | 'lineStyle' | 'more';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * The toolbar that floats over the one selected drawing: quick colour, width and line style, settings, lock, clone,
 * delete and a menu with the right-click menu's items. It sits in the chart area beside the chart container and stops
 * its pointer events, so a press on it never draws, drags, deselects or pans.
 */
export function DrawingToolbar({ model, actions, onStyle }: { model: ToolbarModel; actions: DrawingActions; onStyle(id: string, key: string, value: unknown): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<Popover, HTMLButtonElement>());
  const [open, setOpen] = useState<Popover | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [spot, setSpot] = useState<ToolbarSpot | null>(null);
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const { id, pickers, values } = model;

  /* A different drawing starts with everything closed. */
  useEffect(() => {
    setOpen(null);
    setRenaming(false);
  }, [id]);

  /* Placed from its measured size, so it wraps or shrinks with the chart. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = placeToolbar(model.box, { width: el.offsetWidth, height: el.offsetHeight }, model.area);
    setSpot((cur) => (cur && cur.left === next.left && cur.top === next.top && cur.side === next.side ? cur : next));
  });

  /* A popover stays inside the window. */
  useLayoutEffect(() => {
    const p = popRef.current;
    const b = open && buttons.current.get(open);
    if (!p || !b) return setPop(null);
    const r = b.getBoundingClientRect();
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    const left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4));
    const below = r.bottom + 4;
    const top = below + h + 4 > window.innerHeight ? Math.max(4, r.top - h - 4) : below;
    setPop({ left, top });
  }, [open, renaming, spot]);

  const close = (focus: boolean) => {
    const was = open;
    setOpen(null);
    setRenaming(false);
    if (focus && was) buttons.current.get(was)?.focus();
  };

  /* An outside press closes the open popover. */
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: PointerEvent) => {
      if (!(ev.target instanceof Node) || !ref.current?.contains(ev.target)) {
        setOpen(null);
        setRenaming(false);
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && open) {
      ev.preventDefault();
      ev.stopPropagation();
      close(true);
    }
  };

  const stop = (ev: { stopPropagation(): void }) => ev.stopPropagation();
  const btn = (key: Popover, label: string, content: ReactNode) => (
    <button
      type="button"
      className="dt-btn"
      ref={(el) => {
        if (el) buttons.current.set(key, el);
        else buttons.current.delete(key);
      }}
      aria-label={label}
      title={label}
      aria-haspopup="true"
      aria-expanded={open === key}
      onClick={() => setOpen(open === key ? null : key)}
    >
      {content}
    </button>
  );
  const plain = (label: string, content: ReactNode, onClick: () => void, pressed?: boolean) => (
    <button type="button" className="dt-btn" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {content}
    </button>
  );

  const colorField = pickers.color;
  const widthField = pickers.width;
  const styleField = pickers.lineStyle;
  const info = actions.infoFor(id);
  const items = open === 'more' && info ? drawingMenuItems(info, actions) : [];
  const pick = (key: string, value: unknown) => {
    onStyle(id, key, value);
  };

  let popover: ReactNode = null;
  if (open === 'color' && colorField) {
    const cur = colorHex(values[colorField.key]);
    popover = (
      <>
        <div className="dt-swatches">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              className="dt-swatch"
              style={{ background: theme[s] }}
              aria-label={cap(s)}
              title={cap(s)}
              aria-pressed={cur === theme[s]}
              onClick={() => pick(colorField.key, s)}
            />
          ))}
        </div>
        <label className="dt-custom">
          Custom
          <input type="color" value={cur ?? '#3b82f6'} aria-label={`Custom ${colorField.label.toLowerCase()}`} onChange={(e) => pick(colorField.key, e.target.value)} />
        </label>
      </>
    );
  } else if (open === 'width' && widthField) {
    popover = (
      <div className="dt-list">
        {widthChoices(widthField).map((w) => (
          <button key={w} type="button" role="menuitemradio" aria-checked={values[widthField.key] === w} onClick={() => pick(widthField.key, w)}>
            <span className="dt-line" style={{ borderTopWidth: w }} /> {w}px
          </button>
        ))}
      </div>
    );
  } else if (open === 'lineStyle' && styleField) {
    popover = (
      <div className="dt-list">
        {LINE_STYLES.map((s) => (
          <button key={s} type="button" role="menuitemradio" aria-checked={values[styleField.key] === s} onClick={() => pick(styleField.key, s)}>
            <span className="dt-line" style={{ borderTopStyle: s }} /> {cap(s)}
          </button>
        ))}
      </div>
    );
  } else if (open === 'more' && info) {
    popover = (
      <div role="menu" aria-label={`${info.title} menu`} className="dt-list">
        {items.map((it) =>
          it.special === 'rename' && renaming ? (
            <input
              key={it.key}
              className="chart-context-menu-input"
              aria-label="Name"
              autoFocus
              defaultValue={info.name}
              maxLength={60}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  const name = ev.currentTarget.value;
                  close(true);
                  actions.rename(id, name);
                }
              }}
            />
          ) : (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => {
                if (it.special === 'rename') return setRenaming(true);
                close(false);
                it.run();
              }}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="drawing-toolbar"
      role="toolbar"
      aria-label={`${model.title} tools`}
      style={spot ? { left: spot.left, top: spot.top } : { visibility: 'hidden' }}
      data-side={spot?.side}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onWheel={stop}
      onKeyDown={onKeyDown}
    >
      {colorField && btn('color', colorField.label, <span className="dt-chip" style={{ background: colorHex(values[colorField.key]) ?? theme.accent }} />)}
      {widthField && btn('width', widthField.label, <span className="dt-line" style={{ borderTopWidth: Math.min(4, Number(values[widthField.key]) || 1) }} />)}
      {styleField && btn('lineStyle', styleField.label, <span className="dt-line" style={{ borderTopStyle: String(values[styleField.key]) as 'solid' }} />)}
      {model.hasSettings && plain('Settings', '⚙', () => actions.edit(id))}
      {plain('Lock', <LockIcon />, () => actions.toggleLock([id]), model.locked)}
      {plain('Clone', '⧉', () => actions.clone([id]))}
      {plain('Delete', <TrashIcon />, () => actions.remove([id]))}
      {btn('more', 'More', '⋯')}
      {open && (
        <div ref={popRef} className="dt-popover" style={pop ? { left: pop.left, top: pop.top } : { visibility: 'hidden' }}>
          {popover}
        </div>
      )}
    </div>
  );
}
