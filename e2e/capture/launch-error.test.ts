import { describe, expect, it } from 'vitest';
import { formatLaunchError } from './launch-error.ts';

const lib = (n: string) =>
  `[pid=7][err] /home/node/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell: error while loading shared libraries: ${n}: cannot open shared object file: No such file or directory`;

describe('formatLaunchError', () => {
  it('names a missing library once and points at the rebuild', () => {
    const msg = [
      'browserType.launch: Target page, context or browser has been closed',
      'Browser logs:',
      '',
      '<launching> /x/chrome-headless-shell --headless',
      '<launched> pid=7',
      lib('libnspr4.so'),
      'Call log:',
      `\u001b[2m  - ${lib('libnspr4.so')}\u001b[22m`,
    ].join('\n');
    const out = formatLaunchError(msg);
    expect(out.match(/libnspr4\.so/g)).toHaveLength(1);
    expect(out).toContain('Rebuild the dev container');
    expect(out).toContain('npx playwright install --with-deps chromium');
  });

  it('names two different libraries once each', () => {
    const out = formatLaunchError(['x', lib('libnspr4.so'), lib('libnss3.so'), lib('libnspr4.so')].join('\n'));
    expect(out.match(/libnspr4\.so/g)).toHaveLength(1);
    expect(out.match(/libnss3\.so/g)).toHaveLength(1);
  });

  it('keeps the install hint for a missing executable', () => {
    const out = formatLaunchError("browserType.launch: Executable doesn't exist at /a/b\nlooks like...");
    expect(out).toContain('npx playwright install chromium');
    expect(out).not.toContain('Rebuild');
  });

  it('gives the first line and the first [err] line otherwise, without ANSI', () => {
    const out = formatLaunchError('boom\u001b[2m!\u001b[22m\nBrowser logs:\n[pid=1][err] \u001b[31msomething bad\u001b[39m\n[pid=1][err] later');
    expect(out).toBe('boom!\n[pid=1][err] something bad');
    expect(out).not.toContain('\u001b');
  });

  it('gives just the first line when there is no [err] line', () => {
    expect(formatLaunchError('plain\nmore')).toBe('plain');
  });
});
