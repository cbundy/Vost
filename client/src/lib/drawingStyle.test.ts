import { describe, expect, it } from 'vitest';
import { TOOLS, getTool } from '../components/chart/tools';
import { FIB_LEVELS } from './geometry/fib';
import {
  DEFAULT_LEVELS,
  MAX_LEVELS,
  VISIBILITY_FIELDS,
  addLevel,
  cleanLevels,
  colorHex,
  cssColor,
  removeLevel,
  resolveStyle,
  sanitizeDefaults,
  setLevelValue,
  timeframeKind,
  validateValue,
  visibleOn,
} from './drawingStyle';
import { theme } from './theme';

const fieldsOf = (id: string) => getTool(id)!.settings!;
const defaults = (id: string) => resolveStyle(fieldsOf(id), undefined).values;

describe('default styles equal the look drawings had before styles', () => {
  it('trend line and ray', () => {
    for (const id of ['trendLine', 'ray']) {
      const v = defaults(id);
      expect(v.color).toBe('accent');
      expect(colorHex(v.color)).toBe(theme.accent);
      expect(v).toMatchObject({ opacity: 1, width: 1.5, lineStyle: 'solid', extendLeft: false, arrowStart: false, arrowEnd: false, showPriceChange: false, showAngle: false, showBars: false });
    }
    expect(defaults('trendLine').extendRight).toBe(false);
    expect(defaults('ray')).toMatchObject({ extendRight: true, extendLeft: false });
  });
  it('horizontal line', () => {
    const v = defaults('horizontalLine');
    expect(colorHex(v.color)).toBe(theme.amber);
    expect(cssColor(v.color, v.opacity as number)).toBe('rgba(245,158,11,0.85)');
    expect(v).toMatchObject({ width: 1.5, lineStyle: 'solid', showLabel: true, labelColor: 'amber' });
  });
  it('rectangle', () => {
    const v = defaults('rectangle');
    expect(colorHex(v.color)).toBe(theme.accent);
    expect(cssColor(v.fillColor, v.fillOpacity as number)).toBe('rgba(59,130,246,0.15)');
    expect(v).toMatchObject({ width: 1.5, lineStyle: 'solid', extendLeft: false, extendRight: false });
  });
  it('fibonacci retracement', () => {
    const v = defaults('fibRetracement');
    expect((v.levels as { value: number }[]).map((l) => l.value)).toEqual([...FIB_LEVELS]);
    expect((v.levels as { on: boolean; color: string }[]).every((l) => l.on && colorHex(l.color) === theme.accent)).toBe(true);
    expect(v).toMatchObject({ showLevels: true, showPrices: true, reverse: false, extendLines: false, background: false });
  });
  it('the other fibonacci tools resolve their tables and put labels on the Text tab', () => {
    const vals = (v: Record<string, unknown>, k: string) => (v[k] as { value: number }[]).map((l) => l.value);
    expect(vals(defaults('fibTimeZone'), 'levels')).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
    expect(vals(defaults('fibSpeedFan'), 'priceLevels')).toEqual([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]);
    expect(vals(defaults('fibSpeedFan'), 'timeLevels')).toEqual([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]);
    expect(vals(defaults('fibCircles'), 'levels')).toEqual([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]);
    expect(vals(defaults('fibSpeedArcs'), 'levels')).toEqual([0.236, 0.382, 0.5, 0.618, 0.786, 1]);
    expect(defaults('fibSpiral')).toMatchObject({ counterClockwise: false });
    expect(defaults('fibSpeedArcs')).toMatchObject({ fullCircles: false });
    for (const [id, keys] of [['fibTimeZone', ['showLabels']], ['fibSpeedFan', ['labelsLeft', 'labelsRight', 'labelsTop', 'labelsBottom']], ['fibCircles', ['showLabels']], ['fibSpeedArcs', ['showLabels']]] as const) {
      const text = fieldsOf(id).filter((f) => f.tab === 'text').map((f) => f.key);
      expect(text).toEqual(keys);
    }
    expect(fieldsOf('fibSpiral').some((f) => f.tab === 'text')).toBe(false);
  });
  it('text', () => {
    const v = defaults('text');
    expect(colorHex(v.color)).toBe(theme.text);
    expect(cssColor(v.backgroundColor, v.backgroundOpacity as number)).toBe('rgba(23,23,27,0.92)');
    expect(colorHex(v.borderColor)).toBe(theme.border3);
    expect(v).toMatchObject({ size: 12, bold: false, italic: false, align: 'left', wrap: true, wrapWidth: 240 });
  });
  it('anchored text', () => {
    expect(defaults('anchoredText')).toMatchObject({ size: 14, bold: false, italic: false, align: 'left', wrap: false, wrapWidth: 240 });
  });
  it('every default colour names a theme token, not a fixed hex (the pitchforks keep TradingView\'s fixed palette)', () => {
    for (const t of TOOLS) {
      const fixed = t.id.toLowerCase().endsWith('pitchfork');
      for (const f of t.settings ?? []) {
        if (f.kind !== 'color') continue;
        if (fixed) expect(f.default).toMatch(/^#[0-9a-fA-F]{6}$/);
        else expect(Object.keys(theme)).toContain(f.default);
      }
    }
  });
  it('every drawing is visible on every timeframe kind', () => {
    for (const f of VISIBILITY_FIELDS) expect(defaults('trendLine')[f.key]).toBe(true);
    expect(VISIBILITY_FIELDS).toHaveLength(6);
  });
  it('an unstyled drawing is not styled', () => {
    for (const t of TOOLS.filter((x) => x.settings)) expect(resolveStyle(t.settings!, undefined).styled).toBe(false);
  });
});

describe('every registered tool declares settings', () => {
  it('each stored tool has them; the transient measure has none', () => {
    for (const t of TOOLS) {
      if (t.transient) expect(t.settings).toBeUndefined();
      else expect(t.settings && t.settings.length > 0, t.id).toBe(true);
    }
  });
  it('keys are unique within a tool and do not clash with visibility keys', () => {
    for (const t of TOOLS.filter((x) => x.settings)) {
      const keys = [...t.settings!, ...VISIBILITY_FIELDS].map((f) => f.key);
      expect(new Set(keys).size, t.id).toBe(keys.length);
    }
  });
  it('each default is valid for its own field', () => {
    for (const t of TOOLS.filter((x) => x.settings)) for (const f of t.settings!) expect(validateValue(f, f.default), `${t.id}.${f.key}`).toBeDefined();
  });
  it('only the text tools store text, and they, the line tools and the labelled Fibonacci tools declare Text settings', () => {
    for (const t of TOOLS) expect(t.settings?.some((f) => f.tab === 'text') ?? false, t.id).toBe(['infoLine', 'extendedLine', 'trendAngle', 'text', 'anchoredText', 'arrowMarker', 'arrowMarkUp', 'arrowMarkDown', 'fibTimeZone', 'fibSpeedFan', 'fibCircles', 'fibSpeedArcs'].includes(t.id));
    expect(TOOLS.filter((t) => t.text).map((t) => t.id)).toEqual(['text', 'anchoredText']);
    expect(TOOLS.filter((t) => t.caption).map((t) => t.id)).toEqual(['arrowMarker', 'arrowMarkUp', 'arrowMarkDown']);
  });
});

describe('choice settings', () => {
  const align = fieldsOf('text').find((f) => f.key === 'align')!;
  it('accepts only a listed value', () => {
    for (const v of ['left', 'center', 'right']) expect(validateValue(align, v)).toBe(v);
    for (const v of ['middle', '', 5, null, undefined]) expect(validateValue(align, v)).toBeUndefined();
  });
  it('a field with no options accepts nothing', () => {
    expect(validateValue({ ...align, options: undefined }, 'left')).toBeUndefined();
  });
  it('falls back on the default for a bad stored value and survives sanitizeDefaults', () => {
    expect(resolveStyle(fieldsOf('text'), { align: 'middle' }).values.align).toBe('left');
    expect(resolveStyle(fieldsOf('text'), { align: 'right' }).values.align).toBe('right');
    expect(sanitizeDefaults({ text: { align: 'center', size: 20 }, anchoredText: { align: 'bad' } }, (t) => getTool(t)?.settings)).toEqual({ text: { align: 'center', size: 20 } });
  });
});

describe('resolveStyle', () => {
  const f = fieldsOf('trendLine');
  it('prefers the stored value, then the user default, then the tool default', () => {
    expect(resolveStyle(f, { width: 4 }, { width: 3, opacity: 0.5 }).values).toMatchObject({ width: 4, opacity: 0.5, color: 'accent' });
    expect(resolveStyle(f, {}, { width: 3 }).values.width).toBe(3);
    expect(resolveStyle(f, undefined, undefined).values.width).toBe(1.5);
  });
  it('a bad value falls back alone', () => {
    const r = resolveStyle(f, { width: 'wide', color: 'nope', opacity: 7, lineStyle: 'wavy', extendLeft: 1, arrowEnd: true }, { width: 3 }).values;
    expect(r).toMatchObject({ width: 3, color: 'accent', opacity: 1, lineStyle: 'solid', extendLeft: false, arrowEnd: true });
    expect(resolveStyle(f, { width: NaN }).values.width).toBe(1.5);
    expect(resolveStyle(f, 'junk').values.width).toBe(1.5);
    expect(resolveStyle(f, [1]).values.width).toBe(1.5);
  });
  it('ignores unknown keys', () => {
    expect(resolveStyle(f, { mystery: 1 }).values).not.toHaveProperty('mystery');
    expect(resolveStyle(f, { mystery: 1 }).styled).toBe(false);
  });
  it('is styled when the drawing or the user default sets a style value', () => {
    expect(resolveStyle(f, { width: 2 }).styled).toBe(true);
    expect(resolveStyle(f, undefined, { color: '#ff0000' }).styled).toBe(true);
    expect(resolveStyle(f, { showDays: false }).styled).toBe(false);
  });
});

describe('visibility', () => {
  it('maps a timeframe to its kind', () => {
    expect(timeframeKind('15m')).toBe('minutes');
    expect(timeframeKind('4h')).toBe('hours');
    expect(timeframeKind('1d')).toBe('days');
    expect(timeframeKind('1w')).toBe('weeks');
    expect(timeframeKind('3M')).toBe('months');
    expect(timeframeKind('30s')).toBe('seconds');
    expect(timeframeKind('')).toBeNull();
    expect(timeframeKind('weird')).toBeNull();
  });
  it('hides only the kinds switched off', () => {
    const v = resolveStyle(fieldsOf('trendLine'), { showDays: false }).values;
    expect(visibleOn(v, 'days')).toBe(false);
    expect(visibleOn(v, 'minutes')).toBe(true);
    expect(visibleOn(v, null)).toBe(true);
  });
});

describe('fibonacci level lists', () => {
  const base = DEFAULT_LEVELS.map((l) => ({ ...l }));
  it('adds and removes a level', () => {
    const added = addLevel(base, 1.618)!;
    expect(added).toHaveLength(base.length + 1);
    expect(added.at(-1)).toMatchObject({ value: 1.618, on: true });
    expect(removeLevel(added, added.length - 1)).toEqual(base);
  });
  it('refuses non-finite, duplicate and out-of-range values', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0.5, 1e9]) expect(addLevel(base, bad)).toBeNull();
  });
  it('is capped at the limit', () => {
    let l = base;
    for (let i = 0; l.length < MAX_LEVELS; i++) l = addLevel(l, 10 + i)!;
    expect(l).toHaveLength(MAX_LEVELS);
    expect(addLevel(l, 99)).toBeNull();
  });
  it('cleans a stored list: drops bad entries, deduplicates and caps', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ value: i, color: 'accent', on: true }));
    expect(cleanLevels(many)).toHaveLength(MAX_LEVELS);
    expect(cleanLevels([{ value: 1 }, { value: 1, color: '#ff0000' }, { value: NaN }, 'x', { value: 2, on: false, color: 'zzz' }])).toEqual([
      { value: 1, color: 'accent', on: true },
      { value: 2, color: 'accent', on: false },
    ]);
    expect(cleanLevels([])).toEqual([]);
    expect(cleanLevels('no')).toBeUndefined();
    expect(cleanLevels([{ value: NaN }])).toBeUndefined();
  });
  it('a bad stored list falls back to the default levels', () => {
    const r = resolveStyle(fieldsOf('fibRetracement'), { levels: [{ value: NaN }] }).values.levels as { value: number }[];
    expect(r.map((l) => l.value)).toEqual([...FIB_LEVELS]);
  });
  it('edits a value but refuses a duplicate or non-finite one', () => {
    expect(setLevelValue(base, 1, 0.3)![1].value).toBe(0.3);
    expect(setLevelValue(base, 1, 0.5)).toBeNull();
    expect(setLevelValue(base, 1, NaN)).toBeNull();
  });
});

describe('sanitizeDefaults', () => {
  const lookup = (id: string) => getTool(id)?.settings;
  it('keeps valid values of known tools only', () => {
    expect(sanitizeDefaults({ trendLine: { width: 3, color: 'nope', mystery: 1 }, ghost: { width: 3 }, ray: 'x', rectangle: {}, horizontalLine: { showDays: false } }, lookup)).toEqual({ trendLine: { width: 3 } });
  });
  it('loads nothing from a wrong shape', () => {
    for (const bad of [null, 5, 'x', [], undefined, { __proto__: 1 }]) expect(sanitizeDefaults(bad, lookup)).toEqual({});
    expect(sanitizeDefaults({ toString: { width: 3 }, constructor: {} }, lookup)).toEqual({});
  });
});

describe('the choice kind', () => {
  const field = { key: 'source', label: 'Source', kind: 'choice', tab: 'style', default: 'close', options: [{ value: 'close', label: 'close' }, { value: 'open', label: 'open' }, { value: 'hl2', label: 'hl2' }] } as const;
  it('keeps a listed value and drops an unlisted or non-string one', () => {
    expect(validateValue(field, 'hl2')).toBe('hl2');
    expect(validateValue(field, 'vwap')).toBeUndefined();
    expect(validateValue(field, 3)).toBeUndefined();
    expect(validateValue({ ...field, options: undefined }, 'close')).toBeUndefined();
  });
  it('is validated in a stored style and in saved defaults', () => {
    const lookup = (id: string) => (id === 'regressionTrend' ? getTool(id)?.settings : undefined);
    expect(resolveStyle([field], { source: 'open' }).values.source).toBe('open');
    expect(resolveStyle([field], { source: 'nope' }).values.source).toBe('close');
    expect(resolveStyle([field], undefined, { source: 'open' }).values.source).toBe('open');
    expect(sanitizeDefaults({ regressionTrend: { source: 'hlc3', deviation: 3 } }, lookup)).toEqual({ regressionTrend: { source: 'hlc3', deviation: 3 } });
    expect(sanitizeDefaults({ regressionTrend: { source: 'vwap', deviation: 3 } }, lookup)).toEqual({ regressionTrend: { deviation: 3 } });
  });
  it('the regression tool offers the seven sources with close as default', () => {
    const f = getTool('regressionTrend')!.settings!.find((x) => x.key === 'source')!;
    expect(f.options?.map((o) => o.value)).toEqual(['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4']);
    expect(f.default).toBe('close');
  });
});
