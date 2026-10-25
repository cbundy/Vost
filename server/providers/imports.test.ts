import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|mjs)$/.test(name) && !/\.test\.ts$/.test(name) && name !== 'testing.ts' ? [p] : [];
  });
}

/** Module specifiers of `import ... from 'x'`, `export ... from 'x'` and `import('x')`. */
function specifiers(src: string): string[] {
  return [...src.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}

describe('server sources', () => {
  const files = [...sources(SERVER), ...sources(path.resolve(SERVER, '..', 'shared'))];
  it('finds the server files', () => {
    expect(files.length).toBeGreaterThan(10);
  });
  it('import only node: built-ins and relative server/ or shared/ files, so the Docker runtime needs no node_modules', () => {
    const bad: string[] = [];
    for (const file of files) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('node:')) continue;
        if (spec.startsWith('.')) {
          const target = path.resolve(path.dirname(file), spec);
          const inServer = target.startsWith(SERVER + path.sep);
          const inShared = target.startsWith(path.resolve(SERVER, '..', 'shared') + path.sep);
          if ((inServer || inShared) && /\.(ts|mjs)$/.test(spec)) continue;
        }
        bad.push(`${path.relative(SERVER, file)}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('the check itself catches a package or client import', () => {
    expect(specifiers("import x from 'papaparse';\nimport { a } from '../client/src/x.ts';\nconst m = await import('zod');")).toEqual(['papaparse', '../client/src/x.ts', 'zod']);
  });
});
