// Release milestones, following `callum-flow-milestone --help` (the contract is defined there):
// open milestones titled exactly `Next release` and `Later`, looked up by exact title among open ones.
// Plain ESM, no dependencies. The helpers are pure; the CLI calls `gh api`.
//   node scripts/release-milestones.mjs ensure
//   node scripts/release-milestones.mjs roll vX.Y.Z
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const NEXT = 'Next release';
export const LATER = 'Later';

/** The open milestone with exactly this title, or undefined. */
export function findOpen(milestones, title) {
  return milestones.find((m) => m.state === 'open' && m.title === title);
}

/** Titles of the contract milestones that have no open milestone yet. */
export function planEnsure(milestones) {
  return [NEXT, LATER].filter((title) => !findOpen(milestones, title));
}

/** The PATCH that renames the open `Next release` to the tag and closes it, or null. */
export function planRoll(milestones, tag) {
  const next = findOpen(milestones, NEXT);
  return next ? { number: next.number, title: tag, state: 'closed' } : null;
}

function gh(args, fields = {}) {
  const extra = Object.entries(fields).flatMap(([k, v]) => ['-f', `${k}=${v}`]);
  return execFileSync('gh', ['api', ...args, ...extra], { encoding: 'utf8' });
}

function listOpen(repo) {
  return JSON.parse(gh([`repos/${repo}/milestones?state=open&per_page=100`, '--paginate', '--slurp'])).flat();
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY ?? process.env.CALLUM_FLOW_REPO;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const [cmd, tag] = process.argv.slice(2);
  if (cmd === 'ensure') {
    for (const title of planEnsure(listOpen(repo))) {
      gh(['-X', 'POST', `repos/${repo}/milestones`], { title });
      console.log(`created milestone ${title}`);
    }
  } else if (cmd === 'roll' && tag) {
    const plan = planRoll(listOpen(repo), tag);
    if (!plan) return console.log(`no open "${NEXT}" milestone, nothing to roll`);
    gh(['-X', 'PATCH', `repos/${repo}/milestones/${plan.number}`], { title: plan.title, state: plan.state });
    console.log(`renamed "${NEXT}" to ${tag} and closed it`);
  } else {
    console.error('usage: release-milestones.mjs ensure | roll vX.Y.Z');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
