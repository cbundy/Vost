/** Layout and value conversions for a Pine script's inputs. Pure (no DOM), so it is unit tested. */
import type { PineInput } from './types';
import { pineTimeframe } from './market';

export interface InputRow {
  inputs: PineInput[];
}

export interface InputSection {
  /** The script's `group` heading; null for inputs without one. */
  group: string | null;
  rows: InputRow[];
}

/**
 * Ungrouped inputs first, then each group in the order it is first seen. Consecutive inputs of one group that share an
 * `inline` value form a row; every other input is a row of its own.
 */
export function layoutInputs(inputs: readonly PineInput[]): InputSection[] {
  const sections: InputSection[] = [];
  const byGroup = new Map<string | null, InputSection>();
  const lastInline = new Map<InputSection, string | undefined>();
  for (const inp of inputs) {
    const group = inp.group ? inp.group : null;
    let section = byGroup.get(group);
    if (!section) {
      section = { group, rows: [] };
      byGroup.set(group, section);
      sections.push(section);
    }
    const prev = section.rows[section.rows.length - 1];
    if (inp.inline && prev && lastInline.get(section) === inp.inline) prev.inputs.push(inp);
    else section.rows.push({ inputs: [inp] });
    lastInline.set(section, inp.inline || undefined);
  }
  return sections.sort((a, b) => (a.group === null ? 0 : 1) - (b.group === null ? 0 : 1));
}

const HEX = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i;

/** Splits `#RRGGBB` or `#RRGGBBAA` into the color and an alpha of 0..255 (a 6-digit value is opaque). */
export function splitColor(value: string): { hex: string; alpha: number } {
  const m = HEX.exec(value.trim());
  if (!m) return { hex: '#000000', alpha: 255 };
  return { hex: `#${m[1].toLowerCase()}`, alpha: m[2] ? parseInt(m[2], 16) : 255 };
}

/** `#RRGGBB` plus an alpha of 0..255 as `#RRGGBBAA` (upper case, as PineTS writes it). */
export function joinColor(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  const base = HEX.exec(hex.trim())?.[1] ?? '000000';
  return `#${base.toUpperCase()}${a.toString(16).padStart(2, '0').toUpperCase()}`;
}

/** Epoch ms as the `YYYY-MM-DDTHH:mm` text of a datetime-local field, read as UTC. */
export function timeToUtcText(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16);
}

/** The epoch ms of a UTC `YYYY-MM-DDTHH:mm` text, or null when it is not a date. */
export function utcTextToTime(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) return null;
  const ms = Date.parse(`${text}${text.length === 16 ? ':00' : ''}Z`);
  return Number.isNaN(ms) ? null : ms;
}

export interface TimeframeOption {
  value: string;
  label: string;
}

/** "Chart" (the empty string) plus the chart's picker intervals as Pine timeframes; a current value not in the list is added as itself. */
export function timeframeOptions(intervals: readonly string[], current: string): TimeframeOption[] {
  const out: TimeframeOption[] = [{ value: '', label: 'Chart' }];
  for (const iv of intervals) {
    const tf = pineTimeframe(iv);
    if (tf !== null && !out.some((o) => o.value === tf)) out.push({ value: tf, label: iv });
  }
  if (!out.some((o) => o.value === current)) out.push({ value: current, label: current });
  return out;
}

/** Inputs whose value is text; every other type is a number in the Backtest pane's `params`. */
export function isTextInput(input: PineInput): boolean {
  if (input.options && input.options.length > 0) return input.options.some((o) => typeof o === 'string');
  return ['color', 'source', 'symbol', 'session', 'timeframe', 'string', 'text_area'].includes(input.type) || typeof input.defval === 'string';
}
