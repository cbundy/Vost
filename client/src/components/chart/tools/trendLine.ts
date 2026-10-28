import { HIT_TOLERANCE, distToSegment } from '../../../lib/drawingGeometry';
import { theme } from '../../../lib/theme';
import type { DrawingTool } from './types';

export const trendLine: DrawingTool = {
  id: 'trendLine',
  label: 'Trend line',
  anchors: 2,
  draw(ctx, [a, b], { selected }) {
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
