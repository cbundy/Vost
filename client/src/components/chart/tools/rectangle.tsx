import { HIT_TOLERANCE, pointInRect, rectCornerDrag, rectCorners, type Pt } from '../../../lib/drawingGeometry';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import type { DrawingTool } from './types';

export const rectangle: DrawingTool = {
  id: 'rectangle',
  label: 'Rectangle',
  icon: (
    <Svg>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </Svg>
  ),
  anchors: 2,
  draw(ctx, [a, b], _view, { selected }) {
    const [tl, , br] = rectCorners(a, b);
    ctx.fillStyle = 'rgba(59,130,246,0.15)';
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.strokeStyle = selected ? theme.accent2 : theme.accent;
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  },
  hit: ([a, b], p, _view, tolerance = HIT_TOLERANCE) => pointInRect(p, a, b, tolerance),
  handles: ([a, b]) => rectCorners(a, b),
  dragHandle(origPts: Pt[], handle: number, p: Pt) {
    return rectCornerDrag(origPts[0], origPts[1], handle, p);
  },
};
