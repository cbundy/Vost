import { useMemo, type MutableRefObject, type RefObject } from 'react';
import { prune } from '../../lib/drawingSelection';
import { MOUSE_HIT } from '../../lib/drawingGeometry';
import { copyDrawings, isClipboardEmpty, readDrawings } from '../../lib/drawingClipboard';
import { cloneMany, paste, removeAll, removeMany, rename, reorderMany, setLocked, type DrawingsState, type ReorderTo } from '../../lib/drawings';
import type { DrawingPrimitive } from './drawingPrimitive';
import { getTool } from './tools';

/** What the right-click menu shows about the selection the pointer is over (one drawing, or several). */
export type DrawingInfo = {
  /** The selected drawings in paint order. */
  ids: string[];
  count: number;
  /** One drawing's name or its tool's label, else "N drawings". */
  title: string;
  /** The one drawing's name; empty for several. */
  name: string;
  /** Every selected drawing is locked. */
  locked: boolean;
  /** Settings and Rename are for a single drawing. */
  hasSettings: boolean;
};

type Deps = {
  getState(): DrawingsState;
  setState(next: DrawingsState, persist: boolean): void;
  selectedRef: MutableRefObject<string[]>;
  primRef: MutableRefObject<DrawingPrimitive | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  hiddenRef: MutableRefObject<boolean>;
  sync(): void;
  /** Opens the drawing's settings dialog, or the note input for a note. */
  edit(id: string): void;
  deleteAll(): void;
};

/**
 * What the user can do to the selected drawing and to the chart's drawings: the keyboard shortcuts and the
 * right-click menu both go through these. Each edit is one undo step.
 */
export function useDrawingActions({ getState, setState, selectedRef, primRef, containerRef, hiddenRef, sync, edit, deleteAll }: Deps) {
  return useMemo(() => {
    const select = (ids: string[]) => {
      selectedRef.current = ids;
      sync();
    };
    /** The selected drawings in paint order. */
    const selected = () => {
      const set = new Set(selectedRef.current);
      return getState().drawings.filter((d) => set.has(d.id));
    };
    const find = (id: string) => getState().drawings.find((d) => d.id === id);
    const apply = (next: DrawingsState) => {
      if (next !== getState()) setState(next, true);
    };
    return {
      /** Selects (keeping a selection the drawing is in) and describes the drawing under a screen position; null over empty chart or while drawings are hidden. */
      drawingAt(clientX: number, clientY: number): DrawingInfo | null {
        const el = containerRef.current;
        const prim = primRef.current;
        if (!el || !prim || hiddenRef.current) return null;
        const r = el.getBoundingClientRect();
        const hit = prim.hit({ x: clientX - r.left, y: clientY - r.top }, MOUSE_HIT);
        const d = hit && find(hit.id);
        if (!d) return null;
        if (!selectedRef.current.includes(d.id)) select([d.id]);
        else sync();
        const list = selected();
        if (list.length > 1) {
          return { ids: list.map((x) => x.id), count: list.length, title: `${list.length} drawings`, name: '', locked: list.every((x) => x.locked === true), hasSettings: false };
        }
        const tool = getTool(d.tool);
        return { ids: [d.id], count: 1, title: d.name ?? tool?.label ?? d.tool, name: d.name ?? '', locked: d.locked === true, hasSettings: !!tool && (!!tool.settings || !!tool.text) };
      },
      edit,
      rename: (id: string, name: string) => apply(rename(getState(), id, name)),
      /** Locks them all, or unlocks them when every one is locked already. */
      toggleLock(ids: readonly string[]) {
        const list = getState().drawings.filter((d) => ids.includes(d.id));
        if (list.length > 0) apply(setLocked(getState(), ids, !list.every((d) => d.locked === true)));
      },
      reorder: (ids: readonly string[], to: ReorderTo) => apply(reorderMany(getState(), ids, to)),
      /** Copies drawings just above themselves and selects the copies. */
      clone(ids: readonly string[]) {
        const st = getState();
        const next = cloneMany(st, ids);
        if (next === st) return;
        const old = new Set(st.drawings.map((d) => d.id));
        setState(next, true);
        select(next.drawings.filter((d) => !old.has(d.id)).map((d) => d.id));
      },
      /** Puts drawings (the selection by default) on the tab's clipboard in paint order. */
      copy(ids?: readonly string[]) {
        const list = ids ? getState().drawings.filter((d) => ids.includes(d.id)) : selected();
        if (list.length > 0) copyDrawings(list);
      },
      /** Adds the clipboard's drawings to this chart's source and selects them. Returns whether anything was added. */
      paste(): boolean {
        const st = getState();
        const clip = readDrawings();
        const next = paste(st, clip);
        if (next === st) return false;
        setState(next, true);
        select(next.drawings.slice(st.drawings.length).map((d) => d.id));
        return true;
      },
      remove(ids: readonly string[]) {
        apply(removeMany(getState(), ids));
        select(prune(selectedRef.current, getState().drawings) as string[]);
      },
      canPaste: () => !isClipboardEmpty(),
      /** Whether "Remove drawings" has anything to remove. */
      canRemoveAll: () => removeAll(getState()) !== getState(),
      removeAll: deleteAll,
    };
  }, [getState, setState, selectedRef, primRef, containerRef, hiddenRef, sync, edit, deleteAll]);
}

export type DrawingActions = ReturnType<typeof useDrawingActions>;
