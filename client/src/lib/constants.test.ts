import { describe, expect, it } from 'vitest';
import { PROVIDER_GITHUB_URL } from './constants';

describe('constants', () => {
  it('points the GitHub link at the cbundy/Vost repository', () => {
    expect(PROVIDER_GITHUB_URL).toBe('https://github.com/cbundy/Vost');
  });
});
