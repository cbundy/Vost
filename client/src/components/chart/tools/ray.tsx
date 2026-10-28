import { HIT_TOLERANCE, distToSegment, rayEnd } from '../../../lib/drawingGeometry';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import type { DrawingTool } from './types';

export const ray: DrawingTool = {
  id: 'ray',
  label: 'Ray',
  icon: (
    <Svg>
      <circle cx="5" cy="19" r="2" />
      <line x1="6.5" y1="17.5" x2="21" y2="3" />
      <polyline points="15,3 21,3 21,9" />
    </Svg>
  ),
  anchors: 2,
  draw(ctx, [a, b], { width, height }, { selected }) {
    const end = rayEnd(a, b, width, height);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = selected ? theme.accent2 : theme.accent;
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.stroke();
  },
  hit: ([a, b], p, { width, height }, tolerance = HIT_TOLERANCE) => distToSegment(p, a, rayEnd(a, b, width, height)) <= tolerance,
  handles: (pts) => pts,
};
