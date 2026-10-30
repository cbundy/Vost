import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RERUN = 'timeout 180 npx vite-node docs/spikes/pine-coverage/probe.ts > docs/spikes/pine-coverage/output.txt';

/** The PineTS version named in the first line of the probe output ("PineTS 0.13.0 - ..."), or null. */
export function outputVersion(firstLine: string): string | null {
  return /^PineTS (\d+\.\d+\.\d+\S*)/.exec(firstLine)?.[1] ?? null;
}

/** null when the probe output was made with the installed engine, otherwise the message to show. */
export function coverageStale(installed: string, firstLine: string): string | null {
  const probed = outputVersion(firstLine);
  if (probed === installed) return null;
  const found = probed ? `was produced with PineTS ${probed}` : 'names no PineTS version in its first line';
  return `docs/spikes/pine-coverage/output.txt ${found}, but PineTS ${installed} is installed. Rerun the probe and commit the result: ${RERUN}`;
}

describe('coverageStale', () => {
  it('passes when the versions match', () => {
    expect(coverageStale('0.13.0', 'PineTS 0.13.0 - Pine v6 coverage probe: 160 cases')).toBeNull();
  });
  it('fails with both versions and the rerun command when they differ', () => {
    const msg = coverageStale('0.14.0', 'PineTS 0.13.0 - Pine v6 coverage probe: 160 cases');
    expect(msg).toContain('0.13.0');
    expect(msg).toContain('0.14.0');
    expect(msg).toContain(RERUN);
  });
  it('fails when the header has no version', () => {
    const msg = coverageStale('0.13.0', 'Pine v6 coverage probe: 161 cases');
    expect(msg).toContain('no PineTS version');
    expect(msg).toContain(RERUN);
  });
});

describe('pine coverage probe output', () => {
  it('was produced with the installed PineTS', () => {
    const installed = JSON.parse(readFileSync('node_modules/pinets/package.json', 'utf8')).version as string;
    const first = readFileSync('docs/spikes/pine-coverage/output.txt', 'utf8').split('\n')[0];
    expect(coverageStale(installed, first)).toBeNull();
  });
});
