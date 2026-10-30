import type { SettingField, SettingTab } from '../../../lib/drawingStyle';
import { cssColor, lineDash } from '../../../lib/drawingStyle';
import { theme } from '../../../lib/theme';
import type { ToolView } from './types';

/** Builders for the settings a tool declares. */
export const colorField = (key: string, label: string, def: string, tab: SettingTab = 'style'): SettingField => ({ key, label, kind: 'color', tab, default: def });
export const opacityField = (key: string, label: string, def: number, tab: SettingTab = 'style'): SettingField => ({ key, label, kind: 'opacity', tab, default: def, min: 0, max: 1, step: 0.05 });
export const widthField = (key: string, label: string, def: number, min = 0.5, max = 10): SettingField => ({ key, label, kind: 'width', tab: 'style', default: def, min, max, step: 0.5 });
export const lineStyleField = (key: string, label: string): SettingField => ({ key, label, kind: 'lineStyle', tab: 'style', default: 'solid' });
export const boolField = (key: string, label: string, def: boolean, tab: SettingTab = 'style'): SettingField => ({ key, label, kind: 'boolean', tab, default: def });
export const numberField = (key: string, label: string, def: number, min: number, max: number, step: number, tab: SettingTab = 'style'): SettingField => ({ key, label, kind: 'number', tab, default: def, min, max, step });

/**
 * The colour a tool strokes with: its own colour at its opacity, or on an unstyled drawing the selection
 * highlight (`unstyledSelected`, today's accent2) while it is selected.
 */
export function strokeColor(view: ToolView, selected: boolean, unstyledSelected: string = theme.accent2, colorKey = 'color', opacityKey: string | null = 'opacity'): string {
  if (selected && !view.styled) return unstyledSelected;
  return cssColor(view.style[colorKey], opacityKey === null ? 1 : (view.style[opacityKey] as number));
}

/** The stroke width: the style's width, half a pixel heavier while selected. */
export function strokeWidth(view: ToolView, selected: boolean, key = 'width'): number {
  return (view.style[key] as number) + (selected ? 0.5 : 0);
}

/** Sets the canvas dash from a line style value. */
export function applyDash(ctx: CanvasRenderingContext2D, style: unknown): void {
  ctx.setLineDash(lineDash(style));
}

/** A setting that is one of a list of values (a select in the dialog). */
export const choiceField = (key: string, label: string, def: string, options: readonly { value: string; label: string }[], tab: SettingTab = 'style'): SettingField => ({ key, label, kind: 'choice', tab, default: def, options });
