import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { flagHit, flagShape } from '../../../lib/geometry/markers';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { axisAtAnchors } from './axisAtAnchors';
import { colorField } from './fields';
import { NOTE_BLUE } from './textBox';
import type { DrawingTool } from './types';

/** A flag mark: one anchor on a bar's time, a small pole with a filled flag. Default colour is TradingView's blue (not confirmed against its settings dialog from here). */
export const flagMark: DrawingTool = {
  id: 'flagMark',
  label: 'Flag mark',
  group: 'annotations',
  section: 'Notes',
  icon: (
    <Svg>
      <path d="M6 21V4M6 5h12l-3 4 3 4H6" />
    </Svg>
  ),
  anchors: 1,
  barTime: true,
  settings: [colorField('color', 'Colour', NOTE_BLUE)],
  axisLabels: axisAtAnchors,
  draw(ctx, [anchor], view, { selected }) {
    const { pole, flag } = flagShape(anchor);
    const color = selected && !view.styled ? theme.accent2 : cssColor(view.style.color);
    ctx.beginPath();
    ctx.moveTo(pole[0].x, pole[0].y);
    ctx.lineTo(pole[1].x, pole[1].y);
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    flag.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  },
  hit: ([anchor], p, _view, tolerance = HIT_TOLERANCE) => flagHit(anchor, p, tolerance),
  handles: (pts) => pts,
};
