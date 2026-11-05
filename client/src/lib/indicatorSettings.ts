/**
 * The pure rules behind an indicator's settings: which timeframe kinds hide it, the saved per-kind defaults, whether it
 * is drawn on a chart and what Reset brings back. Everything read from storage goes through the sanitisers here.
 */
import { INDICATOR_META, type IndicatorDefault, type IndicatorKind, type IndicatorSpec } from './indicatorCompute';
import { TIMEFRAME_KINDS, timeframeKind, type TimeframeKind } from './drawingStyle';

/** The known timeframe kinds in `raw`, once each, in their usual order; anything else is dropped. */
export function sanitizeHideOn(raw: unknown): TimeframeKind[] {
  if (!Array.isArray(raw)) return [];
  return TIMEFRAME_KINDS.filter((k) => raw.includes(k));
}

/** `raw` as a spec list whose `hideOn` fields are clean (an empty or bad one is removed). Anything else is kept as it is. */
export function sanitizeIndicatorSpecs<T>(raw: T[]): T[] {
  return raw.map((s) => {
    if (typeof s !== 'object' || s === null || !('hideOn' in s)) return s;
    const { hideOn, ...rest } = s as Record<string, unknown>;
    const clean = sanitizeHideOn(hideOn);
    return (clean.length > 0 ? { ...rest, hideOn: clean } : rest) as T;
  });
}

const isKind = (k: string): k is IndicatorKind => Object.prototype.hasOwnProperty.call(INDICATOR_META, k);

/** One saved default; null when it holds nothing usable. Params are finite, inside the meta range and only the kind's own. */
function sanitizeOne(kind: IndicatorKind, raw: unknown): IndicatorDefault | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || kind === 'pine') return null;
  const r = raw as { params?: unknown; hideOn?: unknown };
  const params: Record<string, number> = {};
  const given = typeof r.params === 'object' && r.params !== null ? (r.params as Record<string, unknown>) : {};
  for (const p of INDICATOR_META[kind].params) {
    const v = given[p.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      params[p.key] = p.default;
      continue;
    }
    params[p.key] = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, p.type === 'int' ? Math.round(v) : v));
  }
  return { params, hideOn: sanitizeHideOn(r.hideOn) };
}

/** The saved per-kind defaults read from prefs: known built-in kinds only, each cleaned. */
export function sanitizeIndicatorDefaults(raw: unknown): Record<string, IndicatorDefault> {
  const out: Record<string, IndicatorDefault> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isKind(k)) continue;
    const d = sanitizeOne(k, v);
    if (d) out[k] = d;
  }
  return out;
}

/** The default of one kind as it can be saved (cleaned); null when it cannot be one. */
export function cleanIndicatorDefault(kind: IndicatorKind, raw: unknown): IndicatorDefault | null {
  return isKind(kind) ? sanitizeOne(kind, raw) : null;
}

/** Whether the indicator is drawn on a chart at `timeframe`: shown, and not hidden on this timeframe's kind. An unknown kind draws it. */
export function indicatorDrawn(spec: Pick<IndicatorSpec, 'visible' | 'hideOn'>, timeframe: string | null | undefined): boolean {
  if (!spec.visible) return false;
  const kind = timeframeKind(timeframe);
  return !(kind && spec.hideOn?.includes(kind));
}

/**
 * The spec after Reset: params and visibility back to the saved default of its kind (else the built-in values); a
 * Pine script's inputs and calculation overrides are cleared and it is shown on every timeframe.
 */
export function resetIndicator(spec: IndicatorSpec, saved: IndicatorDefault | null | undefined): IndicatorSpec {
  const { hideOn: _h, calculation: _c, ...rest } = spec;
  void _h;
  void _c;
  if (spec.kind === 'pine') return { ...rest, inputs: {} };
  const params = { ...Object.fromEntries(INDICATOR_META[spec.kind].params.map((p) => [p.key, p.default])), ...(saved?.params ?? {}) };
  const hideOn = saved?.hideOn ?? [];
  return { ...rest, params, ...(hideOn.length > 0 && { hideOn: [...hideOn] }) };
}

const SHORT_NAME: Partial<Record<IndicatorKind, string>> = { sma: 'SMA', ema: 'EMA', bb: 'BB' };

/** The name the settings dialog is titled with: the short name of a built-in kind, or the Pine script's own name as the row shows it. */
export function indicatorShortName(kind: IndicatorKind, pineName: string): string {
  return kind === 'pine' ? pineName : (SHORT_NAME[kind] ?? INDICATOR_META[kind].name);
}
