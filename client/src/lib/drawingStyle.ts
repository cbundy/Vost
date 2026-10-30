/**
 * Pure drawing styles: the settings each tool declares, the validation of one stored value, and the resolution of a
 * drawing's effective style (its own stored value, else the user's saved default for the tool, else the tool's
 * default). No chart or React imports.
 */
import { FIB_ARC_LEVELS, FIB_CIRCLE_LEVELS, FIB_EXTENSION_LEVELS, FIB_LEVELS, FIB_SPEED_LEVELS, FIB_TIME_ZONE_LEVELS, FIB_TREND_TIME_LEVELS, FIB_WEDGE_LEVELS } from './geometry/fib';
import { GANN_BOX_LEVELS, GANN_FAN_LEVELS, GANN_SQUARE_ARC_LEVELS, GANN_SQUARE_FAN_LEVELS } from './geometry/gann';
import { theme } from './theme';

export type SettingKind = 'color' | 'opacity' | 'width' | 'lineStyle' | 'boolean' | 'number' | 'levels' | 'choice';

/** The dialog tab a setting belongs to (Coordinates is built from the anchors, not from settings). */
export type SettingTab = 'style' | 'inputs' | 'text' | 'visibility';

export type SettingField = {
  /** Key in the drawing's `style` record. */
  key: string;
  label: string;
  kind: SettingKind;
  tab: SettingTab;
  /** The value used when neither the drawing nor the user's default sets one. Colours name a theme token. */
  default: unknown;
  /** Bounds of a `number`, `width` or `opacity`. */
  min?: number;
  max?: number;
  step?: number;
  /** The listed values of a `choice`; it accepts only these. */
  options?: readonly { value: string; label: string }[];
};

export type LineStyle = 'solid' | 'dashed' | 'dotted';
export const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];

/** A colour setting is a theme token name (follows the theme) or a `#rrggbb` hex. */
export type ColorValue = keyof typeof theme | `#${string}`;

export type FibLevel = { value: number; color: string; on: boolean };

/** Most levels a Fibonacci retracement can have. */
export const MAX_LEVELS = 24;
/** Largest absolute level value; keeps the list readable and the prices finite. */
export const LEVEL_LIMIT = 1000;

const HEX = /^#[0-9a-fA-F]{6}$/;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function isColor(v: unknown): v is string {
  return typeof v === 'string' && (HEX.test(v) || Object.prototype.hasOwnProperty.call(theme, v));
}

/** `#rrggbb` of a colour value; null when it is neither a theme token nor a hex. */
export function colorHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (HEX.test(v)) return v.toLowerCase();
  return Object.prototype.hasOwnProperty.call(theme, v) ? theme[v as keyof typeof theme] : null;
}

/** A canvas colour for a colour value at an opacity (1 gives the plain hex). */
export function cssColor(v: unknown, opacity = 1): string {
  const hex = colorHex(v) ?? theme.accent;
  if (opacity >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, opacity)})`;
}

/** Canvas dash pattern of a line style. */
export function lineDash(style: unknown): number[] {
  return style === 'dashed' ? [6, 4] : style === 'dotted' ? [1.5, 3] : [];
}

/* ------------------------------ fib levels ------------------------------ */

const levelList = (values: readonly number[]): readonly FibLevel[] => values.map((value) => ({ value, color: 'accent', on: true }));

export const DEFAULT_LEVELS: readonly FibLevel[] = levelList(FIB_LEVELS);
/** The default level tables of the other Fibonacci tools. */
export const FIB_TIME_ZONE_TABLE: readonly FibLevel[] = levelList(FIB_TIME_ZONE_LEVELS);
export const FIB_SPEED_TABLE: readonly FibLevel[] = levelList(FIB_SPEED_LEVELS);
export const FIB_CIRCLE_TABLE: readonly FibLevel[] = levelList(FIB_CIRCLE_LEVELS);
export const FIB_ARC_TABLE: readonly FibLevel[] = levelList(FIB_ARC_LEVELS);
/** The default level tables of the Gann tools (the box and the square share the box levels). */
export const GANN_BOX_TABLE: readonly FibLevel[] = levelList(GANN_BOX_LEVELS);
export const GANN_FAN_TABLE: readonly FibLevel[] = levelList(GANN_FAN_LEVELS);
export const GANN_SQUARE_FAN_TABLE: readonly FibLevel[] = levelList(GANN_SQUARE_FAN_LEVELS);
export const GANN_SQUARE_ARC_TABLE: readonly FibLevel[] = levelList(GANN_SQUARE_ARC_LEVELS);
export const FIB_EXTENSION_TABLE: readonly FibLevel[] = levelList(FIB_EXTENSION_LEVELS);
export const FIB_TREND_TIME_TABLE: readonly FibLevel[] = levelList(FIB_TREND_TIME_LEVELS);
export const FIB_WEDGE_TABLE: readonly FibLevel[] = levelList(FIB_WEDGE_LEVELS);

/** A level list as stored: invalid entries are dropped, values deduplicated, the list cut to {@link MAX_LEVELS}. */
export function cleanLevels(raw: unknown): FibLevel[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<number>();
  const out: FibLevel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { value, color, on } = item as Record<string, unknown>;
    if (!finite(value) || Math.abs(value) > LEVEL_LIMIT || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, color: isColor(color) ? color : 'accent', on: typeof on === 'boolean' ? on : true });
    if (out.length >= MAX_LEVELS) break;
  }
  return raw.length > 0 && out.length === 0 ? undefined : out;
}

/** The list with a level added, or null when the value is refused (not finite, too large, a duplicate, or the list is full). */
export function addLevel(levels: readonly FibLevel[], value: number, color = 'accent'): FibLevel[] | null {
  if (!finite(value) || Math.abs(value) > LEVEL_LIMIT) return null;
  if (levels.length >= MAX_LEVELS || levels.some((l) => l.value === value)) return null;
  return [...levels, { value, color, on: true }];
}

export function removeLevel(levels: readonly FibLevel[], index: number): FibLevel[] {
  return levels.filter((_, i) => i !== index);
}

/** The list with one level's value changed; null when the new value is refused or duplicates another. */
export function setLevelValue(levels: readonly FibLevel[], index: number, value: number): FibLevel[] | null {
  if (!finite(value) || Math.abs(value) > LEVEL_LIMIT) return null;
  if (levels.some((l, i) => i !== index && l.value === value)) return null;
  return levels.map((l, i) => (i === index ? { ...l, value } : l));
}

/* ----------------------------- validation ----------------------------- */

/** The value when it is valid for the field, else undefined. */
export function validateValue(field: SettingField, v: unknown): unknown {
  switch (field.kind) {
    case 'color':
      return isColor(v) ? v : undefined;
    case 'opacity':
      return finite(v) && v >= (field.min ?? 0) && v <= (field.max ?? 1) ? v : undefined;
    case 'width':
      return finite(v) && v >= (field.min ?? 0.5) && v <= (field.max ?? 10) ? v : undefined;
    case 'number':
      return finite(v) && v >= (field.min ?? -Infinity) && v <= (field.max ?? Infinity) ? v : undefined;
    case 'lineStyle':
      return typeof v === 'string' && (LINE_STYLES as readonly string[]).includes(v) ? v : undefined;
    case 'boolean':
      return typeof v === 'boolean' ? v : undefined;
    case 'choice':
      return typeof v === 'string' && !!field.options?.some((o) => o.value === v) ? v : undefined;
    case 'levels':
      return cleanLevels(v);
  }
}

/** The stored style's valid known values only; a bad value is left out alone. */
export function pickValid(fields: readonly SettingField[], raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(r, f.key)) continue;
    const v = validateValue(f, r[f.key]);
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/* ------------------------------ visibility ------------------------------ */

export const TIMEFRAME_KINDS = ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months'] as const;
export type TimeframeKind = (typeof TIMEFRAME_KINDS)[number];

const KIND_LABEL: Record<TimeframeKind, string> = { seconds: 'Seconds', minutes: 'Minutes', hours: 'Hours', days: 'Days', weeks: 'Weeks', months: 'Months' };
export const kindKey = (k: TimeframeKind) => `show${k[0].toUpperCase()}${k.slice(1)}`;

/** Every drawing has these: which timeframe kinds show it (all on by default). */
export const VISIBILITY_FIELDS: readonly SettingField[] = TIMEFRAME_KINDS.map((k) => ({
  key: kindKey(k),
  label: KIND_LABEL[k],
  kind: 'boolean',
  tab: 'visibility',
  default: true,
}));

const UNIT_KIND: Record<string, TimeframeKind> = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days', w: 'weeks', M: 'months' };

/** The kind of a timeframe such as `15m`, `4h` or `1d`; null when it is not one. */
export function timeframeKind(interval: string | null | undefined): TimeframeKind | null {
  const m = /^[1-9][0-9]*([smhdwM])$/.exec(interval ?? '');
  return m ? UNIT_KIND[m[1]] : null;
}

/* ------------------------------ resolution ------------------------------ */

export type ResolvedStyle = {
  /** Every field of the tool (and the visibility fields) with its effective value. */
  values: Record<string, unknown>;
  /** The drawing or the user's default sets at least one of the tool's own style values. */
  styled: boolean;
};

/**
 * The effective style of a drawing: per field the stored value, else the user's default for the tool, else the
 * field default. A bad value falls back on its own.
 */
export function resolveStyle(fields: readonly SettingField[], stored: unknown, userDefault?: unknown): ResolvedStyle {
  const all = [...fields, ...VISIBILITY_FIELDS];
  const own = pickValid(all, stored);
  const def = pickValid(fields, userDefault);
  const values: Record<string, unknown> = {};
  for (const f of all) values[f.key] = f.key in own ? own[f.key] : f.key in def ? def[f.key] : f.default;
  const styled = fields.some((f) => f.key in own || f.key in def);
  return { values, styled };
}

/** The drawing is shown on a timeframe of this kind (always when the kind is unknown). */
export function visibleOn(values: Record<string, unknown>, kind: TimeframeKind | null): boolean {
  return kind === null || values[kindKey(kind)] !== false;
}

/**
 * The user's saved defaults as stored in prefs: per known tool only the valid style values; anything else is left out.
 */
export function sanitizeDefaults(raw: unknown, fieldsOf: (tool: string) => readonly SettingField[] | undefined): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [tool, style] of Object.entries(raw as Record<string, unknown>)) {
    const fields = fieldsOf(tool);
    if (!fields) continue;
    const valid = pickValid(fields, style);
    if (Object.keys(valid).length) out[tool] = valid;
  }
  return out;
}
