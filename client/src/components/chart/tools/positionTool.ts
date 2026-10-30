import type { ReactNode } from 'react';
import { HIT_TOLERANCE, pointInRect, timeToLogical, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { formatMoney, positionOutcome, positionStats, sidesValid, type PositionInputs, type PositionSide, type RiskUnit } from '../../../lib/geometry/position';
import { theme } from '../../../lib/theme';
import { boolField, choiceField, colorField, numberField, opacityField, strokeColor } from './fields';
import type { AxisLabels, DragMods, DrawingTool, ToolView } from './types';

/**
 * Where a new position puts its target, stop and right edge from the click, as TradingView does by default: the
 * target a fraction of the pane's height away on the favourable side, the stop a smaller one on the other, and the
 * right edge a fixed number of pixels to the right.
 */
export const POSITION_TARGET_FRACTION = 0.12;
export const POSITION_STOP_FRACTION = 0.06;
export const POSITION_WIDTH_PX = 150;
/** Pane height assumed when a view is not at hand. */
const FALLBACK_HEIGHT = 300;

/** Inputs defaults (TradingView's): account size, lot size, risk of the account in percent. */
export const POSITION_ACCOUNT_SIZE = 1000;
export const POSITION_LOT_SIZE = 1;
export const POSITION_RISK = 25;

const RISK_UNITS: readonly { value: RiskUnit; label: string }[] = [
  { value: 'percent', label: 'Percent of account' },
  { value: 'amount', label: 'Amount' },
];

const FONT_FAMILY = 'sans-serif';
const PAD = 5;

const SETTINGS = [
  numberField('accountSize', 'Account size', POSITION_ACCOUNT_SIZE, 0.01, 1e12, 1, 'inputs'),
  numberField('lotSize', 'Lot size', POSITION_LOT_SIZE, 0.000001, 1e9, 1, 'inputs'),
  numberField('risk', 'Risk', POSITION_RISK, 0, 1e12, 0.5, 'inputs'),
  choiceField('riskUnit', 'Risk unit', 'percent', RISK_UNITS, 'inputs'),
  colorField('color', 'Line colour', 'muted'),
  colorField('targetColor', 'Target fill colour', 'green'),
  opacityField('targetOpacity', 'Target fill opacity', 0.2),
  colorField('stopColor', 'Stop fill colour', 'red'),
  opacityField('stopOpacity', 'Stop fill opacity', 0.2),
  colorField('textColor', 'Text colour', 'text'),
  numberField('textSize', 'Font size', 12, 8, 48, 1),
  boolField('compact', 'Compact stats mode', false),
  boolField('alwaysStats', 'Always show stats', false),
  boolField('priceLabels', 'Show price labels', true),
];

/** The inputs of a position's effective style. */
export function inputsOf(style: Readonly<Record<string, unknown>>): PositionInputs {
  return { accountSize: style.accountSize as number, lotSize: style.lotSize as number, risk: style.risk as number, riskUnit: style.riskUnit as RiskUnit };
}

/** The pixel size of one tick at the entry price (at least one pixel; one pixel when the view has no tick size). */
export function tickPixels(view?: ToolView): number {
  if (!view?.tickSize || !view.anchors[0]) return 1;
  const price = view.anchors[0].price;
  const a = view.priceToY(price);
  const b = view.priceToY(price + view.tickSize);
  return a === null || b === null ? 1 : Math.max(1, Math.abs(b - a));
}

/** The three pixel points of a position placed at `p`: entry, target and stop. */
export function defaultPoints(side: PositionSide, p: Pt, height = FALLBACK_HEIGHT): Pt[] {
  const f = side === 'long' ? -1 : 1;
  const x = p.x + POSITION_WIDTH_PX;
  return [p, { x, y: p.y + f * height * POSITION_TARGET_FRACTION }, { x, y: p.y - f * height * POSITION_STOP_FRACTION }];
}

/** The loaded bars' x for a time, from the logical positions of the start and end anchors. */
function timeX(view: ToolView, x0: number, x1: number, t: number): number {
  const [a, b] = view.anchors;
  const l0 = timeToLogical(view.times, a.time);
  const l1 = timeToLogical(view.times, b.time);
  return l1 === l0 ? x0 : x0 + ((timeToLogical(view.times, t) - l0) / (l1 - l0)) * (x1 - x0);
}

export function drawLabel(ctx: CanvasRenderingContext2D, lines: string[], cx: number, y: number, above: boolean, border: string, view: ToolView): void {
  const size = view.style.textSize as number;
  ctx.font = `${size}px ${FONT_FAMILY}`;
  const lh = size + 4;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + PAD * 2;
  const h = lines.length * lh + PAD * 2 - 4;
  const x = Math.max(2, Math.min(cx - w / 2, view.width - w - 2));
  const top = Math.max(2, Math.min(above ? y - h - 6 : y + 6, view.height - h - 2));
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, 4);
  ctx.fillStyle = 'rgba(23,23,27,0.92)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.fillStyle = cssColor(view.style.textColor);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, top + PAD + lh * i + (lh - 4) / 2));
}

/**
 * A Long position or Short position: an entry with a target zone on the favourable side and a stop zone on the other,
 * the risk, quantity and profit or loss they imply, and what the bars after the entry did to it. Stored as three
 * anchors: entry (start time and price), target and stop (the end time and their prices).
 */
export function positionTool(side: PositionSide, id: string, label: string, icon: ReactNode): DrawingTool {
  const long = side === 'long';
  /** Pixel y direction of the favourable side: up (-1) for a long. */
  const f = long ? -1 : 1;
  return {
    id,
    label,
    group: 'forecast-measure',
    section: 'Forecasting',
    icon,
    anchors: 3,
    placed: 1,
    hoverPreview: true,
    settings: SETTINGS,
    axisLabels: (anchors, _style, selected): AxisLabels =>
      selected && anchors.length >= 3 ? { price: anchors.map((a) => a.price), time: [anchors[0].time, anchors[1].time] } : {},
    validate(d) {
      const [e, t, s] = d.anchors;
      if (d.anchors.length !== 3 || ![e, t, s].every((a) => Number.isFinite(a.time) && Number.isFinite(a.price))) return null;
      if (!sidesValid(side, { entry: e.price, target: t.price, stop: s.price })) return null;
      return s.time === t.time ? d : { ...d, anchors: [e, t, { ...s, time: t.time }] };
    },
    editAnchor(prev, next, index) {
      if (next.length !== 3 || !next.every((a) => Number.isFinite(a.time) && Number.isFinite(a.price))) return prev;
      const out = index === 0 ? next : [next[0], { ...next[1], time: next[index].time }, { ...next[2], time: next[index].time }];
      return sidesValid(side, { entry: out[0].price, target: out[1].price, stop: out[2].price }) ? out : prev;
    },
    settle: (pts, view) => (pts.length === 1 ? defaultPoints(side, pts[0], view?.height) : pts),
    draw(ctx, pts, view, { selected }) {
      if (pts.length === 0) return;
      // Before the click only the entry follows the pointer: draw the shape the click would place.
      const [e, t, s] = pts.length >= 3 ? pts : defaultPoints(side, pts[0], view.height);
      const complete = pts.length >= 3 && view.anchors.length >= 3;
      const left = Math.min(e.x, t.x);
      const right = Math.max(e.x, t.x);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, view.width, view.height);
      ctx.clip();
      ctx.fillStyle = cssColor(view.style.targetColor, view.style.targetOpacity as number);
      ctx.fillRect(left, Math.min(e.y, t.y), right - left, Math.abs(t.y - e.y));
      ctx.fillStyle = cssColor(view.style.stopColor, view.style.stopOpacity as number);
      ctx.fillRect(left, Math.min(e.y, s.y), right - left, Math.abs(s.y - e.y));
      const line = strokeColor(view, selected, theme.accent2, 'color', null);
      ctx.strokeStyle = line;
      ctx.lineWidth = selected ? 1.5 : 1;
      ctx.strokeRect(left, Math.min(e.y, t.y), right - left, Math.abs(t.y - e.y));
      ctx.strokeRect(left, Math.min(e.y, s.y), right - left, Math.abs(s.y - e.y));
      if (!complete) {
        ctx.restore();
        return;
      }

      const [a, b, c] = view.anchors;
      const prices = { entry: a.price, target: b.price, stop: c.price };
      const outcome = positionOutcome(side, prices, a.time, b.time, view.candles);
      if (outcome.result !== 'open' && outcome.time !== undefined) {
        const yEnd = outcome.result === 'target' ? t.y : s.y;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(Math.max(left, Math.min(right, timeX(view, e.x, t.x, outcome.time))), yEnd);
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = outcome.result === 'target' ? theme.green : theme.red;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const size = view.style.textSize as number;
      const stats = positionStats(prices, inputsOf(view.style), view.tickSize);
      ctx.font = `${size}px ${FONT_FAMILY}`;
      ctx.fillStyle = cssColor(view.style.textColor);
      if (view.style.priceLabels === true) {
        ctx.textAlign = 'right';
        const at = (price: number, y: number, up: boolean) => {
          ctx.textBaseline = up ? 'bottom' : 'top';
          ctx.fillText(view.formatPrice(price), right - 4, y + (up ? -3 : 3));
        };
        at(prices.entry, e.y, f < 0);
        at(prices.target, t.y, f > 0);
        at(prices.stop, s.y, f < 0);
      }

      if (selected || view.style.alwaysStats === true) {
        const state = outcome.result === 'target' ? `Closed P&L: ${formatMoney(stats.targetPnl)}` : outcome.result === 'stop' ? `Closed P&L: ${formatMoney(stats.stopPnl)}` : 'Open';
        const rr = stats.riskReward === null ? '-' : String(Math.round(stats.riskReward * 100) / 100);
        const border = outcome.result === 'target' ? theme.green : outcome.result === 'stop' ? theme.red : theme.muted;
        const cx = (left + right) / 2;
        if (view.style.compact === true) drawLabel(ctx, [`${state}, Qty: ${stats.quantity}, R/R: ${rr}`], cx, s.y, f > 0, border, view);
        else {
          const part = (name: string, d: number, pct: number, ticks: number | undefined, pnl: number) =>
            `${name}: ${view.formatPrice(d)} (${pct.toFixed(2)}%)${ticks === undefined ? '' : `, ${ticks} ticks`}, Amount: ${formatMoney(pnl)}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = cssColor(view.style.textColor);
          const zone = (name: string, d: number, pct: number, ticks: number | undefined, pnl: number, y0: number, y1: number) => {
            const line = part(name, d, pct, ticks, pnl);
            // Only when the line fits the zone, so a narrow or short zone shows no squeezed text.
            if (Math.abs(y1 - y0) >= size + 6 && ctx.measureText(line).width <= right - left - 8) ctx.fillText(line, (left + right) / 2, (y0 + y1) / 2);
          };
          zone('Target', stats.targetDistance, stats.targetPct, stats.targetTicks, stats.targetPnl, e.y, t.y);
          zone('Stop', stats.stopDistance, stats.stopPct, stats.stopTicks, stats.stopPnl, e.y, s.y);
          drawLabel(ctx, [state, `Qty: ${stats.quantity}`, `Risk/Reward: ${rr}`], cx, s.y, f > 0, border, view);
        }
      }
      ctx.restore();
    },
    hit(pts, p, _view, tolerance = HIT_TOLERANCE) {
      if (pts.length < 3) return false;
      const [e, t, s] = pts;
      return pointInRect(p, { x: Math.min(e.x, t.x), y: Math.min(t.y, s.y, e.y) }, { x: Math.max(e.x, t.x), y: Math.max(t.y, s.y, e.y) }, tolerance);
    },
    handles: (pts) => (pts.length < 3 ? [] : [pts[0], { x: pts[0].x, y: pts[1].y }, { x: pts[0].x, y: pts[2].y }, { x: pts[1].x, y: pts[0].y }]),
    dragHandle(orig: Pt[], handle: number, p: Pt, mods?: DragMods) {
      const [e, t, s] = orig;
      const tick = tickPixels(mods?.view);
      const x1 = t.x;
      if (handle === 0) {
        const lo = f > 0 ? s.y + tick : t.y + tick;
        const hi = f > 0 ? t.y - tick : s.y - tick;
        const y = lo <= hi ? Math.max(lo, Math.min(hi, p.y)) : e.y;
        return [{ x: Math.min(p.x, x1 - 1), y }, t, s];
      }
      if (handle === 1) return [e, { x: x1, y: e.y + f * Math.max(tick, f * (p.y - e.y)) }, s];
      if (handle === 2) return [e, t, { x: x1, y: e.y - f * Math.max(tick, -f * (p.y - e.y)) }];
      const x = Math.max(p.x, e.x + 1);
      return [e, { x, y: t.y }, { x, y: s.y }];
    },
  };
}
