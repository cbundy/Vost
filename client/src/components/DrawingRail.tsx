import { flushSync } from 'react-dom';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CURSOR } from './chart/useDrawings';
import { TOOLS } from './chart/tools';
import { CursorIcon, EyeIcon, EyeOffIcon, MagnetIcon, PencilIcon, TrashIcon } from './DrawingIcons';

export type DrawingControls = {
  tool: string;
  onPick: (id: string) => void;
  /** No data to draw on. */
  disabled: boolean;
  magnet: boolean;
  onMagnet: () => void;
  hidden: boolean;
  onHidden: () => void;
  canDeleteAll: boolean;
  onDeleteAll: () => void;
};

type Item =
  | { kind: 'tool'; id: string; label: string; icon: ReactNode; pressed: boolean; disabled: boolean }
  | { kind: 'toggle'; id: string; label: string; icon: ReactNode; pressed: boolean; disabled: boolean; onClick: () => void }
  | { kind: 'action'; id: string; label: string; icon: ReactNode; disabled: boolean; onClick: () => void }
  | { kind: 'divider'; id: string };

/** The one list of entries both the rail and the phone menu render: tools, a divider, then the switches. */
function buildItems(c: DrawingControls): Item[] {
  const tools: Item[] = [
    { id: CURSOR, label: 'Cursor', icon: <CursorIcon /> },
    ...TOOLS.map((t) => ({ id: t.id, label: t.label, icon: t.icon })),
  ].map((t) => ({
    kind: 'tool' as const,
    ...t,
    pressed: c.tool === t.id,
    disabled: t.id !== CURSOR && (c.disabled || c.hidden),
  }));
  return [
    ...tools,
    { kind: 'divider', id: 'divider' },
    { kind: 'toggle', id: 'magnet', label: 'Magnet', icon: <MagnetIcon />, pressed: c.magnet, disabled: false, onClick: c.onMagnet },
    {
      kind: 'toggle',
      id: 'hide',
      label: 'Hide all drawings',
      icon: c.hidden ? <EyeOffIcon /> : <EyeIcon />,
      pressed: c.hidden,
      disabled: false,
      onClick: c.onHidden,
    },
    { kind: 'action', id: 'delete', label: 'Delete all drawings', icon: <TrashIcon />, disabled: !c.canDeleteAll, onClick: c.onDeleteAll },
  ];
}

function renderItems(items: Item[], c: DrawingControls, after?: (item: Item) => void): ReactNode {
  return items.map((it) => {
    if (it.kind === 'divider') return <div key={it.id} className="rail-divider" role="separator" />;
    const pressed = it.kind === 'action' ? undefined : it.pressed;
    return (
      <button
        key={it.id}
        type="button"
        className={`ghost icon rail-btn${pressed ? ' active' : ''}`}
        title={it.label}
        aria-label={it.label}
        aria-pressed={pressed}
        disabled={it.disabled}
        onClick={() => {
          if (after) flushSync(() => after(it)); // the popover leaves the DOM before a confirm() opens
          if (it.kind === 'tool') c.onPick(it.id);
          else it.onClick();
        }}
      >
        {it.icon}
      </button>
    );
  });
}

/** The vertical tool rail at the chart's left edge: Cursor, one button per drawing tool, then the switches. */
export function DrawingRail(c: DrawingControls) {
  return (
    <div className="drawing-rail" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      {renderItems(buildItems(c), c)}
    </div>
  );
}

/** Below 600px the rail is hidden; this button opens the same entries in a popover. */
export function DrawingMenu(c: DrawingControls) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // pointerdown, not mousedown: the chart eats mousedown while a draw press is claimed.
    const onDown = (ev: PointerEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <div
      className="drawing-menu"
      ref={wrapRef}
      onKeyDown={(e) => {
        if (open && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          btnRef.current?.focus();
        }
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className="ghost icon"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Drawing tools"
        title="Drawing tools"
        onClick={() => setOpen((v) => !v)}
      >
        <PencilIcon />
      </button>
      {open && (
        <div className="drawing-menu-pop" role="group" aria-label="Drawing tools menu">
          {renderItems(buildItems(c), c, (it) => {
            if (it.kind === 'tool' || (it.kind === 'action' && it.id === 'delete')) setOpen(false);
          })}
        </div>
      )}
    </div>
  );
}
