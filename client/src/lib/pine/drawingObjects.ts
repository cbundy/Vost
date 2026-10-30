import { logicalToTime } from '../drawingGeometry';
import type {
  PineBox,
  PineDrawingPane,
  PineDrawings,
  PineDrawingStyle,
  PineExtend,
  PineLabel,
  PineLabelYloc,
  PineLine,
  PineLinefill,
  PinePolyline,
  PineTable,
  PineTableCell,
  PineTablePosition,
} from './types';

/** The colour Pine uses when a colour argument is the empty string. */
export const PINE_DEFAULT_COLOR = '#2962FF';

/** A Pine colour: null is na (that part is not drawn), the empty string the default colour. */
function colour(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === '' ? PINE_DEFAULT_COLOR : s;
}

/** `label.new`'s default colour (color.blue) and text colour (color.white) in the Pine v6 reference. */
export const PINE_LABEL_COLOR = '#2962FF';
export const PINE_LABEL_TEXT_COLOR = '#FFFFFF';

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

const TABLE_POSITIONS: readonly PineTablePosition[] = [
  'top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right',
];

/** A table colour: the empty string and na are both "none" (transparent). */
const tableColour = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

const halign = (v: unknown): 'left' | 'center' | 'right' => (v === 'left' || v === 'right' ? v : 'center');

function mapCell(c: any): PineTableCell | null {
  if (!c) return null;
  const fmt = String(c.text_formatting ?? '');
  return {
    text: String(c.text ?? ''),
    textColor: tableColour(c.text_color),
    bgColor: tableColour(c.bgcolor),
    textSize: textSize(c.text_size),
    halign: halign(c.text_halign),
    valign: c.text_valign === 'top' || c.text_valign === 'bottom' ? c.text_valign : 'center',
    widthPct: Math.max(0, num(c.width, 0)),
    heightPct: Math.max(0, num(c.height, 0)),
    tooltip: String(c.tooltip ?? ''),
    bold: /bold/.test(fmt),
    italic: /italic/.test(fmt),
    monospace: /monospace/.test(String(c.text_font_family ?? '')),
    hidden: c._merged === true,
  };
}

/** The bars a label can sit on: their highs and lows, aligned with the run's times. */
export interface PineBarRange {
  high: number;
  low: number;
}

/**
 * Maps the line, box, polyline, linefill, label and table objects PineTS leaves in `ctx.plots` to plain data:
 * times in unix seconds (a bar index past either end of the data lands that many bars outside it), colours,
 * styles and extend normalised. A label on `abovebar` / `belowbar` takes its bar's high / low from `bars`
 * (aligned with `times`) and falls back to its own price past the data. PineTS files every table under an overlay
 * key, so a table's pane is the script's own (`scriptOverlay`) unless the table is `force_overlay`.
 */
export function mapDrawings(
  plots: Record<string, any>,
  times: readonly number[],
  bars: readonly PineBarRange[] = [],
  scriptOverlay?: boolean,
): PineDrawings | undefined {
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

  const indexOfTime = new Map(times.map((t, i) => [t, i]));
  const labels = entries(plots, 'labels').flatMap(({ pane, items }) =>
    items.map((o): PineLabel => {
      const time = place(o.xloc, o.x);
      const yloc: PineLabelYloc = o.yloc === 'ab' ? 'abovebar' : o.yloc === 'bl' ? 'belowbar' : 'price';
      const bar = bars[indexOfTime.get(time) ?? -1];
      const price = yloc === 'abovebar' && bar ? bar.high : yloc === 'belowbar' && bar ? bar.low : num(o.y, 0);
      const fmt = String(o.text_formatting ?? '');
      return {
        pane,
        time,
        price,
        yloc,
        text: String(o.text ?? ''),
        style: String(o.style ?? 'style_label_down').replace(/^style_/, ''),
        color: o.color === '' ? PINE_LABEL_COLOR : colour(o.color),
        textColor: o.textcolor === '' ? PINE_LABEL_TEXT_COLOR : colour(o.textcolor),
        textSize: textSize(o.size),
        textAlign: halign(o.textalign),
        tooltip: String(o.tooltip ?? ''),
        bold: /bold/.test(fmt),
        italic: /italic/.test(fmt),
        monospace: /monospace/.test(String(o.text_font_family ?? '')),
      };
    }),
  );

  // PineTS has no separate overlay key for tables: the table's own force_overlay or the script's overlay decides its pane.
  const tables = entries(plots, 'tables').flatMap(({ pane, items }) =>
    items.map(
      (o): PineTable => ({
        pane: o.force_overlay === true || (scriptOverlay ?? pane === 'price') ? 'price' : 'separate',
        position: TABLE_POSITIONS.includes(o.position) ? o.position : 'top_right',
        columns: num(o.columns, 0),
        rows: num(o.rows, 0),
        bgColor: tableColour(o.bgcolor),
        frameColor: tableColour(o.frame_color),
        frameWidth: num(o.frame_width, 0),
        borderColor: tableColour(o.border_color),
        borderWidth: num(o.border_width, 0),
        cells: (Array.isArray(o.cells) ? o.cells : []).map((row: any) => (Array.isArray(row) ? row.map(mapCell) : [])),
        merges: (Array.isArray(o.merges) ? o.merges : []).map((m: any) => ({
          startCol: num(m.startCol, 0),
          startRow: num(m.startRow, 0),
          endCol: num(m.endCol, 0),
          endRow: num(m.endRow, 0),
        })),
      }),
    ),
  );

  if (lines.length + boxes.length + polylines.length + linefills.length + labels.length + tables.length === 0) return undefined;
  return { lines, boxes, polylines, linefills, labels, tables };
}

/** The part of a script's drawings that is painted in one pane, null when there is none. */
export function drawingsOfPane(d: PineDrawings | undefined, pane: PineDrawingPane): PineDrawings | null {
  if (!d) return null;
  const out: PineDrawings = {
    lines: d.lines.filter((o) => o.pane === pane),
    boxes: d.boxes.filter((o) => o.pane === pane),
    polylines: d.polylines.filter((o) => o.pane === pane),
    linefills: d.linefills.filter((o) => o.pane === pane),
    labels: d.labels.filter((o) => o.pane === pane),
    tables: d.tables.filter((o) => o.pane === pane),
  };
  const count = out.lines.length + out.boxes.length + out.polylines.length + out.linefills.length + out.labels.length + out.tables.length;
  return count === 0 ? null : out;
}

/** The lowest and highest price any object touches (a table has none), null when there are none. */
export function drawingPriceRange(d: PineDrawings): { min: number; max: number } | null {
  const prices = [
    ...d.lines.flatMap((l) => [l.price1, l.price2]),
    ...d.boxes.flatMap((b) => [b.top, b.bottom]),
    ...d.polylines.flatMap((p) => p.points.map((q) => q.price)),
    ...d.labels.map((l) => l.price),
  ];
  return prices.length === 0 ? null : { min: Math.min(...prices), max: Math.max(...prices) };
}
