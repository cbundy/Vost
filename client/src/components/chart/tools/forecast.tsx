import { HIT_TOLERANCE, distToSegment, measureSummary } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { fmtDurationBarCount, fmtPct, fmtTime } from '../../../lib/format';
import { forecastVerdict, type ForecastVerdict } from '../../../lib/geometry/forecast';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { colorField, numberField, strokeColor, widthField } from './fields';
import { drawLabel } from './positionTool';
import type { DrawingTool } from './types';

const finiteAnchors = (anchors: readonly { time: number; price: number }[]) => anchors.every((a) => Number.isFinite(a.time) && Number.isFinite(a.price));

/** The verdict of a forecast drawing's anchors against the loaded bars; pending until both anchors are placed. */
export function forecastState(anchors: readonly { time: number; price: number }[], candles: Parameters<typeof forecastVerdict>[2]): ForecastVerdict {
  return anchors.length >= 2 && finiteAnchors(anchors.slice(0, 2)) ? forecastVerdict(anchors[0], anchors[1], candles) : 'pending';
}

/**
 * A Forecast: a line from a source price and time to a target price and time. A label gives the source price and
 * another the change, percent, date and bar count to the target. Once the loaded bars reach the target time it shows
 * Success when a bar after the source reached the target price, Failure otherwise.
 */
export const forecast: DrawingTool = {
  id: 'forecast',
  label: 'Forecast',
  group: 'forecast-measure',
  section: 'Forecasting',
  icon: (
    <Svg>
      <path d="M4 18 18 6" strokeDasharray="3 2" />
      <circle cx="4" cy="18" r="1.6" />
      <path d="M15 5h4v4" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    colorField('sourceColor', 'Source colour', 'accent'),
    colorField('targetColor', 'Target colour', 'accent'),
    colorField('successColor', 'Success colour', 'green'),
    colorField('failureColor', 'Failure colour', 'red'),
    widthField('width', 'Line width', 1),
    colorField('textColor', 'Text colour', 'text'),
    numberField('textSize', 'Font size', 12, 8, 48, 1),
  ],
  validate(d) {
    return d.anchors.length === 2 && finiteAnchors(d.anchors) ? d : null;
  },
  axisLabels: (anchors, _style, selected) => (selected && anchors.length >= 2 ? { price: [anchors[0].price, anchors[1].price], time: [anchors[1].time] } : {}),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const [a, b] = pts;
    const complete = view.anchors.length >= 2;
    const verdict = complete ? forecastState(view.anchors, view.candles) : 'pending';
    const verdictColor = verdict === 'success' ? cssColor(view.style.successColor) : verdict === 'failure' ? cssColor(view.style.failureColor) : null;
    const target = strokeColor(view, selected, theme.accent2, 'targetColor', null);
    const line = verdictColor ?? target;
    const source = selected && !view.styled ? theme.accent2 : cssColor(view.style.sourceColor);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, view.width, view.height);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = (view.style.width as number) + (selected ? 0.5 : 0);
    ctx.strokeStyle = line;
    ctx.stroke();
    for (const [p, c] of [[a, source], [b, line]] as const) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    }
    if (complete) {
      const [s, t] = view.anchors;
      const sum = measureSummary(s, t, view.times);
      const up = b.y <= a.y;
      const sign = sum.change > 0 ? '+' : '';
      drawLabel(ctx, [view.formatPrice(s.price)], a.x, a.y, !up, source, view);
      drawLabel(
        ctx,
        [`${sign}${view.formatPrice(sum.change)} (${sum.pct === null ? '-' : fmtPct(sum.pct)})`, fmtTime(t.time), fmtDurationBarCount(sum.bars)],
        b.x,
        b.y,
        up,
        target,
        view,
      );
      if (verdictColor) drawLabel(ctx, [verdict === 'success' ? 'Success' : 'Failure'], b.x, b.y, !up, verdictColor, view);
    }
    ctx.restore();
  },
  hit: ([a, b], p, _view, tolerance = HIT_TOLERANCE) => !!a && !!b && distToSegment(p, a, b) <= tolerance,
  handles: (pts) => pts,
};
