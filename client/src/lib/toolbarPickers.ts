/**
 * The quick pickers the floating drawing toolbar offers for a tool: the first colour, width and line-style field the
 * tool declares. Pure: no React or chart imports.
 */
import type { SettingField } from './drawingStyle';

/** The theme tokens of the colour popover's swatch row. */
export const SWATCHES = ['text', 'muted', 'accent', 'green', 'red', 'amber'] as const;

export type Pickers = { color?: SettingField; width?: SettingField; lineStyle?: SettingField };

export function pickerFields(settings: readonly SettingField[] | undefined): Pickers {
  const list = settings ?? [];
  const out: Pickers = {};
  const color = list.find((f) => f.kind === 'color');
  const width = list.find((f) => f.kind === 'width');
  const lineStyle = list.find((f) => f.kind === 'lineStyle');
  if (color) out.color = color;
  if (width) out.width = width;
  if (lineStyle) out.lineStyle = lineStyle;
  return out;
}

/** A drawing's style with one value set, every other key kept. */
export function withStyleValue(style: Readonly<Record<string, unknown>> | undefined, key: string, value: unknown): Record<string, unknown> {
  return { ...style, [key]: value };
}

/** The widths the width popover offers: whole numbers from the field's minimum up to its maximum. */
export function widthChoices(field: Pick<SettingField, 'min' | 'max'>): number[] {
  const min = Math.ceil(field.min ?? 1);
  const max = Math.floor(field.max ?? 10);
  const out: number[] = [];
  for (let w = min; w <= max; w++) out.push(w);
  return out;
}
