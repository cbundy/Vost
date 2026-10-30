/**
 * The drawing clipboard: one copy per browser tab, shared by every chart panel (not the system clipboard).
 * A pasted drawing keeps its anchors, so it lands at the same times and prices on any chart.
 */
import { registerImageRefs } from './drawingImages';
import { imageKeys, type Drawing } from './drawings';

let held: Drawing[] = [];
// A copied picture drawing must still find its picture when it is pasted: the sweep counts the clipboard as a reference.
registerImageRefs(() => imageKeys(held));
const listeners = new Set<() => void>();

/** Holds a snapshot of the drawings, replacing what was held. */
export function copyDrawings(drawings: readonly Drawing[]): void {
  held = drawings.map((d) => JSON.parse(JSON.stringify(d)) as Drawing);
  for (const l of [...listeners]) l();
}

/** What is held (a copy; the caller may not change the clipboard through it). */
export function readDrawings(): Drawing[] {
  return held.map((d) => JSON.parse(JSON.stringify(d)) as Drawing);
}

export const isClipboardEmpty = (): boolean => held.length === 0;

/** Called after each copy; returns the unsubscribe. */
export function subscribeClipboard(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
