/**
 * Decoded pictures for the chart: one ImageBitmap per picture key, loaded on first use. `bitmapFor` never waits, so a
 * tool's draw can call it: it answers the bitmap, 'loading' while it is read or 'missing' when the store has no such
 * picture. When a load ends, subscribers (the drawing primitive's owner) repaint.
 */
import { getImage } from '../../lib/drawingImages';

export type BitmapState = ImageBitmap | 'loading' | 'missing';

const cache = new Map<string, BitmapState>();
const listeners = new Set<() => void>();

async function load(key: string): Promise<void> {
  let next: BitmapState = 'missing';
  try {
    const rec = await getImage(key);
    if (rec) next = await createImageBitmap(rec.blob);
  } catch {
    next = 'missing';
  }
  cache.set(key, next);
  for (const l of [...listeners]) l();
}

/** The picture's bitmap, 'loading' (a load has started) or 'missing'. */
export function bitmapFor(key: string): BitmapState {
  const hit = cache.get(key);
  if (hit) return hit;
  cache.set(key, 'loading');
  void load(key);
  return 'loading';
}

/** Forgets what is known of a picture, so the next draw reads the store again (after it was stored). */
export function forgetBitmap(key: string): void {
  const hit = cache.get(key);
  if (hit && typeof hit !== 'string') hit.close();
  cache.delete(key);
}

/** Called after each load; returns the unsubscribe. */
export function subscribeBitmaps(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
