import { useCallback, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { Rect } from '../../lib/drawingSelection';
import { CURSOR } from '../../lib/drawingRail';
import { setStyle, type DrawingsState } from '../../lib/drawings';
import { pickerFields, withStyleValue, type Pickers } from '../../lib/toolbarPickers';
import type { DrawingPrimitive } from './drawingPrimitive';
import { getTool } from './tools';

/** What the floating toolbar shows for the one selected drawing. Boxes are in chart-area (`.chart-main`) pixels. */
export type ToolbarModel = {
  id: string;
  tool: string;
  title: string;
  locked: boolean;
  hasSettings: boolean;
  box: Rect;
  area: { width: number; height: number };
  pickers: Pickers;
  /** The effective value of each picker's field. */
  values: Record<string, unknown>;
};

type Deps = {
  getState(): DrawingsState;
  setState(next: DrawingsState, persist: boolean): void;
  selectedRef: MutableRefObject<string[]>;
  primRef: MutableRefObject<DrawingPrimitive | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  hiddenRef: MutableRefObject<boolean>;
  toolRef: MutableRefObject<string>;
  /** A drag is in progress. */
  isDragging(): boolean;
  /** The settings dialog or the note or table editor is open. */
  isEditing(): boolean;
};

/**
 * Keeps the floating toolbar's model current: `refresh` is called when the drawings or the selection change, and the
 * primitive calls it (once per frame) on every chart repaint, so the toolbar follows a pan, a zoom, a price-scale drag
 * and a resize. The model changes only when something it shows changed.
 */
export function useDrawingToolbar({ getState, setState, selectedRef, primRef, containerRef, hiddenRef, toolRef, isDragging, isEditing }: Deps) {
  const [model, setModel] = useState<ToolbarModel | null>(null);
  const lastRef = useRef('');
  const depsRef = useRef({ isDragging, isEditing });
  depsRef.current = { isDragging, isEditing };

  const refresh = useCallback(() => {
    const next = compute();
    const json = JSON.stringify(next);
    if (json === lastRef.current) return;
    lastRef.current = json;
    setModel(next);

    function compute(): ToolbarModel | null {
      const prim = primRef.current;
      const el = containerRef.current;
      const sel = selectedRef.current;
      if (!prim || !el || sel.length !== 1 || hiddenRef.current || toolRef.current !== CURSOR) return null;
      if (depsRef.current.isDragging() || depsRef.current.isEditing()) return null;
      const d = getState().drawings.find((x) => x.id === sel[0]);
      const tool = d && getTool(d.tool);
      if (!d || !tool) return null;
      const local = prim.boxOf(d);
      const area = el.parentElement;
      if (!local || !area) return null;
      const dx = el.offsetLeft;
      const dy = el.offsetTop;
      const pickers = pickerFields(tool.settings);
      const style = prim.styleValues(d);
      const values: Record<string, unknown> = {};
      for (const f of Object.values(pickers)) values[f.key] = style[f.key];
      return {
        id: d.id,
        tool: d.tool,
        title: d.name ?? tool.label,
        locked: d.locked === true,
        hasSettings: !!tool.settings || !!tool.text,
        box: { left: local.left + dx, right: local.right + dx, top: local.top + dy, bottom: local.bottom + dy },
        area: { width: area.clientWidth, height: area.clientHeight },
        pickers,
        values,
      };
    }
  }, [getState, selectedRef, primRef, containerRef, hiddenRef, toolRef]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  /** Re-places on the primitive's repaints, at most once per frame. */
  const follow = useCallback((prim: DrawingPrimitive | null): (() => void) => {
    if (!prim) return () => {};
    let frame = 0;
    prim.onViewsUpdated = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        refreshRef.current();
      });
    };
    return () => {
      if (frame) cancelAnimationFrame(frame);
      prim.onViewsUpdated = null;
    };
  }, []);

  /** Sets one style value of a drawing, keeping its others: one undo step, and a no-op when it is already that value. */
  const setStyleField = useCallback(
    (id: string, key: string, value: unknown) => {
      const st = getState();
      const d = st.drawings.find((x) => x.id === id);
      if (!d) return;
      const next = setStyle(st, id, withStyleValue(d.style, key, value));
      if (next !== st) setState(next, true);
    },
    [getState, setState],
  );

  return { model, refresh, follow, setStyleField };
}
