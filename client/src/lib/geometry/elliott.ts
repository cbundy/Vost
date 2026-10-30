/**
 * Elliott wave maths (the five Elliott wave drawing tools). Pure: no React and no canvas.
 *
 * Wave degrees and notation follow the standard Elliott wave scheme that TradingView's Elliott wave tools use
 * (Elliott impulse wave (12345), correction wave (ABC), triangle wave (ABCDE), double combo wave (WXY), triple combo
 * wave (WXYXZ)): nine degrees from the largest to the smallest, an impulse numbered with upper case Roman numerals
 * in the three largest degrees, Arabic numerals in the next three and lower case Roman numerals in the smallest
 * three, wrapped in double parentheses, single parentheses or none in turn. Corrective waves use the same wrappers
 * on upper case letters (the six largest degrees) or lower case letters (the three smallest).
 *
 * NOT CONFIRMED against TradingView's own help pages: they were unreachable from the build environment (the guessed
 * support URLs returned 404 or an unrelated page, checked 2026-10-30). The degree list is the standard nine; the
 * default degree (Intermediate) and the choice to leave the origin point unlabelled follow the builder's memory of
 * TradingView's chart behaviour. TradingView's longer list of degrees (Millennium and the Micro degrees) and any
 * per-degree colour are not modelled: the line colour is a plain setting. Confirm against TradingView and adjust
 * DEGREES, ELLIOTT_DEFAULT_DEGREE and the label sets below.
 */

export interface ElliottDegree {
  value: string;
  label: string;
  /** Which numbering family the degree uses: 0 = upper case Roman, 1 = Arabic, 2 = lower case Roman. */
  family: 0 | 1 | 2;
  /** How the label is wrapped: 2 = ((x)), 1 = (x), 0 = x. */
  wrap: 0 | 1 | 2;
  /** Whether corrective letters are upper case. */
  upper: boolean;
}

/** The degrees, largest first. */
export const ELLIOTT_DEGREES: readonly ElliottDegree[] = [
  { value: 'grandSupercycle', label: 'Grand Supercycle', family: 0, wrap: 2, upper: true },
  { value: 'supercycle', label: 'Supercycle', family: 0, wrap: 1, upper: true },
  { value: 'cycle', label: 'Cycle', family: 0, wrap: 0, upper: true },
  { value: 'primary', label: 'Primary', family: 1, wrap: 2, upper: true },
  { value: 'intermediate', label: 'Intermediate', family: 1, wrap: 1, upper: true },
  { value: 'minor', label: 'Minor', family: 1, wrap: 0, upper: true },
  { value: 'minute', label: 'Minute', family: 2, wrap: 2, upper: false },
  { value: 'minuette', label: 'Minuette', family: 2, wrap: 1, upper: false },
  { value: 'subMinuette', label: 'Sub-Minuette', family: 2, wrap: 0, upper: false },
];

export const ELLIOTT_DEFAULT_DEGREE = 'intermediate';

export type ElliottKind = 'impulse' | 'correction' | 'triangle' | 'doubleCombo' | 'tripleCombo';

/** The wave names per tool, one per point; an empty name is an unlabelled point (the origin). */
export const ELLIOTT_WAVES: Readonly<Record<ElliottKind, readonly string[]>> = {
  impulse: ['', '1', '2', '3', '4', '5'],
  correction: ['', 'A', 'B', 'C'],
  triangle: ['', 'A', 'B', 'C', 'D', 'E'],
  doubleCombo: ['', 'W', 'X', 'Y'],
  tripleCombo: ['', 'W', 'X', 'Y', 'X', 'Z'],
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** The label text of point `index` of a tool at a degree; an unknown degree uses the default; '' for the origin or a missing point. */
export function waveLabel(kind: ElliottKind, index: number, degree: string): string {
  const name = ELLIOTT_WAVES[kind][index];
  if (!name) return '';
  const d = ELLIOTT_DEGREES.find((x) => x.value === degree) ?? ELLIOTT_DEGREES.find((x) => x.value === ELLIOTT_DEFAULT_DEGREE)!;
  let text: string;
  if (kind === 'impulse') {
    const n = Number(name);
    text = d.family === 1 ? name : d.family === 0 ? ROMAN[n] : ROMAN[n].toLowerCase();
  } else {
    text = d.upper ? name : name.toLowerCase();
  }
  return '('.repeat(d.wrap) + text + ')'.repeat(d.wrap);
}
