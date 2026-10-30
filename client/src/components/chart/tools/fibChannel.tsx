import { HIT_TOLERANCE, distToSegment, type Pt } from '../../../lib/drawingGeometry';
import { FIB_EXTENSION_TABLE, cssColor } from '../../../lib/drawingStyle';
import { extendAcross, parallelEdge, parallelOffset, pointInPolygon } from '../../../lib/geometry/channels';
import { fibChannelOffsets } from '../../../lib/geometry/fib';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { anchorLabels, strokeSegment } from './channelShared';
import { applyDash, boolField, lineStyleField, opacityField, widthField } from './fields';
import { drawLevelLabel, drawPath, enabledLevels } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type Edge = { ratio: number; color: string; seg: [Pt, Pt] };

/** One edge per enabled level: A-B moved by ratio times the offset of C. */
function edges(pts: Pt[], view: ToolView): Edge[] {
  if (pts.length < 3) return [];
  const [a, b, c] = pts;
  const d = parallelOffset(a, b, c);
  if (!Number.isFinite(d)) return [];
  const on = enabledLevels(view.style);
  const offs = fibChannelOffsets(d, on.map((l) => l.value));
  return on.map((l, i) => {
    const [p, q] = parallelEdge(a, b, offs[i]);
    return { ratio: l.value, color: l.color, seg: extendAcross(p, q, view.width, view.style.extendLeft === true, view.style.extendRight === true) };
  });
}

/** Lines parallel to A-B at the Fibonacci ratios of the distance from A-B to C. */
export const fibChannel: DrawingTool = {
  id: 'fibChannel',
  label: 'Fib channel',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <line x1="3" y1="18" x2="21" y2="10" />
      <line x1="3" y1="14" x2="21" y2="6" />
      <line x1="3" y1="22" x2="21" y2="14" />
    </Svg>
  ),
  anchors: 3,
  settings: [
    { key: 'levels', label: 'Levels', kind: 'levels', tab: 'style', default: FIB_EXTENSION_TABLE },
    widthField('width', 'Width', 1),
    lineStyleField('lineStyle', 'Line style'),
    boolField('background', 'Background', false),
    opacityField('backgroundOpacity', 'Background opacity', 0.12),
    boolField('extendLeft', 'Extend left', false),
    boolField('extendRight', 'Extend right', false),
    boolField('showLevels', 'Show levels', true, 'text'),
  ],
  axisLabels: (anchors, _style, selected) => anchorLabels(anchors, selected),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    if (pts.length < 3) {
      ctx.strokeStyle = theme.muted2;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      strokeSegment(ctx, pts[0], pts[1]);
      ctx.setLineDash([]);
      return;
    }
    const es = edges(pts, view);
    if (view.style.background === true) {
      for (let i = 1; i < es.length; i++) {
        const poly = [es[i - 1].seg[0], es[i - 1].seg[1], es[i].seg[1], es[i].seg[0]];
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fillStyle = cssColor(es[i].color, view.style.backgroundOpacity as number);
        ctx.fill();
      }
    }
    ctx.lineWidth = (view.style.width as number) + (selected ? 0.5 : 0);
    ctx.save();
    applyDash(ctx, view.style.lineStyle);
    for (const e of es) {
      ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(e.color);
      strokeSegment(ctx, e.seg[0], e.seg[1]);
    }
    ctx.restore();
    if (view.style.showLevels === true) {
      for (const e of es) {
        const left = e.seg[0];
        drawLevelLabel(ctx, `${e.ratio}`, Math.max(2, Math.min(left.x + 4, view.width - 40)), left.y - 2);
      }
    }
    drawPath(ctx, pts);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 2) return false;
    if (pts.length < 3) return distToSegment(p, pts[0], pts[1]) <= tolerance;
    if (distToSegment(p, pts[0], pts[1]) <= tolerance || distToSegment(p, pts[1], pts[2]) <= tolerance) return true;
    const es = edges(pts, view);
    if (es.some((e) => distToSegment(p, e.seg[0], e.seg[1]) <= tolerance)) return true;
    if (view.style.background !== true) return false;
    return es.some((e, i) => i > 0 && pointInPolygon(p, [es[i - 1].seg[0], es[i - 1].seg[1], e.seg[1], e.seg[0]]));
  },
  handles: (pts) => pts,
};
