import { useCallback, useEffect, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import type { Drawing, DrawingsState } from '../../lib/drawings';
import type { DrawingActions } from './useDrawingActions';
import type { DrawingPrimitive } from './drawingPrimitive';

/**
 * The active chart's drawings, published for the side panel (which sits outside every chart). One entry at a time:
 * the active chart's. Edits go through `actions`, the chart's own, so they land in its undo history.
 */
export type ActiveDrawings = {
  /** Who published it: only the owner can replace or clear the entry. */
  owner: object;
  /** In paint order (last paints on top). */
  drawings: readonly Drawing[];
  selected: readonly string[];
  /** The rail's Hide all is on. */
  hidden: boolean;
  /** Ids of drawings that do not show on the chart's current timeframe. */
  offTimeframe: readonly string[];
  actions: DrawingActions;
};

let current: ActiveDrawings | null = null;
const listeners = new Set<() => void>();

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Publishes the entry for its owner, replacing any other owner's. The snapshot stays the same object when nothing changed. */
export function publish(entry: ActiveDrawings): void {
  const c = current;
  if (
    c &&
    c.owner === entry.owner &&
    c.drawings === entry.drawings &&
    c.hidden === entry.hidden &&
    c.actions === entry.actions &&
    same(c.selected, entry.selected) &&
    same(c.offTimeframe, entry.offTimeframe)
  )
    return;
  current = entry;
  for (const l of [...listeners]) l();
}

/** Clears the entry, but only when this owner holds it. */
export function unpublish(owner: object): void {
  if (!current || current.owner !== owner) return;
  current = null;
  for (const l of [...listeners]) l();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const getSnapshot = (): ActiveDrawings | null => current;

/** The active chart's published drawings, or null when no chart is active. */
export const useActiveDrawings = (): ActiveDrawings | null => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

type Source = {
  active: boolean;
  /** Changes with the chart's symbol or dataset. */
  sourceKey: string;
  getState(): DrawingsState;
  selectedRef: MutableRefObject<string[]>;
  primRef: MutableRefObject<DrawingPrimitive | null>;
  hiddenRef: MutableRefObject<boolean>;
  actions: DrawingActions;
};

/**
 * Publishes a chart's drawings while it is the active one. Returns the function the chart calls after every change
 * to its drawings or selection; the entry is withdrawn when the chart stops being active or unmounts.
 */
export function usePublishDrawings(src: Source): () => void {
  const owner = useRef({}).current;
  const ref = useRef(src);
  ref.current = src;
  const push = useCallback(() => {
    const s = ref.current;
    if (!s.active) return;
    const st = s.getState();
    const prim = s.primRef.current;
    const offTimeframe = prim ? st.drawings.filter((d) => d.hidden !== true && !prim.shown(d)).map((d) => d.id) : [];
    publish({ owner, drawings: st.drawings, selected: [...s.selectedRef.current], hidden: s.hiddenRef.current, offTimeframe, actions: s.actions });
  }, [owner]);
  useEffect(() => {
    if (src.active) push();
    else unpublish(owner);
  }, [src.active, src.sourceKey, src.actions, push, owner]);
  useEffect(() => () => unpublish(owner), [owner]);
  return push;
}
