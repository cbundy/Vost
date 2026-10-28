import { HIT_TOLERANCE, distToSegment } from '../../../lib/drawingGeometry';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import type { DrawingTool } from './types';

export const trendLine: DrawingTool = {
  id: 'trendLine',
  label: 'Trend line',
  icon: (
    <Svg>
      <line x1="5" y1="19" x2="19" y2="5" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="5" r="2" />
    </Svg>
  ),
  anchors: 2,
  draw(ctx, [a, b], _view, { selected }) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = selected ? theme.accent2 : theme.accent;
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.stroke();
  },
  hit: ([a, b], p) => distToSegment(p, a, b) <= HIT_TOLERANCE,
  handles: (pts) => pts,
};
