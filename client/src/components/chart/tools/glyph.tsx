import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import type { Drawing } from '../../../lib/drawings';
import { glyphImage, iconPath } from '../../../lib/iconSets/glyphImages';
import { lookupGlyph, type GlyphKind } from '../../../lib/iconSets';
import { GLYPH_SIZE_MAX, GLYPH_SIZE_MIN, ROTATE_HANDLE_GAP, angleFromDrag, boxCorners, pointInBox, rotationHandle, sizeFromCorner } from '../../../lib/geometry/rotate';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { colorField, numberField, opacityField } from './fields';
import type { DrawingTool, ToolView } from './types';

/** Default side in pixels: an icon or emoji is small, a sticker large. */
const DEFAULT_SIZE: Record<GlyphKind, number> = { icon: 40, emoji: 40, sticker: 80 };

/** A stored glyph that is not a non-empty string is dropped; an id the set does not have is kept (it draws a placeholder). */
function validate(d: Drawing): Drawing | null {
  return typeof d.glyph === 'string' && d.glyph.length > 0 ? d : null;
}

/** The dashed box with a question mark: a glyph still loading, or one whose id the set does not have. */
function placeholder(ctx: CanvasRenderingContext2D, size: number, mark: boolean): void {
  const h = size / 2;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.muted;
  ctx.strokeRect(-h, -h, size, size);
  ctx.setLineDash([]);
  if (!mark) return;
  ctx.font = `${Math.max(8, Math.round(size * 0.6))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.muted;
  ctx.fillText('?', 0, 0);
}

/** One of the three glyph tools. They differ in the set they draw from, the rail icon, the default size and the icons' colour. */
function glyphTool(kind: GlyphKind, label: string, icon: DrawingTool['icon']): DrawingTool {
  const sized = (view: ToolView) => ({ size: view.style.size as number, angle: view.style.angle as number });
  return {
    id: kind,
    label,
    group: 'icons',
    section: 'Pictures',
    icon,
    anchors: 1,
    glyph: true,
    settings: [
      numberField('size', 'Size', DEFAULT_SIZE[kind], GLYPH_SIZE_MIN, GLYPH_SIZE_MAX, 1),
      numberField('angle', 'Angle', 0, 0, 359, 1),
      opacityField('opacity', 'Opacity', 1),
      ...(kind === 'icon' ? [colorField('color', 'Colour', 'accent')] : []),
    ],
    validate,
    draw(ctx, [c], view, { selected }) {
      const { size, angle } = sized(view);
      // The selection handles are drawn after this, in chart pixels: the turned frame is left again below.
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate((angle * Math.PI) / 180);
      const found = lookupGlyph(kind, view.glyph);
      ctx.save();
      ctx.globalAlpha = view.style.opacity as number;
      if (found.state === 'ready' && kind === 'icon') {
        const path = iconPath(`${kind}:${view.glyph}`, found.entry);
        if (!path) placeholder(ctx, size, true);
        else {
          ctx.scale(size / 24, size / 24);
          ctx.translate(-12, -12);
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = cssColor(view.style.color);
          ctx.stroke(path);
        }
      } else if (found.state === 'ready') {
        const img = glyphImage(`${kind}:${view.glyph}`, found.entry);
        if (img) ctx.drawImage(img, -size / 2, -size / 2, size, size);
        else placeholder(ctx, size, false);
      } else placeholder(ctx, size, found.state === 'missing');
      ctx.restore();
      if (selected) {
        const h = size / 2;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = !view.styled ? theme.accent2 : theme.text;
        ctx.strokeRect(-h, -h, size, size);
        ctx.setLineDash([]);
        // The stalk to the rotation handle.
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(0, -h - ROTATE_HANDLE_GAP);
        ctx.stroke();
      }
      ctx.restore();
    },
    hit([c], p, view, tolerance = HIT_TOLERANCE) {
      const { size, angle } = sized(view);
      return pointInBox(p, c, size, angle, tolerance);
    },
    handles([c], view) {
      const { size, angle } = sized(view);
      return [...boxCorners(c, size, angle), rotationHandle(c, size, angle)];
    },
    // A handle drag changes the size or the angle, never the anchor.
    dragStyle([c], handle, p, _view, { shift }) {
      if (handle < 4) return { size: sizeFromCorner(c, p) };
      if (handle === 4) return { angle: angleFromDrag(c, p, shift) };
      return null;
    },
  };
}

export const icon = glyphTool(
  'icon',
  'Icons',
  <Svg>
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  </Svg>,
);

export const emoji = glyphTool(
  'emoji',
  'Emojis',
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
  </Svg>,
);

export const sticker = glyphTool(
  'sticker',
  'Stickers',
  <Svg>
    <path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8l6-6V5a2 2 0 0 0-2-2zM14 21v-4a2 2 0 0 1 2-2h4" />
  </Svg>,
);

export const glyphTools: readonly DrawingTool[] = [icon, emoji, sticker];
