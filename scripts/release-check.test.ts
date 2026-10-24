import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { decide } from './release-check.mjs';

const base = {
  version: '0.2.0',
  previousVersion: '0.1.0',
  event: 'push',
  tagCommit: null,
  headCommit: 'abc',
  notesExists: true,
};

describe('release-check decide', () => {
  it('releases a changed version with notes and no tag', () => {
    expect(decide(base)).toBe('release');
  });
  it('skips a push whose version is unchanged (even when not semver)', () => {
    expect(decide({ ...base, previousVersion: '0.2.0' })).toBe('skip: version unchanged');
    expect(decide({ ...base, version: 'x', previousVersion: 'x' })).toBe('skip: version unchanged');
  });
  it('treats a push with no first parent as changed', () => {
    expect(decide({ ...base, previousVersion: null })).toBe('release');
  });
  it('skips when the tag is already on this commit', () => {
    expect(decide({ ...base, tagCommit: 'abc' })).toBe('skip: already released');
  });
  it('fails when the tag is on another commit', () => {
    expect(decide({ ...base, tagCommit: 'def' })).toBe('fail: tag on another commit');
  });
  it('fails when the version is not plain X.Y.Z', () => {
    expect(decide({ ...base, version: '0.2' })).toBe('fail: not semver');
    expect(decide({ ...base, version: '0.2.0-rc.1' })).toBe('fail: not semver');
  });
  it('fails when the release notes are missing', () => {
    expect(decide({ ...base, notesExists: false })).toBe('fail: release notes missing');
  });
  it('workflow_dispatch with the version unchanged still releases', () => {
    expect(decide({ ...base, event: 'workflow_dispatch', previousVersion: '0.2.0' })).toBe('release');
  });
  it('workflow_dispatch on a tagged commit resumes the release', () => {
    expect(decide({ ...base, event: 'workflow_dispatch', tagCommit: 'abc' })).toBe('release');
  });
});
