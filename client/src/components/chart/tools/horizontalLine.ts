import { HANDLE_RADIUS, HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { theme } from '../../../lib/theme';
import type { DrawingTool } from './types';

export const horizontalLine: DrawingTool = {
  id: 'horizontalLine',
  label: 'Horizontal line',
  anchors: 1,
  priceOnly: true,
  draw(ctx, [a], { width, selected }) {
    ctx.beginPath();
    ctx.moveTo(0, a.y);
    ctx.lineTo(width, a.y);
    ctx.strokeStyle = selected ? theme.amber : 'rgba(245,158,11,0.85)';
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.stroke();
  },
  hit: ([a], p) => Math.abs(p.y - a.y) <= HIT_TOLERANCE,
  // The line spans the width, so the handle stays on screen even when its anchor time is off it.
  handles: ([a], width) => [{ x: Math.min(Math.max(a.x, HANDLE_RADIUS + 2), width - HANDLE_RADIUS - 2), y: a.y }],
};
