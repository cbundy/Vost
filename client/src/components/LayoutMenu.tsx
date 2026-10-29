import { useEffect, useRef, useState } from 'react';
import { activeMarket, currentEntry, recent } from '../lib/savedLayouts';
import { useTopKeydown } from '../lib/useDialogKeys';
import { leaveLayout, useLayoutUi, type LayoutDialog } from '../state/layoutUi';
import { useStore } from '../state/store';
import { IS_MAC } from './LayoutDialogs';

const SAVE_HINT = IS_MAC ? 'Cmd + S' : 'Ctrl + S';

/**
 * The layout's name with its menu: save, autosave, copy, rename, download, create, recent and open. It sits in the
 * top bar; on narrow screens it sits in the More menu (`inline`), where the menu opens in the flow and `onDone` closes More.
 */
export function LayoutMenu({ inline = false, onDone }: { inline?: boolean; onDone?: () => void }) {
  const saved = useStore((s) => s.savedLayouts);
  const dirty = useStore((s) => s.layoutDirty);
  const saveLayout = useStore((s) => s.saveLayout);
  const setAutosave = useStore((s) => s.setAutosave);
  const openLayout = useStore((s) => s.openLayout);
  const setDialog = useLayoutUi((s) => s.setDialog);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const name = currentEntry(saved)?.name ?? 'Unnamed';
  const unsaved = !saved.autosave && dirty;
  const recents = recent(saved);

  useEffect(() => {
    if (!open || inline) return;
    const onDown = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, inline]);

  useTopKeydown(open && !inline, (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    setOpen(false);
    btnRef.current?.focus();
  });

  const done = () => {
    setOpen(false);
    onDone?.();
  };
  const item = (label: string, onClick: () => void, hint?: string) => (
    <button role="menuitem" className="lm-item" onClick={onClick}>
      <span>{label}</span>
      {hint && <span className="lm-hint">{hint}</span>}
    </button>
  );
  const pick = (kind: Exclude<NonNullable<LayoutDialog>['kind'], 'unsaved'>) => () => {
    done();
    setDialog({ kind });
  };

  return (
    <div className={`layout-name-wrap${inline ? ' inline' : ''}`} ref={wrapRef}>
      <button
        ref={btnRef}
        className="ghost layout-name-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Layout: ${name}`}
        title={unsaved ? `${name} (unsaved changes)` : name}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="layout-name">{name}</span>
        {unsaved && <span className="layout-unsaved" role="img" aria-label="Unsaved changes" />}
        <span className="layout-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="lm-menu" role="menu" aria-label="Layout">
          {item(
            'Save layout',
            () => {
              saveLayout();
              done();
            },
            SAVE_HINT,
          )}
          <div className="lm-row">
            <span id="lm-autosave">Autosave</span>
            <button type="button" role="switch" className="switch" aria-checked={saved.autosave} aria-labelledby="lm-autosave" onClick={() => setAutosave(!saved.autosave)} />
          </div>
          <div className="lm-sep" role="separator" />
          {item('Make a copy...', pick('copy'))}
          {item('Rename...', pick('rename'))}
          {item('Download chart data...', pick('download'))}
          <div className="lm-sep" role="separator" />
          {item('Create new layout...', pick('create'))}
          {recents.length > 0 && (
            <>
              <div className="lm-sep" role="separator" />
              <div className="lm-heading">Recently used</div>
              {recents.map((l) => (
                <button
                  key={l.id}
                  role="menuitem"
                  className="lm-item lm-recent"
                  onClick={() => {
                    done();
                    leaveLayout(() => openLayout(l.id));
                  }}
                >
                  <span className="lm-recent-name">{l.name}</span>
                  <span className="lm-sub">{activeMarket(l.layout)}</span>
                </button>
              ))}
            </>
          )}
          <div className="lm-sep" role="separator" />
          {item('Open layout...', pick('open'), '.')}
        </div>
      )}
    </div>
  );
}
