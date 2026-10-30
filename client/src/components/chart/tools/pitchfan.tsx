import { HIT_TOLERANCE, distToSegment, type Pt } from '../../../lib/drawingGeometry';
import { cssColor, type FibLevel } from '../../../lib/drawingStyle';
import { pointInPolygon } from '../../../lib/geometry/channels';
import { pitchfanShape } from '../../../lib/geometry/fib';
import { DEFAULT_PITCHFORK_LEVELS } from '../../../lib/geometry/pitchfork';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { anchorLabels, strokeSegment } from './channelShared';
import { applyDash, boolField, colorField, lineStyleField, opacityField, strokeWidth, widthField } from './fields';
import type { DrawingTool, ToolView } from './types';

const MEDIAN_COLOR = '#F23645';

function shape(pts: Pt[], view: ToolView) {
  return pitchfanShape(pts[0], pts[1], pts[2], view.style.levels as FibLevel[], view.width, view.height, view.style.extendLines === true);
}

/** Lines from A through the Fibonacci points of the segment B-C. */
export const pitchfan: DrawingTool = {
  id: 'pitchfan',
  label: 'Pitchfan',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <line x1="4" y1="20" x2="20" y2="5" />
      <line x1="4" y1="20" x2="20" y2="12" />
      <line x1="4" y1="20" x2="20" y2="19" />
      <line x1="20" y1="5" x2="20" y2="19" />
    </Svg>
  ),
  anchors: 3,
  settings: [
    boolField('showMedian', 'Median', true),
    colorField('medianColor', 'Median colour', MEDIAN_COLOR),
    widthField('medianWidth', 'Median width', 2),
    lineStyleField('medianLineStyle', 'Median style'),
    { key: 'levels', label: 'Levels', kind: 'levels', tab: 'style', default: DEFAULT_PITCHFORK_LEVELS },
    widthField('width', 'Level width', 1),
    lineStyleField('lineStyle', 'Level style'),
    boolField('background', 'Background', true),
    opacityField('backgroundOpacity', 'Background opacity', 0.2),
    boolField('extendLines', 'Extend lines', false),
  ],
  axisLabels: (anchors, _style, selected) => anchorLabels(anchors, selected),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    ctx.lineCap = 'butt';
    if (pts.length < 3) {
      ctx.strokeStyle = cssColor(view.style.medianColor);
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      strokeSegment(ctx, pts[0], pts[1]);
      return;
    }
    const s = shape(pts, view);
    if (view.style.background === true) {
      for (const f of s.fills) {
        ctx.beginPath();
        ctx.moveTo(f.poly[0].x, f.poly[0].y);
        for (const p of f.poly.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fillStyle = cssColor(f.color, view.style.backgroundOpacity as number);
        ctx.fill();
      }
    }
    ctx.lineWidth = strokeWidth(view, selected);
    applyDash(ctx, view.style.lineStyle);
    for (const l of s.lines) {
      ctx.strokeStyle = cssColor(l.color);
      strokeSegment(ctx, l.seg[0], l.seg[1]);
    }
    if (view.style.showMedian !== false && s.median) {
      ctx.strokeStyle = cssColor(view.style.medianColor);
      ctx.lineWidth = strokeWidth(view, selected, 'medianWidth');
      applyDash(ctx, view.style.medianLineStyle);
      strokeSegment(ctx, s.median[0], s.median[1]);
    }
    ctx.strokeStyle = theme.muted2;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    strokeSegment(ctx, pts[1], pts[2]);
    ctx.setLineDash([]);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 3) return pts.length === 2 && distToSegment(p, pts[0], pts[1]) <= tolerance;
    const s = shape(pts, view);
    const near = (seg: readonly [Pt, Pt]) => distToSegment(p, seg[0], seg[1]) <= tolerance;
    if (near([pts[1], pts[2]])) return true;
    if (view.style.showMedian !== false && s.median && near(s.median)) return true;
    if (s.lines.some((l) => near(l.seg))) return true;
    return view.style.background === true && s.fills.some((f) => pointInPolygon(p, f.poly));
  },
  handles: (pts) => pts,
};
