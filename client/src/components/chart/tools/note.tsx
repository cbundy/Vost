import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { inRect, pinHit, pinPath, popupRect } from '../../../lib/geometry/notes';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { colorField } from './fields';
import { NOTE_BLUE, layoutOf, noteTextSettings, paintTextBox } from './textBox';
import type { DrawingTool } from './types';

/** The pin marker, tip at the anchor. */
function paintPin(ctx: CanvasRenderingContext2D, tip: { x: number; y: number }, color: string, selected: boolean, unstyled: boolean): void {
  const pin = pinPath(tip);
  ctx.beginPath();
  ctx.moveTo(pin.tip.x, pin.tip.y);
  ctx.lineTo(pin.left.x, pin.left.y);
  const from = Math.atan2(pin.left.y - pin.centre.y, pin.left.x - pin.centre.x);
  const to = Math.atan2(pin.right.y - pin.centre.y, pin.right.x - pin.centre.x);
  // Round the head over the top, from the left side clockwise to the right side.
  ctx.arc(pin.centre.x, pin.centre.y, pin.r, from, to + Math.PI * 2, false);
  ctx.closePath();
  ctx.fillStyle = selected && unstyled ? theme.accent2 : color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(pin.centre.x, pin.centre.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
}

/**
 * A note: a pin whose text pops up in a box while the pin is hovered, selected or pinned open by a click.
 * Defaults are TradingView's: a blue marker and box with white 14 px text (not confirmed against its settings dialog
 * from here: change `NOTE_BLUE` / `NOTE_WHITE` in textBox.ts if they differ).
 */
function noteTool(id: string, label: string, pane: boolean): DrawingTool {
  return {
    id,
    label,
    group: 'annotations',
    section: 'Notes',
    icon: (
      <Svg>
        <path d={pane ? 'M12 3a5 5 0 0 1 5 5c0 4-5 9-5 9S7 12 7 8a5 5 0 0 1 5-5zM9 21h6M12 17v4' : 'M12 3a5 5 0 0 1 5 5c0 4-5 11-5 11S7 12 7 8a5 5 0 0 1 5-5zM12 8h.01'} />
      </Svg>
    ),
    anchors: 1,
    text: true,
    ...(pane ? { paneAnchored: true as const } : {}),
    settings: [colorField('markerColor', 'Marker colour', NOTE_BLUE), ...noteTextSettings(14, true)],
    draw(ctx, [tip], view, { selected }) {
      paintPin(ctx, tip, cssColor(view.style.markerColor), selected, !view.styled);
    },
    hit: ([tip], p, _view, tolerance = HIT_TOLERANCE) => pinHit(tip, p, tolerance),
    handles: ([tip]) => [tip],
    popup(ctx, [tip], view) {
      const box = layoutOf(view.text, view.style);
      const r = popupRect(tip, box, view);
      paintTextBox(ctx, view, r, box, false);
    },
    popupHit([tip], p, view, tolerance = HIT_TOLERANCE) {
      return inRect(popupRect(tip, layoutOf(view.text, view.style), view), p, tolerance);
    },
  };
}

export const note: DrawingTool = noteTool('note', 'Note', false);
/** A note fixed on the pane, like Anchored text. */
export const anchoredNote: DrawingTool = noteTool('anchoredNote', 'Anchored note', true);
