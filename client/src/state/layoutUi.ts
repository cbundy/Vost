/** Which layout dialog is open (the layout menu opens them, `LayoutDialogs` shows them) and the check before leaving a layout. */
import { create } from 'zustand';
import { useStore } from './store';

export type LayoutDialog = { kind: 'copy' | 'rename' | 'create' | 'download' | 'open' } | { kind: 'unsaved'; then: () => void } | null;

export const useLayoutUi = create<{ dialog: LayoutDialog; setDialog(d: LayoutDialog): void }>()((set) => ({
  dialog: null,
  setDialog: (dialog) => set({ dialog }),
}));

/** Runs a switch to another layout, asking first when autosave is off and the screen has unsaved changes. */
export function leaveLayout(go: () => void): void {
  const s = useStore.getState();
  if (!s.savedLayouts.autosave && s.layoutDirty) useLayoutUi.getState().setDialog({ kind: 'unsaved', then: go });
  else {
    useLayoutUi.getState().setDialog(null);
    go();
  }
}
