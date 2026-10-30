import { useMemo, type MutableRefObject, type RefObject } from 'react';
import { MOUSE_HIT } from '../../lib/drawingGeometry';
import { copyDrawings, isClipboardEmpty, readDrawings } from '../../lib/drawingClipboard';
import { cloneMany, paste, removeAll, removeMany, rename, reorder, setLocked, type DrawingsState, type ReorderTo } from '../../lib/drawings';
import type { DrawingPrimitive } from './drawingPrimitive';
import { getTool } from './tools';

/** What the right-click menu shows about the drawing under the pointer. */
export type DrawingInfo = { id: string; /** Its name, or its tool's label. */ title: string; name: string; locked: boolean; hasSettings: boolean };

type Deps = {
  getState(): DrawingsState;
  setState(next: DrawingsState, persist: boolean): void;
  selectedRef: MutableRefObject<string | null>;
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
    const select = (id: string | null) => {
      selectedRef.current = id;
      sync();
    };
    const find = (id: string) => getState().drawings.find((d) => d.id === id);
    const apply = (next: DrawingsState) => {
      if (next !== getState()) setState(next, true);
    };
    return {
      /** Selects and describes the drawing under a screen position; null over empty chart or while drawings are hidden. */
      drawingAt(clientX: number, clientY: number): DrawingInfo | null {
        const el = containerRef.current;
        const prim = primRef.current;
        if (!el || !prim || hiddenRef.current) return null;
        const r = el.getBoundingClientRect();
        const hit = prim.hit({ x: clientX - r.left, y: clientY - r.top }, MOUSE_HIT);
        const d = hit && find(hit.id);
        if (!d) return null;
        select(d.id);
        const tool = getTool(d.tool);
        return { id: d.id, title: d.name ?? tool?.label ?? d.tool, name: d.name ?? '', locked: d.locked === true, hasSettings: !!tool && (!!tool.settings || !!tool.text) };
      },
      edit,
      rename: (id: string, name: string) => apply(rename(getState(), id, name)),
      toggleLock(id: string) {
        const d = find(id);
        if (d) apply(setLocked(getState(), [id], d.locked !== true));
      },
      reorder: (id: string, to: ReorderTo) => apply(reorder(getState(), id, to)),
      /** Copies a drawing just above itself and selects the copy. */
      clone(id: string) {
        const st = getState();
        const next = cloneMany(st, [id]);
        if (next === st) return;
        setState(next, true);
        select(next.drawings[next.drawings.findIndex((d) => d.id === id) + 1].id);
      },
      /** Puts a drawing (the selected one by default) on the tab's clipboard. */
      copy(id: string | null = selectedRef.current) {
        const d = id ? find(id) : undefined;
        if (d) copyDrawings([d]);
      },
      /** Adds the clipboard's drawings to this chart's source and selects them. Returns whether anything was added. */
      paste(): boolean {
        const st = getState();
        const clip = readDrawings();
        const next = paste(st, clip);
        if (next === st) return false;
        setState(next, true);
        select(next.drawings[next.drawings.length - 1].id);
        return true;
      },
      remove(id: string) {
        apply(removeMany(getState(), [id]));
        if (selectedRef.current === id) select(null);
      },
      canPaste: () => !isClipboardEmpty(),
      /** Whether "Remove drawings" has anything to remove. */
      canRemoveAll: () => removeAll(getState()) !== getState(),
      removeAll: deleteAll,
    };
  }, [getState, setState, selectedRef, primRef, containerRef, hiddenRef, sync, edit, deleteAll]);
}

export type DrawingActions = ReturnType<typeof useDrawingActions>;
