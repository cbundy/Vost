import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

describe('dev container Playwright pin', () => {
  it('installs the same playwright version package.json pins', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    const pinned = pkg.devDependencies.playwright;
    const m = /playwright@(\S+)/.exec(read('.devcontainer/Dockerfile'));
    expect(m, '.devcontainer/Dockerfile has no playwright@<version> pin').not.toBeNull();
    expect(
      m![1],
      `.devcontainer/Dockerfile pins playwright@${m![1]} but package.json pins ${pinned}`,
    ).toBe(pinned);
  });
});
