import { flushSync } from 'react-dom';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { TOOLS } from './chart/tools';
import {
  CURSOR,
  ERASER,
  entryPressed,
  groupEntry,
  groupPressed,
  railGroups,
  type CursorKind,
  type RailEntry,
  type RailGroup,
} from '../lib/drawingRail';
import { IMAGE_TOOL, MESSAGES } from '../lib/drawingImages';
import { DrawingFlyout } from './DrawingFlyout';
import { MAGNET_MODES, MagnetMenu, type MagnetMode } from './MagnetMenu';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CrossIcon,
  CursorIcon,
  DotIcon,
  EraserIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MagnetIcon,
  PencilIcon,
  StarIcon,
  StayIcon,
  TrashIcon,
} from './DrawingIcons';

export type DrawingControls = {
  tool: string;
  /** How the cursor mode looks. */
  cursorKind: CursorKind;
  onPick: (entry: RailEntry) => void;
  /** Starred entry keys, in favourites-bar order. */
  favorites: readonly string[];
  onToggleFavorite: (key: string) => void;
  /** The last entry key used from each family. */
  lastTool: Readonly<Record<string, string>>;
  /** No data to draw on. */
  disabled: boolean;
  /** Pictures cannot be stored in this browser (IndexedDB is unavailable): the Image tool is off. Absent: they can. */
  imagesOff?: boolean;
  magnet: boolean;
  onMagnet: () => void;
  magnetStrength: 'weak' | 'strong';
  /** Picks off, or on with a strength. */
  onMagnetMode: (m: MagnetMode) => void;
  /** Lock all drawings. */
  locked: boolean;
  onLocked: () => void;
  /** Stay in drawing mode. */
  stayMode: boolean;
  onStayMode: () => void;
  hidden: boolean;
  onHidden: () => void;
  canDeleteAll: boolean;
  onDeleteAll: () => void;
};

const LONG_PRESS_MS = 500;

/** The icon of a rail entry: a tool's own, or the cursor kinds and the eraser. */
export function entryIcon(e: RailEntry): ReactNode {
  if (e.key === ERASER) return <EraserIcon />;
  if (e.cursorKind === 'cross') return <CrossIcon />;
  if (e.cursorKind === 'dot') return <DotIcon />;
  if (e.cursorKind === 'arrow') return <CursorIcon />;
  return TOOLS.find((t) => t.id === e.toolId)?.icon ?? null;
}

/** Whether an entry cannot be picked now: every mode but the cursor kinds needs data and visible drawings. */
export function entryDisabled(e: RailEntry, c: Pick<DrawingControls, 'disabled' | 'hidden' | 'imagesOff'>): boolean {
  return e.toolId !== CURSOR && (c.disabled || c.hidden || (e.toolId === IMAGE_TOOL && !!c.imagesOff));
}

/** An entry's tooltip: its label, or why the Image tool is off. */
export function entryTitle(e: RailEntry, c: Pick<DrawingControls, 'imagesOff'>): string {
  return e.toolId === IMAGE_TOOL && c.imagesOff ? MESSAGES.unavailable : e.label;
}

/** The magnet's current mode. */
const magnetMode = (c: Pick<DrawingControls, 'magnet' | 'magnetStrength'>): MagnetMode => (c.magnet ? c.magnetStrength : 'off');

type SwitchItem =
  | { kind: 'magnet' }
  | { kind: 'toggle'; id: string; label: string; icon: ReactNode; pressed: boolean; onClick: () => void }
  | { kind: 'action'; id: string; label: string; icon: ReactNode; disabled: boolean; onClick: () => void };

/** The switches under the groups, on the rail and in the phone menu. */
function switches(c: DrawingControls): SwitchItem[] {
  return [
    { kind: 'magnet' },
    { kind: 'toggle', id: 'stay', label: 'Stay in drawing mode', icon: <StayIcon />, pressed: c.stayMode, onClick: c.onStayMode },
    { kind: 'toggle', id: 'lock', label: 'Lock all drawings', icon: <LockIcon />, pressed: c.locked, onClick: c.onLocked },
    { kind: 'toggle', id: 'hide', label: 'Hide all drawings', icon: c.hidden ? <EyeOffIcon /> : <EyeIcon />, pressed: c.hidden, onClick: c.onHidden },
    { kind: 'action', id: 'delete', label: 'Delete all drawings', icon: <TrashIcon />, disabled: !c.canDeleteAll, onClick: c.onDeleteAll },
  ];
}

function renderSwitches(c: DrawingControls, after?: (it: SwitchItem) => void, withMagnet = true): ReactNode {
  return switches(c).map((it) => {
    if (it.kind === 'magnet') return withMagnet ? <MagnetButton key="magnet" c={c} /> : null;
    const pressed = it.kind === 'toggle' ? it.pressed : undefined;
    return (
      <button
        key={it.id}
        type="button"
        className={`ghost icon rail-btn${pressed ? ' active' : ''}`}
        title={it.label}
        aria-label={it.label}
        aria-pressed={pressed}
        disabled={it.kind === 'action' ? it.disabled : false}
        onClick={() => {
          if (after) flushSync(() => after(it)); // the popover leaves the DOM before a confirm() opens
          it.onClick();
        }}
      >
        {it.icon}
      </button>
    );
  });
}

/** The magnet: a toggle between off and the last strength, a chevron (or long press, ArrowRight) for the mode menu. */
function MagnetButton({ c }: { c: DrawingControls }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const mode = magnetMode(c);
  const open = anchor !== null;
  const openMenu = () => setAnchor(wrapRef.current?.getBoundingClientRect() ?? null);
  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);
  const close = useCallback((restoreFocus: boolean) => {
    setAnchor(null);
    if (restoreFocus) btnRef.current?.focus();
  }, []);
  const title = mode === 'off' ? 'Magnet' : `Magnet: ${mode}`;

  return (
    <div className="rail-group" ref={wrapRef} data-rail-group="magnet">
      <button
        ref={btnRef}
        type="button"
        className={`ghost icon rail-btn${c.magnet ? ' active' : ''}`}
        title={title}
        aria-label="Magnet"
        aria-pressed={c.magnet}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          c.onMagnet();
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          longPressed.current = false;
          clearTimer();
          timer.current = window.setTimeout(() => {
            timer.current = null;
            longPressed.current = true;
            openMenu();
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <MagnetIcon mark={mode === 'off' ? undefined : mode} />
      </button>
      <button
        type="button"
        className="rail-chevron"
        aria-label="Open Magnet modes"
        title="Magnet modes"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openMenu())}
      >
        <ChevronRightIcon />
      </button>
      {anchor && (
        <MagnetMenu
          anchor={anchor}
          mode={mode}
          onPick={(m) => {
            c.onMagnetMode(m);
            close(true);
          }}
          onClose={close}
        />
      )}
    </div>
  );
}

/** One family on the rail: the button of its last tool, a chevron and, when open, the flyout. */
function GroupButton({ group, c, open, onOpen, onClose }: { group: RailGroup; c: DrawingControls; open: boolean; onOpen: () => void; onClose: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const entry = groupEntry(group, c.lastTool);
  const pressed = groupPressed(group, c.tool);

  const openFlyout = () => {
    setAnchor(wrapRef.current?.getBoundingClientRect() ?? null);
    onOpen();
  };
  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const close = useCallback(
    (restoreFocus: boolean) => {
      onClose();
      if (restoreFocus) btnRef.current?.focus();
    },
    [onClose],
  );

  return (
    <div className="rail-group" ref={wrapRef} data-rail-group={group.id}>
      <button
        ref={btnRef}
        type="button"
        className={`ghost icon rail-btn${pressed ? ' active' : ''}`}
        title={entryTitle(entry, c)}
        aria-label={entry.label}
        aria-pressed={pressed}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={entryDisabled(entry, c)}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          c.onPick(entry);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          longPressed.current = false;
          clearTimer();
          timer.current = window.setTimeout(() => {
            timer.current = null;
            longPressed.current = true;
            openFlyout();
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            openFlyout();
          }
        }}
      >
        {entryIcon(entry)}
      </button>
      <button
        type="button"
        className="rail-chevron"
        aria-label={`Open ${group.label} tools`}
        title={`${group.label} tools`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : openFlyout())}
      >
        <ChevronRightIcon />
      </button>
      {open && anchor && (
        <DrawingFlyout
          group={group}
          anchor={anchor}
          icon={entryIcon}
          isPressed={(e) => entryPressed(e, c.tool, c.cursorKind)}
          isDisabled={(e) => entryDisabled(e, c)}
          favorites={c.favorites}
          onPick={(e) => {
            c.onPick(e);
            close(true);
          }}
          onToggleFavorite={c.onToggleFavorite}
          onClose={close}
        />
      )}
    </div>
  );
}

/** The vertical rail at the chart's left edge: one button per tool family with a flyout, then the switches. */
export function DrawingRail(c: DrawingControls) {
  const groups = railGroups();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="drawing-rail" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      {groups.map((g) => (
        <GroupButton key={g.id} group={g} c={c} open={openId === g.id} onOpen={() => setOpenId(g.id)} onClose={() => setOpenId((cur) => (cur === g.id ? null : cur))} />
      ))}
      <div className="rail-divider" role="separator" />
      {renderSwitches(c)}
    </div>
  );
}

/** Below 600px the rail is hidden; this button opens the same families, as collapsible sections, in a popover. */
export function DrawingMenu(c: DrawingControls) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const groups = railGroups();

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

  /** The popover's offset from its wrapper: its left edge sits 8px from the screen's (the toolbar clips nothing but is not at the edge). */
  const [shift, setShift] = useState({ left: 0, maxHeight: 0 });
  const toggleMenu = () => {
    if (!open) {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setShift({ left: 8 - r.left, maxHeight: window.innerHeight - r.bottom - 14 });
    }
    if (!open) setExpanded(new Set(groups.filter((g) => groupPressed(g, c.tool)).map((g) => g.id)));
    setOpen((v) => !v);
  };

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
        onClick={toggleMenu}
      >
        <PencilIcon />
      </button>
      {open && (
        <div className="drawing-menu-pop" role="group" aria-label="Drawing tools menu" style={{ left: shift.left, maxHeight: shift.maxHeight }}>
          {groups.map((g) => {
            const isOpen = expanded.has(g.id);
            return (
              <div key={g.id} className="menu-group">
                <button
                  type="button"
                  className={`menu-group-head${groupPressed(g, c.tool) ? ' active' : ''}`}
                  aria-expanded={isOpen}
                  aria-controls={`menu-group-${g.id}`}
                  onClick={() =>
                    setExpanded((cur) => {
                      const next = new Set(cur);
                      if (next.has(g.id)) next.delete(g.id);
                      else next.add(g.id);
                      return next;
                    })
                  }
                >
                  <span>{g.label}</span>
                  <ChevronDownIcon />
                </button>
                {isOpen && (
                  <div id={`menu-group-${g.id}`} className="menu-group-body">
                    {g.sections.map((s) => (
                      <div key={s.title} className="menu-section" role="group" aria-label={s.title}>
                        {g.sections.length > 1 || s.title !== g.label ? <div className="fly-heading">{s.title}</div> : null}
                        {s.entries.map((e) => {
                          const fav = c.favorites.includes(e.key);
                          const on = entryPressed(e, c.tool, c.cursorKind);
                          return (
                            <div key={e.key} className="fly-row">
                              <button
                                type="button"
                                className={`fly-item${on ? ' active' : ''}`}
                                title={entryTitle(e, c)}
                                aria-label={e.label}
                                aria-pressed={on}
                                disabled={entryDisabled(e, c)}
                                onClick={() => {
                                  setOpen(false);
                                  c.onPick(e);
                                }}
                              >
                                <span className="fly-icon">{entryIcon(e)}</span>
                                <span className="fly-label">{e.label}</span>
                              </button>
                              <button
                                type="button"
                                className={`fly-star${fav ? ' on' : ''}`}
                                aria-label={`Favorite ${e.label}`}
                                aria-pressed={fav}
                                title={fav ? 'Remove from favorites' : 'Add to favorites'}
                                onClick={() => c.onToggleFavorite(e.key)}
                              >
                                <StarIcon filled={fav} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="rail-divider" role="separator" />
          <div className="menu-switches">
            {renderSwitches(
              c,
              (it) => {
                if (it.kind === 'action' && it.id === 'delete') setOpen(false);
              },
              false,
            )}
          </div>
          <div className="menu-magnet" role="radiogroup" aria-label="Magnet">
            <div className="fly-heading">Magnet</div>
            {MAGNET_MODES.map((m) => {
              const on = magnetMode(c) === m.mode;
              return (
                <button key={m.mode} type="button" role="radio" aria-checked={on} className={`fly-item${on ? ' active' : ''}`} onClick={() => c.onMagnetMode(m.mode)}>
                  <span className="fly-label">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
