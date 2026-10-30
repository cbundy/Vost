import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const ignored = (p: string) =>
  spawnSync('git', ['check-ignore', '--no-index', '-q', p], { cwd: fileURLToPath(root) }).status === 0;

describe('core dump ignore rules', () => {
  it.each(['core', 'core.1', 'core.12345'])('git ignores %s in the repo root', (p) => {
    expect(ignored(p)).toBe(true);
  });
  it.each(['src/core/index.ts', 'client/src/core/x.ts', 'server/core.ts'])('git keeps %s tracked', (p) => {
    expect(ignored(p)).toBe(false);
  });
  it('.dockerignore excludes core dumps from the build context', () => {
    const lines = readFileSync(new URL('.dockerignore', root), 'utf8').split('\n');
    expect(lines).toContain('core');
    expect(lines).toContain('core.[0-9]*');
  });
});
