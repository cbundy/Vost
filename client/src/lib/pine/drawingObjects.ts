import { logicalToTime } from '../drawingGeometry';
import type {
  PineBox,
  PineDrawingPane,
  PineDrawings,
  PineDrawingStyle,
  PineExtend,
  PineLine,
  PineLinefill,
  PinePolyline,
} from './types';

/** The colour Pine uses when a colour argument is the empty string. */
export const PINE_DEFAULT_COLOR = '#2962FF';

/** A Pine colour: null is na (that part is not drawn), the empty string the default colour. */
function colour(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === '' ? PINE_DEFAULT_COLOR : s;
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function style(v: unknown): PineDrawingStyle {
  const s = String(v ?? '');
  return /dashed/.test(s) ? 'dashed' : /dotted/.test(s) ? 'dotted' : 'solid';
}

function extend(v: unknown): PineExtend {
  const s = String(v ?? '');
  return s === 'l' || s === 'r' || s === 'b' ? s : 'none';
}

function arrows(v: unknown): PineLine['arrows'] {
  const s = String(v ?? '');
  return /arrow_both/.test(s) ? 'both' : /arrow_left/.test(s) ? 'left' : /arrow_right/.test(s) ? 'right' : 'none';
}

const TEXT_SIZES: Record<string, number> = { tiny: 8, small: 10, auto: 12, normal: 12, large: 16, huge: 22 };

/** Text size in px: a named size, or a number used as it is. */
function textSize(v: unknown): number {
  if (typeof v === 'number' && v > 0) return v;
  const s = String(v ?? 'auto').replace(/^size\./, '');
  return TEXT_SIZES[s] ?? (Number.isFinite(Number(s)) && Number(s) > 0 ? Number(s) : 12);
}

/**
 * The PineTS entries under a drawing kind's keys, with the pane of each. A script with `overlay=false` keeps
 * its `force_overlay=true` objects under a second key whose options say overlay.
 */
function entries(plots: Record<string, any>, kind: string): { pane: PineDrawingPane; items: any[] }[] {
  const out: { pane: PineDrawingPane; items: any[] }[] = [];
  for (const key of [`__${kind}__`, `__${kind}_overlay__`]) {
    const plot = plots[key];
    if (!plot || !Array.isArray(plot.data)) continue;
    const last = [...plot.data].reverse().find((d: any) => Array.isArray(d?.value));
    const items = (last?.value ?? []).filter((o: any) => o && o._deleted !== true);
    out.push({ pane: plot.options?.overlay ? 'price' : 'separate', items });
  }
  return out;
}

/**
 * Maps the line, box, polyline and linefill objects PineTS leaves in `ctx.plots` to plain data: times in
 * unix seconds (a bar index past either end of the data lands that many bars outside it), colours,
 * styles and extend normalised. Labels and tables are not mapped here.
 */
export function mapDrawings(plots: Record<string, any>, times: readonly number[]): PineDrawings | undefined {
  const atIndex = (i: number) => logicalToTime(times, i);
  const place = (xloc: unknown, v: number) => (xloc === 'bt' ? v / 1000 : atIndex(v));

  const mapLine = (o: any, pane: PineDrawingPane): PineLine => ({
    pane,
    time1: place(o.xloc, o.x1),
    price1: num(o.y1, 0),
    time2: place(o.xloc, o.x2),
    price2: num(o.y2, 0),
    extend: extend(o.extend),
    color: colour(o.color),
    style: style(o.style),
    arrows: arrows(o.style),
    width: num(o.width, 1),
  });

  // Pine object ids change from run to run, so they only pair a linefill with its lines and are not kept.
  const raw = entries(plots, 'lines').flatMap(({ pane, items }) => items.map((o) => ({ id: o.id, line: mapLine(o, pane) })));
  const lines = raw.map((r) => r.line);
  const byId = new Map(raw.map((r) => [r.id, r.line]));

  const boxes = entries(plots, 'boxes').flatMap(({ pane, items }) =>
    items.map(
      (o): PineBox => ({
        pane,
        time1: place(o.xloc, o.left),
        top: num(o.top, 0),
        time2: place(o.xloc, o.right),
        bottom: num(o.bottom, 0),
        extend: extend(o.extend),
        borderColor: colour(o.border_color),
        borderStyle: style(o.border_style),
        borderWidth: num(o.border_width, 1),
        bgColor: colour(o.bgcolor),
        text: String(o.text ?? ''),
        textColor: colour(o.text_color),
        textSize: textSize(o.text_size),
        halign: o.text_halign === 'left' || o.text_halign === 'right' ? o.text_halign : 'center',
        valign: o.text_valign === 'top' || o.text_valign === 'bottom' ? o.text_valign : 'center',
        wrap: o.text_wrap === 'auto' || o.text_wrap === 'wrap_auto',
      }),
    ),
  );

  const polylines = entries(plots, 'polylines').flatMap(({ pane, items }) =>
    items.map((o): PinePolyline => {
      const bar = o.xloc !== 'bt';
      const points = (Array.isArray(o.points) ? o.points : []).flatMap((p: any) => {
        const x = bar ? p?.index : p?.time;
        return typeof x === 'number' && typeof p?.price === 'number' ? [{ time: place(o.xloc, x), price: p.price }] : [];
      });
      // An empty fill colour is Pine's na for a polyline (its default), not the default blue.
      return {
        pane,
        points,
        curved: o.curved === true,
        closed: o.closed === true,
        lineColor: colour(o.line_color),
        fillColor: o.fill_color === '' ? null : colour(o.fill_color),
        style: style(o.line_style),
        width: num(o.line_width, 1),
      };
    }),
  );

  // A linefill whose line was deleted or dropped by the line limit still reads as live: it needs both lines.
  const linefills = entries(plots, 'linefills').flatMap(({ pane, items }) =>
    items.flatMap((o): PineLinefill[] => {
      const line1 = byId.get(o.line1?.id);
      const line2 = byId.get(o.line2?.id);
      return line1 && line2 ? [{ pane, line1, line2, color: colour(o.color) }] : [];
    }),
  );

  if (lines.length + boxes.length + polylines.length + linefills.length === 0) return undefined;
  return { lines, boxes, polylines, linefills };
}

/** The part of a script's drawings that is painted in one pane, null when there is none. */
export function drawingsOfPane(d: PineDrawings | undefined, pane: PineDrawingPane): PineDrawings | null {
  if (!d) return null;
  const out: PineDrawings = {
    lines: d.lines.filter((o) => o.pane === pane),
    boxes: d.boxes.filter((o) => o.pane === pane),
    polylines: d.polylines.filter((o) => o.pane === pane),
    linefills: d.linefills.filter((o) => o.pane === pane),
  };
  return out.lines.length + out.boxes.length + out.polylines.length + out.linefills.length === 0 ? null : out;
}

/** The lowest and highest price any object touches, null when there are none. */
export function drawingPriceRange(d: PineDrawings): { min: number; max: number } | null {
  const prices = [
    ...d.lines.flatMap((l) => [l.price1, l.price2]),
    ...d.boxes.flatMap((b) => [b.top, b.bottom]),
    ...d.polylines.flatMap((p) => p.points.map((q) => q.price)),
  ];
  return prices.length === 0 ? null : { min: Math.min(...prices), max: Math.max(...prices) };
}
