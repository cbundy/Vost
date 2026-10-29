import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { layoutKeyAction } from '../lib/layoutKeys';
import { currentEntry } from '../lib/savedLayouts';
import { leaveLayout, useLayoutUi, type LayoutDialog } from '../state/layoutUi';
import { useStore } from '../state/store';
import { DownloadDataDialog } from './DownloadDataDialog';
import { LayoutNameDialog } from './LayoutNameDialog';
import { OpenLayoutDialog } from './OpenLayoutDialog';
import { UnsavedLayoutDialog } from './UnsavedLayoutDialog';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true;
};

/** The layout dialogs and the layout keys. Mounted once, so they work whichever place the layout menu is in. */
export function LayoutDialogs() {
  const saveLayout = useStore((s) => s.saveLayout);
  const dialog = useLayoutUi((s) => s.dialog);
  const setDialog = useLayoutUi((s) => s.setDialog);

  /** Ctrl/Cmd+S saves anywhere (also in a text field); "." opens the list. Neither acts while a modal dialog is open. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = layoutKeyAction(e, { editable: isEditable(e.target), dialogOpen: document.querySelector('.modal-overlay') != null, mac: IS_MAC });
      if (!action) return;
      e.preventDefault();
      if (action === 'save') saveLayout();
      else setDialog({ kind: 'open' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveLayout, setDialog]);

  // Out of the top bar, whose button styles would otherwise reach the dialogs.
  return dialog ? createPortal(<ActiveDialog dialog={dialog} />, document.body) : null;
}

function ActiveDialog({ dialog }: { dialog: NonNullable<LayoutDialog> }) {
  const saved = useStore((s) => s.savedLayouts);
  const saveLayout = useStore((s) => s.saveLayout);
  const copyLayout = useStore((s) => s.copyLayout);
  const renameLayout = useStore((s) => s.renameLayout);
  const createLayout = useStore((s) => s.createLayout);
  const openLayout = useStore((s) => s.openLayout);
  const setDialog = useLayoutUi((s) => s.setDialog);
  const cur = currentEntry(saved);
  const name = cur?.name ?? 'Unnamed';
  const close = () => setDialog(null);
  switch (dialog.kind) {
    case 'copy':
      return (
        <LayoutNameDialog
          title="Make a copy"
          initial={`${name} copy`}
          okLabel="OK"
          onClose={close}
          onSubmit={(n) => {
            copyLayout(n);
            close();
          }}
        />
      );
    case 'rename':
      return (
        <LayoutNameDialog
          title="Rename layout"
          initial={name}
          okLabel="OK"
          onClose={close}
          onSubmit={(n) => {
            if (cur) renameLayout(cur.id, n);
            close();
          }}
        />
      );
    case 'create':
      return <LayoutNameDialog title="Create new layout" initial="" okLabel="OK" onClose={close} onSubmit={(n) => leaveLayout(() => createLayout(n))} />;
    case 'download':
      return <DownloadDataDialog onClose={close} />;
    case 'open':
      return <OpenLayoutDialog onClose={close} onOpen={(id) => (id === saved.currentId ? close() : leaveLayout(() => openLayout(id)))} />;
    case 'unsaved': {
      const go = dialog.then;
      return (
        <UnsavedLayoutDialog
          name={name}
          onClose={close}
          onSave={() => {
            saveLayout();
            close();
            go();
          }}
          onDiscard={() => {
            close();
            go();
          }}
        />
      );
    }
  }
}
