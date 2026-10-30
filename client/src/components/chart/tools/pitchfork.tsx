import { HIT_TOLERANCE, distToSegment, type Pt } from '../../../lib/drawingGeometry';
import { cssColor, type FibLevel } from '../../../lib/drawingStyle';
import {
  DEFAULT_PITCHFORK_LEVELS,
  PITCHFORK_VARIANTS,
  clipLine,
  medianOrigin,
  pitchforkLines,
  pointInPolygon,
  type PitchforkVariant,
} from '../../../lib/geometry/pitchfork';
import { Svg } from '../../DrawingIcons';
import { anchorLabels, strokeSegment } from './channelShared';
import { applyDash, boolField, choiceField, colorField, lineStyleField, opacityField, strokeWidth, widthField } from './fields';
import type { DrawingTool, ToolView } from './types';

const MEDIAN_COLOR = '#F23645';

const variantOf = (view: ToolView, fallback: PitchforkVariant): PitchforkVariant =>
  (PITCHFORK_VARIANTS.find((v) => v.value === view.style.variant)?.value ?? fallback);

function shape(pts: Pt[], view: ToolView, fallback: PitchforkVariant) {
  return pitchforkLines(
    variantOf(view, fallback),
    [pts[0], pts[1], pts[2]],
    view.style.levels as FibLevel[],
    view.width,
    view.height,
    view.style.extendLines === true,
  );
}

/** One pitchfork tool: the four share their geometry and settings and differ in the median origin they start with. */
function pitchforkTool(id: string, label: string, variant: PitchforkVariant, tines: [number, number][]): DrawingTool {
  return {
    id,
    label,
    group: 'lines',
    section: 'Pitchforks',
    icon: (
      <Svg>
        <line x1="3" y1="20" x2="21" y2="4" />
        {tines.map(([a, b], i) => (
          <line key={i} x1={a} y1={b} x2={a + 12} y2={b - 12} />
        ))}
      </Svg>
    ),
    anchors: 3,
    settings: [
      choiceField('variant', 'Style', variant, PITCHFORK_VARIANTS),
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
      const v = variantOf(view, variant);
      ctx.lineCap = 'butt';
      if (pts.length < 3) {
        // Preview: the first tine P1-P2 and the median from its origin towards P2.
        ctx.strokeStyle = cssColor(view.style.medianColor);
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        strokeSegment(ctx, pts[0], pts[1]);
        const o = medianOrigin(v, pts[0], pts[1]);
        const seg = clipLine(o, { x: pts[1].x - o.x, y: pts[1].y - o.y }, view.width, view.height, false);
        if (seg) strokeSegment(ctx, seg[0], seg[1]);
        return;
      }
      const s = shape(pts, view, variant);
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
      ctx.strokeStyle = cssColor(view.style.medianColor);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      strokeSegment(ctx, s.handle[0], s.handle[1]);
      ctx.setLineDash([]);
    },
    hit(pts, p, view, tolerance = HIT_TOLERANCE) {
      if (pts.length < 3) return pts.length === 2 && distToSegment(p, pts[0], pts[1]) <= tolerance;
      const s = shape(pts, view, variant);
      const near = (seg: readonly [Pt, Pt]) => distToSegment(p, seg[0], seg[1]) <= tolerance;
      if (near(s.handle)) return true;
      if (view.style.showMedian !== false && s.median && near(s.median)) return true;
      if (s.lines.some((l) => near(l.seg))) return true;
      return view.style.background === true && s.fills.some((f) => pointInPolygon(p, f.poly));
    },
    handles: (pts) => pts,
  };
}

export const pitchfork = pitchforkTool('pitchfork', 'Pitchfork', 'original', [[3, 12], [9, 20]]);
export const schiffPitchfork = pitchforkTool('schiffPitchfork', 'Schiff pitchfork', 'schiff', [[3, 9], [11, 20]]);
export const modifiedSchiffPitchfork = pitchforkTool('modifiedSchiffPitchfork', 'Modified Schiff pitchfork', 'modifiedSchiff', [[6, 14], [10, 20]]);
export const insidePitchfork = pitchforkTool('insidePitchfork', 'Inside pitchfork', 'inside', [[4, 15], [12, 20]]);
