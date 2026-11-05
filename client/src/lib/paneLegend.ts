import { fmtCompact, fmtPrice } from './format';
import { escapeHtml } from './legend';
import { INDICATOR_META, indicatorTitle, type IndicatorSpec } from './indicatorCompute';
import { indicatorDrawn, indicatorShortName } from './indicatorSettings';
import { pineIndicatorName } from './pine/title';
import type { PineRunState } from '../state/chart';

/** A legend value as shown: `-` for na, the compact form for volumes. */
export function legendValueText(value: number | null | undefined, compact = false, precision?: number): string {
  if (value == null || !Number.isFinite(value)) return '-';
  if (precision !== undefined) return value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
  return compact ? fmtCompact(value) : fmtPrice(value);
}

export interface PaneLegendEntry {
  /** The plot's title; empty lists the value alone. */
  title: string;
  color: string;
  /** The plot's value at the shown bar, null where it is na. */
  value: number | null;
}

export interface PaneLegendModel {
  name: string;
  /** Parameter or input values, shown after the name. */
  params: string[];
  entries: PaneLegendEntry[];
  /** Decimals of every value; absent = the default format. */
  precision?: number;
}

/** Markup for the legend of one indicator sub pane: its name and parameters, then each plot's value in its colour. */
export function paneLegendHtml(m: PaneLegendModel): string {
  const params = m.params.length > 0 ? ` <span class="pane-legend-params">${escapeHtml(m.params.join(' '))}</span>` : '';
  const entries = m.entries
    .map((e) => {
      const title = e.title ? `<span class="pane-legend-plot">${escapeHtml(e.title)}</span> ` : '';
      const value = legendValueText(e.value, false, m.precision);
      return `<span class="pane-legend-entry" style="color:${escapeHtml(e.color)}">${title}<b>${escapeHtml(value)}</b></span>`;
    })
    .join(' ');
  return `<span class="pane-legend-title">${escapeHtml(m.name)}</span>${params} ${entries}`;
}

/** One indicator's row in the price pane's legend. Its plots and values are filled in from the series now built. */
export interface LegendRow {
  id: string;
  kind: 'builtin' | 'pine';
  name: string;
  /** Parameter or input values, shown after the name. */
  params: string[];
  /** Turned off with the eye: the row is dimmed and shows no values. */
  hidden: boolean;
  /** A Pine script with no result (running, or its run failed): the name only. */
  pending: boolean;
}

/** A Pine script's input values, in declaration order, as its legend shows them. */
export function pineInputParams(spec: Pick<IndicatorSpec, 'inputs' | 'style'>, run: PineRunState | undefined): string[] {
  if (!run?.result || spec.style?.inputsInStatusLine === false) return [];
  return run.result.inputs.flatMap((inp) => {
    const v = spec.inputs?.[inp.name] ?? inp.defval;
    return v == null ? [] : [String(v)];
  });
}

/** A built-in indicator's parameter values as its legend shows them: none when its inputs are off in the status line. */
export function builtinParams(spec: IndicatorSpec): string[] {
  return spec.style?.inputsInStatusLine === false ? [] : INDICATOR_META[spec.kind].params.map((p) => String(spec.params[p.key]));
}

const isSubKind = (spec: IndicatorSpec) => spec.kind === 'rsi' || spec.kind === 'macd';

/**
 * The rows of the price pane's legend, in list order: overlays, Volume and Pine scripts that draw there, and every
 * hidden indicator (a hidden RSI, MACD or Pine pane has no pane of its own, so its dimmed row is listed here).
 * An indicator turned off for the timeframe's kind has no row.
 */
export function priceLegendRows(
  indicators: readonly IndicatorSpec[],
  timeframe: string | null | undefined,
  pineRuns: Record<string, PineRunState>,
): LegendRow[] {
  const rows: LegendRow[] = [];
  for (const spec of indicators) {
    if (!indicatorDrawn({ ...spec, visible: true }, timeframe)) continue; // off for this kind: no row, hidden or not
    const hidden = !spec.visible;
    if (spec.kind === 'pine') {
      const run = pineRuns[spec.id];
      const plots = run?.result?.plots ?? [];
      // A script whose plots are all in its own pane is listed in that pane's legend, not here.
      if (!hidden && plots.length > 0 && plots.every((p) => p.pane === 'separate')) continue;
      rows.push({
        id: spec.id,
        kind: 'pine',
        name: pineIndicatorName(spec.source ?? '', run?.result?.declaration.title),
        params: pineInputParams(spec, run),
        hidden,
        pending: !run?.result,
      });
      continue;
    }
    if (isSubKind(spec)) {
      // A shown RSI or MACD has its own pane and legend there; only a hidden one is listed here.
      if (!hidden) continue;
      rows.push({
        id: spec.id,
        kind: 'builtin',
        name: INDICATOR_META[spec.kind].name,
        params: builtinParams(spec),
        hidden,
        pending: false,
      });
      continue;
    }
    // With the inputs off the row is named without them ("EMA", not "EMA 20").
    const name = spec.style?.inputsInStatusLine === false ? indicatorShortName(spec.kind, '') : indicatorTitle(spec);
    rows.push({ id: spec.id, kind: 'builtin', name, params: [], hidden, pending: false });
  }
  return rows;
}

