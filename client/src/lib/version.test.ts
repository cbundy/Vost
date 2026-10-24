import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from './constants';

const ROOT = path.resolve(__dirname, '../../..');
const readJson = (f: string) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));

describe('version', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');

  it('is plain X.Y.Z', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('is the same in package.json, package-lock.json and APP_VERSION', () => {
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
    expect(APP_VERSION).toBe(pkg.version);
  });
  it('has release notes once any release-notes/v*.md exists', () => {
    const dir = path.join(ROOT, 'release-notes');
    const any = existsSync(dir) && readdirSync(dir).some((f) => /^v.*\.md$/.test(f));
    if (any) expect(existsSync(path.join(dir, `v${pkg.version}.md`))).toBe(true);
  });
});
