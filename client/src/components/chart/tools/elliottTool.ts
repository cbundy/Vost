import type { ReactNode } from 'react';
import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import type { SettingField } from '../../../lib/drawingStyle';
import { ELLIOTT_DEFAULT_DEGREE, ELLIOTT_DEGREES, ELLIOTT_WAVES, waveLabel, type ElliottKind } from '../../../lib/geometry/elliott';
import { labelOffset } from '../../../lib/geometry/patterns';
import { anchorLabels, hitsShape, strokeSegment } from './channelShared';
import { applyDash, choiceField, colorField, lineStyleField, numberField, strokeColor, strokeWidth, widthField } from './fields';
import { labelText } from './lineTool';
import type { DrawingTool } from './types';

const SETTINGS: SettingField[] = [
  colorField('color', 'Line colour', 'accent'),
  widthField('width', 'Line width', 1.5),
  lineStyleField('lineStyle', 'Line style'),
  choiceField('degree', 'Wave degree', ELLIOTT_DEFAULT_DEGREE, ELLIOTT_DEGREES.map((d) => ({ value: d.value, label: d.label }))),
  colorField('textColor', 'Text colour', 'text', 'text'),
  numberField('textSize', 'Text size', 12, 8, 48, 1, 'text'),
];

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
      const { color, font } = labelText(view);
      ctx.save();
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < p.length; i++) {
        const text = waveLabel(o.kind, i, String(view.style.degree));
        if (!text) continue;
        const at = labelOffset(p, i);
        ctx.fillText(text, at.x, at.y);
      }
      ctx.restore();
    },
    hit(pts, pt, view, tolerance = HIT_TOLERANCE) {
      const p = pts.slice(0, n);
      if (p.length === 0) return false;
      if (p.length === 1) return hitsShape(pt, [], [[p[0], p[0]]], tolerance);
      return p.slice(1).some((q, i) => hitsShape(pt, [], [[p[i], q]], tolerance));
    },
    handles: (pts) => pts,
  };
}
