import { fmtCompact, fmtPrice, fmtTime } from './format';

export interface LegendBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${fmtPrice(v)}`;
}

/** Legend markup: title and coloured OHLC with change on line 1, volume and bar time on line 2. */
export function legendHtml(bar: LegendBar, label: string, timeZone: string): string {
  const diff = bar.close - bar.open;
  const pct = bar.open !== 0 ? (diff / bar.open) * 100 : 0;
  const cls = bar.close >= bar.open ? 'pos' : 'neg';
  const pctText = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  return (
    `<div class="legend-line">` +
    `<span class="legend-title">${escapeHtml(label)}</span>` +
    `<span class="legend-ohlc ${cls}">` +
    `O <b>${fmtPrice(bar.open)}</b> H <b>${fmtPrice(bar.high)}</b> L <b>${fmtPrice(bar.low)}</b> C <b>${fmtPrice(bar.close)}</b> ` +
    `<span class="legend-chg">${escapeHtml(signed(diff))} (${pctText})</span>` +
    `</span></div>` +
    `<div class="legend-sub">V <b>${fmtCompact(bar.volume)}</b> ` +
    `<span>${escapeHtml(fmtTime(bar.time, { timeZone }))}</span></div>`
  );
}
