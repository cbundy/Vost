/**
 * Images of the full-colour glyphs (emojis and stickers) for the canvas, and Path2D shapes of the icons. Both are
 * built once per entry and cached. An image loads asynchronously: until it has, the cache gives null and the drawing
 * shows its placeholder; when it finishes the subscribers of `onGlyphLoaded` are told, so the chart repaints.
 */
import { notifyGlyphLoaded, type GlyphEntry } from './index';

const images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();
const paths = new Map<string, Path2D | null>();

/** An SVG document as a data URL the canvas can draw; a size is added to its root so the image has one. */
export function svgDataUrl(svg: string): string {
  const sized = svg.replace(/<svg\b/, '<svg width="128" height="128"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
}

/** The loaded image of an emoji or sticker, or null while it loads (it starts loading) or when it failed or the environment has no images. */
export function glyphImage(key: string, entry: GlyphEntry): HTMLImageElement | null {
  const have = images.get(key);
  if (have === 'loading' || have === 'failed') return null;
  if (have) return have;
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  images.set(key, 'loading');
  img.onload = () => {
    images.set(key, img);
    notifyGlyphLoaded();
  };
  img.onerror = () => images.set(key, 'failed');
  img.src = svgDataUrl(entry.data);
  return null;
}

/** The Path2D of an icon (all its shapes), or null when the environment has none or the data is unusable. */
export function iconPath(key: string, entry: GlyphEntry): Path2D | null {
  if (paths.has(key)) return paths.get(key) ?? null;
  let p: Path2D | null = null;
  if (typeof Path2D !== 'undefined') {
    try {
      p = new Path2D();
      for (const d of entry.data.split('|')) p.addPath(new Path2D(d));
    } catch {
      p = null;
    }
  }
  paths.set(key, p);
  return p;
}
