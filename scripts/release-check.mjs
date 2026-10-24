// Decides whether a push to main or a manual run should publish a release.
// Plain ESM, no dependencies. `decide` is pure; the CLI gathers the facts from git.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * @param {{ version: string, previousVersion?: string|null, event: string,
 *   tagCommit?: string|null, headCommit: string, notesExists: boolean }} f
 * @returns {string} 'release' or '<skip|fail>: <reason>'
 */
export function decide({ version, previousVersion, event, tagCommit, headCommit, notesExists }) {
  if (event === 'push' && previousVersion != null && previousVersion === version) {
    return 'skip: version unchanged';
  }
  if (!SEMVER.test(String(version))) return 'fail: not semver';
  if (tagCommit && tagCommit !== headCommit) return 'fail: tag on another commit';
  // A manual run on a tagged commit resumes the release (it may have failed after tagging).
  if (tagCommit && event !== 'workflow_dispatch') return 'skip: already released';
  if (!notesExists) return 'fail: release notes missing';
  return 'release';
}

const REASONS = {
  'skip: version unchanged': 'package.json version is the same as the first parent, nothing to release',
  'skip: already released': 'the release tag is already on this commit',
  'fail: tag on another commit': 'the release tag already exists on a different commit',
  'fail: not semver': 'package.json version is not plain X.Y.Z',
  'fail: release notes missing': 'release-notes/v<version>.md does not exist',
  release: 'version changed and everything is in place, releasing',
};

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function main() {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const prev = git('show', 'HEAD^1:package.json');
  const previousVersion = prev ? JSON.parse(prev).version : null;
  const tag = `v${version}`;
  const result = decide({
    version,
    previousVersion,
    event: process.env.GITHUB_EVENT_NAME ?? 'workflow_dispatch',
    tagCommit: git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`),
    headCommit: git('rev-parse', 'HEAD'),
    notesExists: existsSync(`release-notes/${tag}.md`),
  });
  const reason = REASONS[result];
  console.log(`${result} - ${reason}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `release=${result === 'release'}\nversion=${version}\n`);
  }
  process.exit(result.startsWith('fail') ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
