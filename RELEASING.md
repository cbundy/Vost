# Releasing Vost

This is the release agent's runbook. The judge decides when to release; ordinary PRs never bump the
version. `CHANGELOG.md` is not used: the release notes are the changelog.

## Versioning

The version is written in one place, `package.json` `version` (plus `package-lock.json`, which
`npm version` keeps in step). The server, `/api/health`, the top bar and the Docker image all read it.
`client/src/lib/version.test.ts` fails when they disagree.

While the version is 0.x:

- **patch** - fixes and docs-only changes.
- **minor** - features, and anything that breaks saved browser data, the API or deploy config. The
  release notes must flag such a break.

The first release is v0.2.0. 0.1.0 is the untagged import the fork started from.

## Steps

1. Branch `release/vX.Y.Z` from `origin/main`.
2. `npm version X.Y.Z --no-git-tag-version`.
3. Write `release-notes/vX.Y.Z.md`: user-facing highlights, then a `## Changes` list of the PRs merged
   since the last tag, from `git log --first-parent <last-tag>..origin/main` (from the root commit for
   the first release).
4. Open the bump PR and merge it once CI is green.
5. Confirm that the Release workflow tagged and published the release. When it failed, fix the cause and
   re-run it with `workflow_dispatch` (Actions, Release, Run workflow); a re-run on an already tagged
   commit resumes and rewrites the release safely.

`release-notes/` holds one `vX.Y.Z.md` per released version. Add the file only in the bump PR, never
for a version not yet released. Once any notes file exists, the version test requires the notes of the
current version.

## What the Release workflow does

`.github/workflows/release.yml` runs on every push to main and on `workflow_dispatch`.
`scripts/release-check.mjs` decides; a push whose `package.json` version equals the first parent's is
skipped (a dependency-only change never fails it). When it releases, the workflow waits for the `ci`
run of the same commit, tags `vX.Y.Z`, creates (or edits) the GitHub release from the notes file, and
renames and closes the open `Next release` milestone to the tag. On every run it then makes sure open
milestones titled exactly `Next release` and `Later` exist (`scripts/release-milestones.mjs`; the
contract is defined by `callum-flow-milestone --help`).

A release created with `GITHUB_TOKEN` does not trigger other workflows, so anything that publishes on
release (for example a future container image publish) must run as a job inside `release.yml` (or through
`workflow_call`), not on `on: release`.

## Docker images

Releases publish no registry image. Users build the Docker image from source at the release tag
(`git checkout vX.Y.Z`, then `docker compose up -d --build`), as `README.md` and `docs/DEPLOYMENT.md`
describe. Publishing an image is possible future work, not a release step.
