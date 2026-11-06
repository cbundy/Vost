/** Keeps the strategy maker apart from the rest of Vost (see docs/guide/strategy-maker.md). */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const FOLDER = path.join(SRC, 'strategyMaker');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const isCode = (f: string) => /\.(ts|tsx)$/.test(f);
const importsOf = (src: string): string[] =>
  [...src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((m) => m[1]);
const resolveFrom = (file: string, spec: string) => path.resolve(path.dirname(file), spec);

export function outsideImportsFolder(file: string, src: string): string[] {
  return importsOf(src).filter((s) => s.startsWith('.') && (resolveFrom(file, s) + path.sep).startsWith(FOLDER + path.sep));
}
export function folderForbiddenImports(file: string, src: string): string[] {
  return importsOf(src).filter((s) => {
    if (!s.startsWith('.')) return false;
    const r = resolveFrom(file, s);
    return r === path.join(SRC, 'App') || r.startsWith(path.join(SRC, 'state')) || r.startsWith(path.join(SRC, 'components'));
  });
}
export const WRITES = /\b(saveJson|removeKey)\b|localStorage\s*\.\s*(setItem|removeItem|clear)/;

describe('strategy maker boundary', () => {
  const all = walk(SRC).filter(isCode);
  // this test file holds violating strings as fixtures, so it is the one file not scanned
  const inside = all.filter((f) => f.startsWith(FOLDER + path.sep) && !f.endsWith('boundary.test.ts'));
  const outside = all.filter((f) => !f.startsWith(FOLDER + path.sep));

  it('nothing outside the folder imports it, except the one dynamic import in startup.tsx and the one in lib/benchmarkRunners.ts', () => {
    const bad = outside.flatMap((f) => {
      const hits = outsideImportsFolder(f, readFileSync(f, 'utf8'));
      // The two places that load the folder on demand: the page itself and the Settings benchmark's find and market search.
      if (['startup.tsx', path.join('lib', 'benchmarkRunners.ts')].includes(path.relative(SRC, f))) {
        const src = readFileSync(f, 'utf8');
        const dyn = hits.filter((h) => src.includes(`import('${h}')`));
        const rest = hits.filter((h) => !dyn.includes(h));
        return dyn.length === 1 ? rest.map((h) => `${f}: ${h}`) : [`${f}: expected exactly one dynamic import`];
      }
      return hits.map((h) => `${f}: ${h}`);
    });
    expect(bad).toEqual([]);
  });
  it('the folder imports no store, App or component', () => {
    expect(inside.flatMap((f) => folderForbiddenImports(f, readFileSync(f, 'utf8')).map((h) => `${f}: ${h}`))).toEqual([]);
  });
  it('the folder never writes localStorage', () => {
    const bad = inside.filter((f) => WRITES.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('the hand-off format imports nothing from the folder, state, components or App', () => {
    const file = path.join(SRC, 'lib', 'backtestHandoff.ts');
    const src = readFileSync(file, 'utf8');
    expect(outsideImportsFolder(file, src)).toEqual([]);
    expect(folderForbiddenImports(file, src)).toEqual([]);
  });

  it('the checks catch violations (fixtures)', () => {
    const f = path.join(SRC, 'lib', 'x.ts');
    expect(outsideImportsFolder(f, `import('../strategyMaker/StrategyMakerPage')`)).toHaveLength(1);
    expect(outsideImportsFolder(f, `import a from './other'`)).toEqual([]);
    const g = path.join(FOLDER, 'x.ts');
    expect(folderForbiddenImports(g, `import { useStore } from '../state/store'`)).toHaveLength(1);
    expect(folderForbiddenImports(g, `import App from '../App'`)).toHaveLength(1);
    expect(folderForbiddenImports(g, `import { A } from '../components/A'`)).toHaveLength(1);
    expect(folderForbiddenImports(g, `import { loadJson } from '../lib/storage'`)).toEqual([]);
    for (const s of ['saveJson(a,b)', 'removeKey(a)', 'localStorage.setItem(a,b)', 'localStorage.removeItem(a)']) expect(WRITES.test(s)).toBe(true);
    expect(WRITES.test('localStorage.getItem(a)')).toBe(false);
  });
});
