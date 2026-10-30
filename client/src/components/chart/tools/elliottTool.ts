import type { ReactNode } from 'react';
import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import type { SettingField } from '../../../lib/drawingStyle';
import { ELLIOTT_DEFAULT_DEGREE, ELLIOTT_DEGREES, ELLIOTT_WAVES, waveFormat, waveLabel, type ElliottKind } from '../../../lib/geometry/elliott';
import { labelOffset } from '../../../lib/geometry/patterns';
import { anchorLabels, hitsShape, strokeSegment } from './channelShared';
import { applyDash, choiceField, colorField, lineStyleField, numberField, strokeColor, strokeWidth, widthField } from './fields';
import { labelText } from './lineTool';
import type { DrawingTool, ToolView } from './types';
import type { Pt } from '../../../lib/drawingGeometry';

const SETTINGS: SettingField[] = [
  colorField('color', 'Line colour', 'accent'),
  widthField('width', 'Line width', 1.5),
  lineStyleField('lineStyle', 'Line style'),
  choiceField('degree', 'Wave degree', ELLIOTT_DEFAULT_DEGREE, ELLIOTT_DEGREES.map((d) => ({ value: d.value, label: d.label }))),
  colorField('textColor', 'Text colour', 'text', 'text'),
  numberField('textSize', 'Text size', 12, 8, 48, 1, 'text'),
];

/** Draws the wave label of point `i` for the chosen degree: its font size and weight, and a circle round it for a circled degree. */
function drawWaveLabel(ctx: CanvasRenderingContext2D, p: Pt[], i: number, kind: ElliottKind, view: ToolView): void {
  const degree = String(view.style.degree);
  const text = waveLabel(kind, i, degree);
  if (!text) return;
  const { color, size } = labelText(view);
  const f = waveFormat(degree, size);
  const at = labelOffset(p, i, Math.max(12, (f.circle || f.fontSize) / 2 + 6));
  ctx.save();
  ctx.font = `${f.bold ? 'bold ' : ''}${f.fontSize}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (f.circle > 0) {
    ctx.beginPath();
    ctx.arc(at.x, at.y, f.circle / 2, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillText(text, at.x, at.y);
  ctx.restore();
}

/** An Elliott wave tool: legs through the points and a wave label for the chosen degree beside each labelled point. */
export function elliottTool(o: { id: string; label: string; kind: ElliottKind; icon: ReactNode }): DrawingTool {
  const n = ELLIOTT_WAVES[o.kind].length;
  return {
    id: o.id,
    label: o.label,
    group: 'patterns',
    section: 'Elliott waves',
    icon: o.icon,
    anchors: n,
    settings: SETTINGS,
    axisLabels: (anchors, _style, selected) => anchorLabels(anchors, selected),
    draw(ctx, pts, view, { selected }) {
      const p = pts.slice(0, n);
      if (p.length === 0) return;
      ctx.strokeStyle = strokeColor(view, selected, undefined, 'color', null);
      ctx.lineWidth = strokeWidth(view, selected);
      applyDash(ctx, view.style.lineStyle);
      for (let i = 1; i < p.length; i++) strokeSegment(ctx, p[i - 1], p[i]);
      for (let i = 1; i < p.length; i++) drawWaveLabel(ctx, p, i, o.kind, view);
    },
    hit(pts, pt, view, tolerance = HIT_TOLERANCE) {
      const p = pts.slice(0, n);
      if (p.length === 0) return false;
      if (p.length === 1) return hitsShape(pt, [], [[p[0], p[0]]], tolerance);
      return p.slice(1).some((q, i) => hitsShape(pt, [], [[p[i], q]], tolerance));
    },
    // TradingView shows the origin's "0" only while the drawing is hovered or selected, which is when a popup is painted.
    popup(ctx, pts, view) {
      const p = pts.slice(0, n);
      if (p.length > 0) drawWaveLabel(ctx, p, 0, o.kind, view);
    },
    handles: (pts) => pts,
  };
}
