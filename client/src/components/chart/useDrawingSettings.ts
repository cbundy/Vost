import { useCallback, useEffect, useRef, useState } from 'react';
import { commit, previewPatch, type Drawing, type DrawingPatch, type DrawingsState } from '../../lib/drawings';
import { useStore } from '../../state/store';
import { getTool, type DrawingTool } from './tools';

/** What the settings dialog works on while it is open. */
export type DrawingSettingsModel = {
  /** The drawing as it was when the dialog opened. */
  drawing: Drawing;
  tool: DrawingTool;
  /** The user's saved default style for the tool. */
  userDefault: Record<string, unknown> | undefined;
  /** Shows an edit on the chart now, without history. */
  onPreview(patch: DrawingPatch): void;
  /** Keeps every edit as one undo step and closes. */
  onApply(): void;
  /** Puts the drawing back as it was and closes. */
  onCancel(): void;
  /** Stores the style as the default for new drawings of the tool. */
  onSaveDefault(style: Record<string, unknown>): void;
};

type Open = { id: string; before: Drawing[]; key: string };

type Deps = {
  /** The key of the shown source; the dialog closes (cancelling) when it changes. */
  sourceKey: string;
  getState(): DrawingsState;
  /** Puts drawings back as the (maybe no longer shown) source's current ones, without saving. */
  restore(key: string, drawings: Drawing[]): void;
  setState(next: DrawingsState, persist: boolean): void;
  /** Called with the id when the dialog opens so the drawing is selected. */
  select(id: string | null): void;
};

/**
 * The drawing settings dialog's state for one chart: which drawing is open, the live preview and the commit or
 * restore. The preview and the final commit use the drawings' preview/commit pair, so OK is one undo step and
 * Cancel leaves no trace.
 */
export function useDrawingSettings({ sourceKey, getState, restore, setState, select }: Deps) {
  const [open, setOpen] = useState<Open | null>(null);
  const openRef = useRef<Open | null>(null);
  const defaults = useStore((s) => s.drawingDefaults);

  const set = useCallback((v: Open | null) => {
    openRef.current = v;
    setOpen(v);
  }, []);

  const openSettings = useCallback(
    (id: string) => {
      const st = getState();
      const d = st.drawings.find((x) => x.id === id);
      const tool = d && getTool(d.tool);
      if (!d || !tool?.settings || openRef.current) return;
      select(id);
      set({ id, before: st.drawings, key: sourceKey });
    },
    [getState, select, set, sourceKey],
  );

  const cancel = useCallback(() => {
    const cur = openRef.current;
    if (!cur) return;
    set(null);
    setState({ ...getState(), drawings: cur.before }, false);
  }, [getState, set, setState]);

  const apply = useCallback(() => {
    const cur = openRef.current;
    if (!cur) return;
    set(null);
    setState(commit(getState(), cur.before), true);
  }, [getState, set, setState]);

  const onPreview = useCallback(
    (patch: DrawingPatch) => {
      const cur = openRef.current;
      if (cur) setState(previewPatch(getState(), cur.id, patch), false);
    },
    [getState, setState],
  );

  /* Another source on this chart: the dialog's drawing is not shown any more, so its edits are dropped. */
  useEffect(() => {
    const cur = openRef.current;
    if (!cur || cur.key === sourceKey) return;
    restore(cur.key, cur.before);
    set(null);
  }, [sourceKey, restore, set]);

  const drawing = open ? open.before.find((d) => d.id === open.id) : undefined;
  const tool = drawing && getTool(drawing.tool);
  const model: DrawingSettingsModel | null =
    open && drawing && tool
      ? {
          drawing,
          tool,
          userDefault: Object.prototype.hasOwnProperty.call(defaults, tool.id) ? defaults[tool.id] : undefined,
          onPreview,
          onApply: apply,
          onCancel: cancel,
          onSaveDefault: (style) => useStore.getState().setDrawingDefault(tool.id, style),
        }
      : null;

  return { settings: model, openSettings, settingsOpenRef: openRef };
}
