/**
 * The Vost palette as JS constants for the places CSS variables cannot reach (the chart canvases and the code
 * editor). The values mirror the `:root` tokens in `styles.css`; `theme.test.ts` fails if the two drift apart.
 */
export const theme = {
  bg: '#09090b',
  bg2: '#0d0d10',
  panel: '#111114',
  panel2: '#17171b',
  panel3: '#1d1d22',
  border: '#212126',
  border2: '#2f2f36',
  border3: '#3d3d46',
  text: '#e8e8ed',
  muted: '#9b9ba6',
  muted2: '#71717c',
  accent: '#3b82f6',
  accent2: '#60a5fa',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
} as const;

/** CSS custom property behind each theme key (used by the parity test). */
export const THEME_CSS_VARS: Record<keyof typeof theme, string> = {
  bg: '--bg',
  bg2: '--bg-2',
  panel: '--panel',
  panel2: '--panel-2',
  panel3: '--panel-3',
  border: '--border',
  border2: '--border-2',
  border3: '--border-3',
  text: '--text',
  muted: '--muted',
  muted2: '--muted-2',
  accent: '--accent',
  accent2: '--accent-2',
  green: '--green',
  red: '--red',
  amber: '--amber',
};

/** Candle and equity colours. */
export const UP_COLOR = theme.green;
export const DOWN_COLOR = theme.red;

/** `#rrggbb` to `rgba(r,g,b,a)`. */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Colours for the lightweight-charts canvases. */
export const chartTheme = {
  background: theme.bg,
  text: theme.muted,
  grid: 'rgba(255,255,255,0.035)',
  gridFaint: 'rgba(255,255,255,0.03)',
  crosshair: rgba(theme.muted, 0.45),
  crosshairFaint: rgba(theme.muted, 0.4),
  crosshairLabel: theme.border2,
  scaleBorder: theme.border,
  refLine: rgba(theme.muted, 0.7),
  exit: rgba(theme.muted, 0.9),
  benchmark: theme.text,
} as const;

/** Colours for the Pine code editor. */
export const editorTheme = {
  background: theme.bg2,
  gutterText: theme.muted2,
  tooltip: theme.panel2,
  text: theme.text,
} as const;
