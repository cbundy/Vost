/**
 * Nothing but the one-time migration in client/src/lib/storage.ts may touch browser storage, and the capture
 * harness may do so only in the server-settings scenario (which seeds the old browser data to prove the migration).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const TOUCH = /\b(localStorage|sessionStorage)\b/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');

export function offenders(files: string[], read: (f: string) => string, allowed: (f: string) => boolean): string[] {
  return files.filter((f) => !allowed(f) && TOUCH.test(read(f)));
}

describe('browser storage', () => {
  const code = (f: string) => /\.(ts|tsx)$/.test(f);
  // the unit tests fake the browser to exercise the migration and are not shipped
  const shipped = (f: string) => code(f) && !/\.test\.tsx?$/.test(f);

  it('client/src touches it only in the migration in lib/storage.ts', () => {
    const files = walk(path.join(ROOT, 'client/src')).filter(shipped);
    expect(offenders(files, (f) => readFileSync(f, 'utf8'), (f) => rel(f) === 'client/src/lib/storage.ts').map(rel)).toEqual([]);
  });

  it('e2e/capture touches it only in the server-settings scenario', () => {
    const files = walk(path.join(ROOT, 'e2e/capture')).filter(code);
    expect(offenders(files, (f) => readFileSync(f, 'utf8'), (f) => rel(f) === 'e2e/capture/scenarios/server-settings.ts').map(rel)).toEqual([]);
  });

  it('the scan finds a file that touches it (fixture)', () => {
    const fake: Record<string, string> = { a: 'localStorage.getItem("x")', b: 'sessionStorage.x', c: 'const ok = 1', d: 'localStorage' };
    expect(offenders(Object.keys(fake), (f) => fake[f], (f) => f === 'd')).toEqual(['a', 'b']);
  });
});
