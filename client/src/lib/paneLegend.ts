import { fmtPrice } from './format';
import { escapeHtml } from './legend';

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
}

/** Markup for the legend of one indicator sub pane: its name and parameters, then each plot's value in its colour. */
export function paneLegendHtml(m: PaneLegendModel): string {
  const params = m.params.length > 0 ? ` <span class="pane-legend-params">${escapeHtml(m.params.join(' '))}</span>` : '';
  const entries = m.entries
    .map((e) => {
      const title = e.title ? `<span class="pane-legend-plot">${escapeHtml(e.title)}</span> ` : '';
      const value = e.value == null || !Number.isFinite(e.value) ? '-' : fmtPrice(e.value);
      return `<span class="pane-legend-entry" style="color:${escapeHtml(e.color)}">${title}<b>${escapeHtml(value)}</b></span>`;
    })
    .join(' ');
  return `<span class="pane-legend-title">${escapeHtml(m.name)}</span>${params} ${entries}`;
}
