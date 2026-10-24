import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { findOpen, planEnsure, planRoll } from './release-milestones.mjs';

const ms = (title: string, state = 'open', number = 1) => ({ title, state, number });

describe('release milestones', () => {
  it('creates both when missing', () => {
    expect(planEnsure([])).toEqual(['Next release', 'Later']);
  });
  it('creates nothing when both are open', () => {
    expect(planEnsure([ms('Next release', 'open', 1), ms('Later', 'open', 2)])).toEqual([]);
  });
  it('ignores a closed Next release and creates a new one', () => {
    expect(planEnsure([ms('Next release', 'closed'), ms('Later', 'open', 2)])).toEqual(['Next release']);
  });
  it('finds by exact title only', () => {
    expect(findOpen([ms('next release'), ms('Next release 2')], 'Next release')).toBeUndefined();
  });
  it('rolls the open Next release: rename and close', () => {
    const list = [ms('Next release', 'closed', 3), ms('Next release', 'open', 4), ms('Later', 'open', 5)];
    expect(planRoll(list, 'v0.2.0')).toEqual({ number: 4, title: 'v0.2.0', state: 'closed' });
  });
  it('rolls nothing when no open Next release exists', () => {
    expect(planRoll([ms('Later')], 'v0.2.0')).toBeNull();
  });
});
