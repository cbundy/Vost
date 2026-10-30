/**
 * Getting a picture onto the chart: the file chooser, a pasted or dropped picture, the store call with its refusal
 * messages, and the picture waiting to be placed. The pointer steps that place it are in useDrawings.
 */
import { IMAGE_TOOL, ImageError, MESSAGES, putImage, registerImageRefs, sweepAll, type StoredImage } from '../../lib/drawingImages';
import { persistedImageKeys } from '../../lib/drawings';
import { forgetBitmap } from './imageCache';

export { IMAGE_TOOL };

/** The accepted types, for the file chooser. */
export const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

let pending: StoredImage | null = null;
registerImageRefs(() => (pending ? [pending.key] : []));

/** The picture chosen and waiting for a click to place it. */
export const getPending = (): StoredImage | null => pending;
export const setPending = (p: StoredImage | null): void => {
  pending = p;
};

/**
 * Stores a chosen file and makes it the pending picture. Returns the refusal message instead when it is refused; the
 * store sweeps once before it refuses a file for room.
 */
export async function adoptFile(file: Blob): Promise<{ ok: true; image: StoredImage } | { ok: false; message: string }> {
  try {
    const image = await putImage(file, { sweep: () => sweepAll(() => persistedImageKeys(), Date.now()) });
    forgetBitmap(image.key);
    pending = image;
    return { ok: true, image };
  } catch (err) {
    return { ok: false, message: err instanceof ImageError ? err.message : MESSAGES.decode };
  }
}

let input: HTMLInputElement | null = null;

/** Opens the file chooser; `onFile` gets the chosen file (nothing when it is cancelled). */
export function openChooser(onFile: (file: File) => void): void {
  if (!input || !input.isConnected) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.hidden = true;
    input.setAttribute('data-testid', 'drawing-image-input');
    document.body.appendChild(input);
  }
  const el = input;
  el.onchange = () => {
    const file = el.files?.[0];
    el.value = '';
    if (file) onFile(file);
  };
  el.click();
}

/** The first picture file in a paste or a drop, else null. */
export function pictureFrom(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const f of Array.from(data.files)) if (f.type.startsWith('image/')) return f;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** Whether a drag carries files (a picture may be dropped). */
export const dragHasFiles = (data: DataTransfer | null): boolean => !!data && Array.from(data.types ?? []).includes('Files');

/** The first file of a drop, of any type (a wrong one is refused with the message). */
export const droppedFile = (data: DataTransfer | null): File | null => (data && data.files.length > 0 ? data.files[0] : null);
