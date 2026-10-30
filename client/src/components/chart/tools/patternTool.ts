import type { ReactNode } from 'react';
import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import type { SettingField } from '../../../lib/drawingStyle';
import { formatRatio, labelOffset, lineRatio, type PatternSpec } from '../../../lib/geometry/patterns';
import { anchorLabels, fillPolygon, hitsShape, midpoint, strokeSegment } from './channelShared';
import { applyDash, boolField, colorField, lineStyleField, numberField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import { labelText } from './lineTool';
import type { DrawingTool } from './types';

/** The settings the pattern tools share; `fill` adds the fill colour and opacity. */
export function patternSettings(fill: boolean, ratios = true, background = false): SettingField[] {
  return [
    colorField('color', 'Line colour', 'accent'),
    widthField('width', 'Line width', 1.5),
    lineStyleField('lineStyle', 'Line style'),
    ...(fill ? [colorField('fillColor', 'Fill colour', 'accent'), opacityField('fillOpacity', 'Fill opacity', 0.15)] : []),
    ...(background ? [boolField('background', 'Background', true)] : []),
    colorField('textColor', 'Text colour', 'text', 'text'),
    numberField('textSize', 'Text size', 12, 8, 48, 1, 'text'),
    ...(ratios ? [boolField('showRatios', 'Show ratios', true, 'text')] : []),
  ];
}

/** A chart-pattern tool: legs through the points, filled triangles, point letters and dashed ratio lines. */
export function patternTool(o: { id: string; label: string; spec: PatternSpec; icon: ReactNode }): DrawingTool {
  const { spec } = o;
  const n = spec.labels.length;
  return {
    id: o.id,
    label: o.label,
    group: 'patterns',
    section: 'Chart patterns',
    icon: o.icon,
    anchors: n,
    settings: patternSettings(spec.fill ?? spec.fills.length > 0, spec.ratios.length > 0, spec.background === true),
    axisLabels: (anchors, _style, selected) => anchorLabels(anchors, selected),
    draw(ctx, pts, view, { selected }) {
      const p = pts.slice(0, n);
      if (p.length === 0) return;
      const shape = spec.shape?.(p, view.width, view.height);
      for (const [a, b, c] of spec.fills) if (c < p.length) fillPolygon(ctx, [p[a], p[b], p[c]], view.style);
      if (shape && view.style.background !== false) for (const poly of shape.fills) fillPolygon(ctx, poly, view.style);
      ctx.strokeStyle = strokeColor(view, selected, undefined, 'color', null);
      ctx.lineWidth = strokeWidth(view, selected);
      applyDash(ctx, view.style.lineStyle);
      for (let i = 1; i < p.length; i++) strokeSegment(ctx, p[i - 1], p[i]);
      for (const [a, b] of shape?.lines ?? []) strokeSegment(ctx, a, b);
      const { color, font } = labelText(view);
      const showRatios = view.style.showRatios !== false;
      const prices = view.anchors.map((a) => a.price);
      ctx.save();
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (showRatios) {
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = Math.min(1, strokeWidth(view, selected));
        for (const r of spec.ratios) {
          if (r.from >= p.length || r.to >= p.length) continue;
          strokeSegment(ctx, p[r.from], p[r.to]);
          const ratio = lineRatio(r, prices.slice(0, p.length));
          if (ratio === null) continue;
          const m = midpoint(p[r.from], p[r.to]);
          ctx.fillText(formatRatio(ratio), m.x, m.y);
        }
        ctx.setLineDash([]);
      }
      for (let i = 0; i < p.length; i++) {
        if (!spec.labels[i]) continue;
        const at = labelOffset(p, i);
        ctx.fillText(spec.labels[i], at.x, at.y);
      }
      ctx.restore();
    },
    hit(pts, pt, view, tolerance = HIT_TOLERANCE) {
      const p = pts.slice(0, n);
      if (p.length === 0) return false;
      const shape = spec.shape?.(p, view.width, view.height);
      const segs = [...p.slice(1).map((q, i) => [p[i], q] as const), ...(shape?.lines ?? [])];
      if (segs.length === 0) return hitsShape(pt, [], [[p[0], p[0]]], tolerance);
      const fills = spec.fills.filter(([, , c]) => c < p.length);
      return segs.some(([a, b]) => hitsShape(pt, [], [[a, b]], tolerance)) || fills.some(([a, b, c]) => hitsShape(pt, [p[a], p[b], p[c]], [], tolerance)) || (view.style.background !== false && (shape?.fills ?? []).some((poly) => hitsShape(pt, poly, [], tolerance)));
    },
    handles: (pts) => pts,
  };
}
