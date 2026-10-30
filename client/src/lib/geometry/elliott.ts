/**
 * Elliott wave maths (the five Elliott wave drawing tools). Pure: no React and no canvas.
 *
 * Confirmed against TradingView on 2026-10-30 from its Advanced Charts line-tool bundle
 * (https://charting-library.tradingview-widget.com/charting_library/bundles/line-tool-elliott.9c1e59073e28b2da11c6.js)
 * and its API docs (https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.ElliottimpulseLineToolOverrides,
 * default `degree` 7 = Intermediate). TradingView has 15 degrees, largest first: Supermillennium to Minuscule. A degree sits in
 * a group of three (group = floor((14 - degree index) / 3), counted from the smallest) and is drawn plain, in brackets or
 * circled in turn within its group: the smallest of the three is plain, the middle one bracketed, the largest circled.
 * The groups from the smallest are Arabic / lower case, lower case Roman / lower case, Arabic / upper case, upper case
 * Roman / lower case and Arabic / upper case (the impulse numbering / the corrective letters). Each group has its own
 * font size and weight. Every tool's label set starts at "0": the origin, which TradingView shows only while the
 * drawing is selected or hovered. TradingView does not recolour by degree, so neither do we.
 */

export interface ElliottDegree {
  value: string;
  label: string;
  /** TradingView's group of three degrees, 0 (the smallest) to 4: sets the numbering family, letter case, font size and weight. */
  group: 0 | 1 | 2 | 3 | 4;
  /** How the label is decorated: plain, in (brackets) or in a circle. */
  decoration: 'none' | 'brackets' | 'circle';
}

const NAMES: readonly [string, string][] = [
  ['supermillennium', 'Supermillennium'],
  ['millennium', 'Millennium'],
  ['submillennium', 'Submillennium'],
  ['grandSupercycle', 'Grand Supercycle'],
  ['supercycle', 'Supercycle'],
  ['cycle', 'Cycle'],
  ['primary', 'Primary'],
  ['intermediate', 'Intermediate'],
  ['minor', 'Minor'],
  ['minute', 'Minute'],
  ['minuette', 'Minuette'],
  ['subminuette', 'Subminuette'],
  ['micro', 'Micro'],
  ['submicro', 'Submicro'],
  ['minuscule', 'Minuscule'],
];

/** The degrees, largest first, in TradingView's order. */
export const ELLIOTT_DEGREES: readonly ElliottDegree[] = NAMES.map(([value, label], i) => {
  const t = NAMES.length - 1 - i;
  return { value, label, group: Math.floor(t / 3) as ElliottDegree['group'], decoration: (['none', 'brackets', 'circle'] as const)[t % 3] };
});

export const ELLIOTT_DEFAULT_DEGREE = 'intermediate';

/** TradingView's font size, circle diameter (px) and weight per group, at the default text size. */
const GROUP_STYLE: Readonly<Record<number, { font: number; circle: number; bold: boolean }>> = {
  4: { font: 24, circle: 36, bold: true },
  3: { font: 20, circle: 28, bold: false },
  2: { font: 18, circle: 22, bold: false },
  1: { font: 16, circle: 22, bold: false },
  0: { font: 11, circle: 14, bold: true },
};

/** The text size setting TradingView's font sizes correspond to. */
export const ELLIOTT_BASE_TEXT_SIZE = 12;

/** How a degree's labels are drawn at a text size: the font size, whether bold, and the circle diameter (0 for no circle). */
export function waveFormat(degree: string, textSize = ELLIOTT_BASE_TEXT_SIZE): { fontSize: number; bold: boolean; circle: number } {
  const d = findDegree(degree);
  const g = GROUP_STYLE[d.group];
  const k = textSize / ELLIOTT_BASE_TEXT_SIZE;
  return { fontSize: Math.round(g.font * k), bold: g.bold, circle: d.decoration === 'circle' ? Math.round(g.circle * k) : 0 };
}

function findDegree(degree: string): ElliottDegree {
  return ELLIOTT_DEGREES.find((x) => x.value === degree) ?? ELLIOTT_DEGREES.find((x) => x.value === ELLIOTT_DEFAULT_DEGREE)!;
}

export type ElliottKind = 'impulse' | 'correction' | 'triangle' | 'doubleCombo' | 'tripleCombo';

/** The wave names per tool, one per point; the origin is "0". */
export const ELLIOTT_WAVES: Readonly<Record<ElliottKind, readonly string[]>> = {
  impulse: ['0', '1', '2', '3', '4', '5'],
  correction: ['0', 'A', 'B', 'C'],
  triangle: ['0', 'A', 'B', 'C', 'D', 'E'],
  doubleCombo: ['0', 'W', 'X', 'Y'],
  tripleCombo: ['0', 'W', 'X', 'Y', 'X', 'Z'],
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/**
 * The label text of point `index` of a tool at a degree; an unknown degree uses the default; '' for a missing point.
 * Brackets are part of the text; a circled degree returns the bare text (the caller draws the circle, see waveFormat).
 */
export function waveLabel(kind: ElliottKind, index: number, degree: string): string {
  const name = ELLIOTT_WAVES[kind][index];
  if (!name) return '';
  const d = findDegree(degree);
  let text = name;
  if (index > 0) {
    if (kind === 'impulse') {
      // Group 1 is lower case Roman, group 3 upper case Roman, the others Arabic.
      if (d.group === 1) text = ROMAN[Number(name)].toLowerCase();
      else if (d.group === 3) text = ROMAN[Number(name)];
    } else if (d.group === 1 || d.group === 3) {
      text = name.toLowerCase();
    }
  }
  return d.decoration === 'brackets' ? `(${text})` : text;
}
