import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_CSS_VARS, theme } from './theme';

const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

function token(name: string): string | undefined {
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(rootBlock)?.[1]?.toLowerCase();
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('theme.ts', () => {
  it('has a :root block to compare against', () => {
    expect(rootBlock).toContain('--bg:');
  });

  for (const [key, cssVar] of Object.entries(THEME_CSS_VARS)) {
    it(`${key} equals ${cssVar} in styles.css`, () => {
      expect(token(cssVar)).toBe(theme[key as keyof typeof theme].toLowerCase());
    });
  }

  it('keeps the old palette out of the stylesheet', () => {
    for (const old of ['0b0e14', '0f1320', '11151f', '161b28', '1e2433', '2a3348', '8b94a7', '303a52']) {
      expect(css.toLowerCase()).not.toContain(old);
    }
  });

  it('contrast helper is right (black on white is 21:1)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  for (const bg of ['bg', 'panel'] as const) {
    it(`body text on ${bg} is at least 4.5:1`, () => {
      expect(contrast(theme.text, theme[bg])).toBeGreaterThanOrEqual(4.5);
    });
    it(`muted labels on ${bg} are at least 3:1`, () => {
      expect(contrast(theme.muted, theme[bg])).toBeGreaterThanOrEqual(3);
      expect(contrast(theme.muted2, theme[bg])).toBeGreaterThanOrEqual(3);
    });
  }
});
