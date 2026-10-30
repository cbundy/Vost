import { measureSummary } from '../../../lib/drawingGeometry';
import { fmtDurationBarCount, fmtElapsed, fmtPct } from '../../../lib/format';
import { rgba, theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import type { DrawingTool } from './types';

const FONT = '12px sans-serif';
const PAD = 6;
const LINE = 16;

export const measure: DrawingTool = {
  id: 'measure',
  label: 'Measure',
  group: 'forecast-measure',
  section: 'Measurers',
  icon: (
    <Svg>
      <path d="M3 16 16 3l5 5L8 21z" />
      <path d="M7 12l2 2M10 9l2 2M13 6l2 2" />
    </Svg>
  ),
  anchors: 2,
  transient: true,
  draw(ctx, [a, b], view) {
    const [start, end] = view.anchors;
    const s = measureSummary(start, end, view.times);
    const color = s.direction === 'up' ? theme.green : s.direction === 'down' ? theme.red : theme.muted;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.fillStyle = rgba(color, 0.15);
    ctx.fillRect(x0, y0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.strokeRect(x0, y0, w, h);

    const sign = s.change > 0 ? '+' : '';
    const l1 = `${sign}${view.formatPrice(s.change)} (${s.pct === null ? '—' : fmtPct(s.pct)})`;
    const l2 = `${fmtDurationBarCount(s.bars)}, ${fmtElapsed(s.seconds)}`;
    ctx.font = FONT;
    const lw = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + PAD * 2;
    const lh = LINE * 2 + PAD * 2;
    const lx = Math.max(2, Math.min(b.x + 8 + lw > view.width ? b.x - 8 - lw : b.x + 8, view.width - lw - 2));
    const ly = Math.max(2, Math.min(b.y - lh / 2, view.height - lh - 2));
    ctx.beginPath();
    ctx.roundRect(lx, ly, lw, lh, 4);
    ctx.fillStyle = 'rgba(23,23,27,0.92)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(l1, lx + PAD, ly + PAD + LINE / 2);
    ctx.fillText(l2, lx + PAD, ly + PAD + LINE * 1.5);
  },
  hit: () => false,
  handles: () => [],
};
