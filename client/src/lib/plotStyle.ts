/**
 * The pure rules behind the Style tab of an indicator's settings: what a user can change per plot, how saved styles are
 * cleaned, and how a style turns the series of a built-in indicator or a Pine script into what is drawn. No React or chart
 * imports. With no style set every function gives back today's colours, widths, types and data (the same objects).
 */
import { LINE_STYLES, type LineStyle } from './drawingStyle';
import type { ComputedSeries, IndicatorSpec } from './indicatorCompute';
import { computeIndicator } from './indicatorCompute';
import type { PineSeriesDesc } from './pine/chartSeries';

export type PlotType = 'line' | 'linebr' | 'step' | 'histogram' | 'area' | 'circles';

export const PLOT_TYPES: ReadonlyArray<{ value: PlotType; label: string }> = [
  { value: 'line', label: 'Line' },
  { value: 'linebr', label: 'Line with breaks' },
  { value: 'step', label: 'Step line' },
  { value: 'histogram', label: 'Histogram' },
  { value: 'area', label: 'Area' },
  { value: 'circles', label: 'Circles' },
];

/** The types drawn as a line: they have a thickness and a line style. */
export const LINE_DRAWN: ReadonlySet<PlotType> = new Set<PlotType>(['line', 'linebr', 'step', 'area']);

export interface PlotStyle {
  visible?: boolean;
  /** `#rrggbb` or `rgba(...)`. */
  color?: string;
  /** Whole percent, 0-100. */
  opacity?: number;
  width?: 1 | 2 | 3 | 4;
  lineStyle?: LineStyle;
  plotType?: PlotType;
  priceLine?: boolean;
}

export interface IndicatorStyle {
  plots?: Record<string, PlotStyle>;
  /** Decimals of every plot's values (0-8); absent = the default format. */
  precision?: number;
  /** The labels on the price scale; absent = today's rule per plot. */
  labelsOnScale?: boolean;
  /** Absent = shown. */
  valuesInStatusLine?: boolean;
  inputsInStatusLine?: boolean;
}

/* ------------------------------- colours -------------------------------- */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(c: string): Rgba | null {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = [...m[1]].map((x) => parseInt(x + x, 16));
    return { r, g, b, a: 1 };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : Math.min(1, +m[4]) };
  return null;
}

/** The colour with its alpha scaled by `pct` percent. `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` are understood; anything else stays. */
export function withOpacity(color: string, pct: number): string {
  const c = parseColor(color);
  if (!c) return color;
  const a = Math.round(c.a * Math.min(100, Math.max(0, pct)) * 10) / 1000;
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

/** `#rrggbb` of a colour (its alpha dropped); null when it cannot be read. */
export function colorToHex(color: string): string | null {
  const c = parseColor(color);
  return c ? `#${[c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, '0')).join('')}` : null;
}

/** The alpha of a colour as whole percent (100 when it cannot be read). */
export function colorAlphaPct(color: string): number {
  const c = parseColor(color);
  return c ? Math.round(c.a * 100) : 100;
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d*\.?\d+)\s*\)$/i;

function cleanColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  if (HEX6.test(v)) return v.toLowerCase();
  const m = RGBA.exec(v);
  if (m && +m[1] <= 255 && +m[2] <= 255 && +m[3] <= 255 && +m[4] <= 1) return v.replace(/\s+/g, '');
  return undefined;
}

/** The colour a plot is drawn in: the plot's own colour (else `base`) at the plot's opacity. */
function paint(base: string, ps: PlotStyle | undefined): string {
  const c = ps?.color ?? base;
  return ps?.opacity !== undefined && ps.opacity !== 100 ? withOpacity(c, ps.opacity) : c;
}

/* ------------------------------ cleaning -------------------------------- */

const PLOT_TYPE_SET = new Set<string>(PLOT_TYPES.map((t) => t.value));
const MAX_PLOTS = 64;

function cleanPlot(raw: unknown): PlotStyle | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: PlotStyle = {};
  if (typeof r.visible === 'boolean') out.visible = r.visible;
  const color = cleanColor(r.color);
  if (color) out.color = color;
  if (typeof r.opacity === 'number' && Number.isFinite(r.opacity)) out.opacity = Math.min(100, Math.max(0, Math.round(r.opacity)));
  if (typeof r.width === 'number' && Number.isFinite(r.width)) out.width = Math.min(4, Math.max(1, Math.round(r.width))) as PlotStyle['width'];
  if (typeof r.lineStyle === 'string' && (LINE_STYLES as readonly string[]).includes(r.lineStyle)) out.lineStyle = r.lineStyle as LineStyle;
  if (typeof r.plotType === 'string' && PLOT_TYPE_SET.has(r.plotType)) out.plotType = r.plotType as PlotType;
  if (typeof r.priceLine === 'boolean') out.priceLine = r.priceLine;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A style read from storage, cleaned: unknown fields and bad values dropped, numbers clamped. Undefined when nothing is left. */
export function sanitizeIndicatorStyle(raw: unknown): IndicatorStyle | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: IndicatorStyle = {};
  if (typeof r.plots === 'object' && r.plots !== null && !Array.isArray(r.plots)) {
    const plots: Record<string, PlotStyle> = {};
    for (const [key, v] of Object.entries(r.plots).slice(0, MAX_PLOTS)) {
      const p = cleanPlot(v);
      if (p && key.length <= 200) plots[key] = p;
    }
    if (Object.keys(plots).length > 0) out.plots = plots;
  }
  if (typeof r.precision === 'number' && Number.isFinite(r.precision)) out.precision = Math.min(8, Math.max(0, Math.round(r.precision)));
  if (typeof r.labelsOnScale === 'boolean') out.labelsOnScale = r.labelsOnScale;
  if (typeof r.valuesInStatusLine === 'boolean') out.valuesInStatusLine = r.valuesInStatusLine;
  if (typeof r.inputsInStatusLine === 'boolean') out.inputsInStatusLine = r.inputsInStatusLine;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `style` with one plot's fields changed (a field set to undefined is removed); empty parts are dropped, and an empty style is undefined. */
export function withPlotStyle(style: IndicatorStyle | undefined, key: string, patch: Partial<PlotStyle>): IndicatorStyle | undefined {
  const plots = { ...style?.plots, [key]: { ...style?.plots?.[key], ...patch } };
  return tidy({ ...style, plots });
}

/** `style` with the indicator-wide fields changed (a field set to undefined is removed). */
export function withStyleOptions(style: IndicatorStyle | undefined, patch: Partial<Omit<IndicatorStyle, 'plots'>>): IndicatorStyle | undefined {
  return tidy({ ...style, ...patch });
}

/** Drops undefined fields and empty plot entries; undefined when the style is empty. */
export function tidy(style: IndicatorStyle | undefined): IndicatorStyle | undefined {
  if (!style) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) if (v !== undefined && k !== 'plots') out[k] = v;
  const plots: Record<string, PlotStyle> = {};
  for (const [key, p] of Object.entries(style.plots ?? {})) {
    const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as PlotStyle;
    if (Object.keys(clean).length > 0) plots[key] = clean;
  }
  if (Object.keys(plots).length > 0) out.plots = plots;
  return Object.keys(out).length > 0 ? (out as IndicatorStyle) : undefined;
}

/* --------------------------- series formatting -------------------------- */

/** The price format and last-value flag of the series of an indicator with `style`; `lastValueDefault` is today's rule for the plot. */
export function seriesFormat(
  style: IndicatorStyle | undefined,
  lastValueDefault: boolean,
): { priceFormat?: { type: 'price'; precision: number; minMove: number }; lastValueVisible: boolean } {
  const p = style?.precision;
  return {
    ...(p !== undefined && { priceFormat: { type: 'price' as const, precision: p, minMove: Number(`1e-${p}`) } }),
    lastValueVisible: style?.labelsOnScale ?? lastValueDefault,
  };
}

/* ------------------------------- built-in ------------------------------- */

export interface StyledBuiltin {
  visible: boolean;
  type: PlotType;
  color: string;
  width: number;
  lineStyle: LineStyle;
  priceLine: boolean;
  data: ComputedSeries['data'] | Array<{ time: number; value?: number; color?: string }>;
}

/** What one computed series of a built-in indicator is drawn as under `style`. `candleTimes` fills the gaps of a line with breaks. */
export function styledBuiltin(cs: ComputedSeries, style: IndicatorStyle | undefined, candleTimes: readonly number[]): StyledBuiltin {
  const ps = style?.plots?.[cs.key];
  const plain: StyledBuiltin = {
    visible: true,
    type: cs.kind === 'histogram' ? 'histogram' : 'line',
    color: cs.color,
    width: cs.lineWidth ?? 2,
    lineStyle: cs.dashed ? 'dashed' : 'solid',
    priceLine: false,
    data: cs.data,
  };
  if (!ps) return plain;
  const type = ps.plotType ?? plain.type;
  const color = paint(cs.color, ps);
  let data: StyledBuiltin['data'] = cs.data;
  if (ps.color || type !== 'histogram') {
    data = cs.data.map((p) => ({ time: p.time, value: p.value }));
  } else if (ps.opacity !== undefined && ps.opacity !== 100) {
    data = cs.data.map((p) => (p.color ? { ...p, color: withOpacity(p.color, ps.opacity!) } : p));
  }
  if (type === 'linebr') {
    const at = new Map(data.map((p) => [p.time, p]));
    data = candleTimes.map((t) => at.get(t) ?? { time: t });
  }
  return {
    visible: ps.visible !== false,
    type,
    color,
    width: ps.width ?? plain.width,
    lineStyle: ps.lineStyle ?? plain.lineStyle,
    priceLine: ps.priceLine === true,
    data,
  };
}

/* --------------------------------- Pine --------------------------------- */

export interface StyledPine {
  desc: PineSeriesDesc;
  visible: boolean;
  priceLine: boolean;
  /** Set only when the style decides the label on the price scale; else today's rule stands. */
  lastValueVisible?: boolean;
}

/** One Pine series description under `style`; without a style it is the description itself. */
export function styledPine(d: PineSeriesDesc, style: IndicatorStyle | undefined): StyledPine {
  const unstyleable = d.type === 'candle' || d.type === 'bar' || d.band;
  const ps = unstyleable ? undefined : style?.plots?.[d.key];
  const lastValueVisible = unstyleable ? undefined : style?.labelsOnScale;
  if (!ps) return { desc: d, visible: true, priceLine: false, ...(lastValueVisible !== undefined && { lastValueVisible }) };
  const color = paint(d.color, ps);
  let data = d.data;
  if (ps.color) data = data.map((p) => (p.color ? { ...p, color: undefined } : p));
  else if (ps.opacity !== undefined && ps.opacity !== 100) data = data.map((p) => (p.color ? { ...p, color: withOpacity(p.color, ps.opacity!) } : p));
  let desc: PineSeriesDesc = { ...d, color, lineWidth: ps.width ?? d.lineWidth, data, ...(ps.lineStyle && { lineStyle: ps.lineStyle }) };
  if (!d.hline && ps.plotType) {
    const t = ps.plotType;
    const { lineType: _l, pointsOnly: _p, base: _b, ...rest } = desc;
    void _l;
    void _p;
    void _b;
    desc = {
      ...rest,
      type: t === 'histogram' ? 'histogram' : t === 'area' ? 'area' : 'line',
      ...(t === 'step' && { lineType: 'steps' as const }),
      ...(t === 'circles' && { pointsOnly: true }),
      ...((t === 'histogram' || t === 'area') && { base: d.base ?? 0 }),
    };
    if (t === 'line') desc.data = desc.data.filter((p) => p.value !== undefined);
  }
  return { desc, visible: ps.visible !== false, priceLine: ps.priceLine === true && !d.hline, ...(lastValueVisible !== undefined && { lastValueVisible }) };
}

/* ---------------------------------- rows -------------------------------- */

/** One row of the Style tab: a plot as it is drawn with no style. */
export interface PlotRow {
  key: string;
  title: string;
  hline: boolean;
  type: PlotType;
  color: string;
  width: number;
  lineStyle: LineStyle;
}

/** The plots of a built-in indicator, in drawing order. */
export function plotRowsBuiltin(spec: IndicatorSpec): PlotRow[] {
  return computeIndicator({ ...spec, style: undefined }, []).map((cs) => {
    const b = styledBuiltin(cs, undefined, []);
    return { key: cs.key, title: cs.title, hline: false, type: b.type, color: b.color, width: b.width, lineStyle: b.lineStyle };
  });
}

/** The plots and hlines of a Pine script (candle, bar and band series are not rows), from its series descriptions. */
export function plotRowsPine(series: readonly PineSeriesDesc[]): PlotRow[] {
  return series
    .filter((d) => d.type !== 'candle' && d.type !== 'bar' && !d.band)
    .map((d) => ({
      key: d.key,
      title: d.title,
      hline: Boolean(d.hline),
      type: d.type === 'histogram' ? 'histogram' : d.type === 'area' ? 'area' : d.pointsOnly ? 'circles' : d.lineType === 'steps' ? 'step' : 'linebr',
      color: d.color,
      width: d.lineWidth,
      lineStyle: d.lineStyle ?? 'solid',
    }));
}

/** A row as it looks under the plot's style: what the Style tab shows. */
export function resolveRow(row: PlotRow, ps: PlotStyle | undefined): PlotRow & { visible: boolean; opacity: number; priceLine: boolean } {
  return {
    ...row,
    type: row.hline ? row.type : (ps?.plotType ?? row.type),
    color: paint(row.color, ps),
    width: ps?.width ?? row.width,
    lineStyle: ps?.lineStyle ?? row.lineStyle,
    visible: ps?.visible !== false,
    opacity: ps?.opacity ?? 100,
    priceLine: ps?.priceLine === true,
  };
}
