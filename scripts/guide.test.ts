/**
 * Keeps the user guide (docs/guide/) honest: every page is indexed, every relative link, image and anchor in it
 * resolves, and every release's highlights point into the guide. The checks are pure functions over file contents
 * (a `Tree`), so the tests below can prove each one against in-memory fixtures; the last block runs them on the repo.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const GUIDE_DIR = 'docs/guide';
const GUIDE_URL_BASE = 'https://github.com/cbundy/Vost/blob';
/** Release notes at or above this version must link every highlight into the guide; older notes are history. */
export const FIRST_CHECKED_VERSION = '0.11.0';
/** A highlight bullet with exactly this title is not user-facing and needs no guide link. */
export const EXEMPT_TITLE = 'Under the hood';

/** Repo files by repo-relative posix path. `read` returns undefined for a file that does not exist. */
export interface Tree {
  exists(p: string): boolean;
  read(p: string): string | undefined;
}

export function memoryTree(files: Record<string, string>): Tree {
  return { exists: (p) => p in files, read: (p) => files[p] };
}

function diskTree(): Tree {
  return {
    exists: (p) => existsSync(path.join(ROOT, p)),
    read: (p) => (existsSync(path.join(ROOT, p)) ? readFileSync(path.join(ROOT, p), 'utf8') : undefined),
  };
}

/** The markdown with fenced code blocks blanked out, so links and headings inside them are ignored. */
function stripFences(md: string): string {
  let fence: string | null = null;
  return md
    .split('\n')
    .map((line) => {
      const m = /^\s*(`{3,}|~{3,})/.exec(line);
      if (m) {
        if (fence === null) fence = m[1][0];
        else if (m[1][0] === fence) fence = null;
        return '';
      }
      return fence === null ? line : '';
    })
    .join('\n');
}

/** GitHub's heading slug: inline markup dropped, lower-case, punctuation dropped, spaces to hyphens. */
export function slugify(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/ /g, '-');
}

/** The anchors a page offers: one per heading, a repeated heading gets -1, -2, ... like GitHub. */
export function anchorsOf(md: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const line of stripFences(md).split('\n')) {
    const m = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

export interface MdLink {
  target: string;
  image: boolean;
}

export function linksOf(md: string): MdLink[] {
  const out: MdLink[] = [];
  const re = /(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  for (const m of stripFences(md).matchAll(re)) out.push({ target: m[2], image: m[1] === '!' });
  return out;
}

const isExternal = (t: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//');

/** Problems with the relative links, images and anchors of one markdown file (empty when all resolve). */
export function checkLinks(file: string, tree: Tree): string[] {
  const md = tree.read(file);
  if (md === undefined) return [`${file}: the file does not exist`];
  const problems: string[] = [];
  for (const { target, image } of linksOf(md)) {
    if (isExternal(target)) continue;
    const hash = target.indexOf('#');
    const rel = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? '' : decodeURIComponent(target.slice(hash + 1));
    const what = image ? 'image' : 'link';
    const dest = rel === '' ? file : path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(rel)));
    if (!tree.exists(dest)) {
      problems.push(`${file}: ${what} "${target}" points to ${dest}, which does not exist`);
      continue;
    }
    if (anchor === '' || image) continue;
    const destMd = dest.endsWith('.md') ? tree.read(dest) : undefined;
    if (destMd === undefined) continue;
    if (!anchorsOf(destMd).has(anchor.toLowerCase())) {
      problems.push(`${file}: link "${target}" has no matching heading: ${dest} has no heading with the anchor #${anchor}`);
    }
  }
  return problems;
}

/** Problems with the index: a listed page that is missing, or a page that the index does not list. */
export function checkIndex(pages: string[], tree: Tree): string[] {
  const index = `${GUIDE_DIR}/README.md`;
  const md = tree.read(index);
  if (md === undefined) return [`${index}: the guide index does not exist`];
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const { target, image } of linksOf(md)) {
    if (image || isExternal(target)) continue;
    const rel = target.split('#')[0];
    if (!rel.endsWith('.md')) continue;
    const dest = path.posix.normalize(path.posix.join(GUIDE_DIR, rel));
    if (path.posix.dirname(dest) !== GUIDE_DIR || dest === index) continue;
    listed.add(dest);
    if (!tree.exists(dest)) problems.push(`${index}: lists ${dest}, which does not exist`);
  }
  for (const page of pages) {
    if (page !== index && !listed.has(page)) problems.push(`${page}: is not listed in ${index}`);
  }
  return problems;
}

const versionParts = (v: string): number[] => v.split('.').map(Number);
export function versionAtLeast(v: string, min: string): boolean {
  const a = versionParts(v);
  const b = versionParts(min);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/** The top-level `- **Title**` bullets under `## Highlights`, each with its full text. */
export function highlightBullets(md: string): { title: string; text: string }[] {
  const lines = stripFences(md).split('\n');
  const start = lines.findIndex((l) => /^##\s+Highlights\s*$/.test(l));
  if (start === -1) return [];
  const bullets: { title: string; text: string }[] = [];
  let current: { title: string; text: string } | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const m = /^- \*\*(.+?)\*\*/.exec(line);
    if (m) {
      current = { title: m[1].replace(/[:.]$/, ''), text: line };
      bullets.push(current);
    } else if (/^- /.test(line)) {
      current = null;
    } else if (current) {
      current.text += `\n${line}`;
    }
  }
  return bullets;
}

/** Problems with the guide links of one release-notes file (empty for notes below the first checked version). */
export function checkReleaseNotes(file: string, tree: Tree, minVersion = FIRST_CHECKED_VERSION): string[] {
  const name = /^(?:.*\/)?v(\d+\.\d+\.\d+)\.md$/.exec(file);
  if (!name) return [];
  const version = name[1];
  if (!versionAtLeast(version, minVersion)) return [];
  const md = tree.read(file);
  if (md === undefined) return [`${file}: the file does not exist`];
  const problems: string[] = [];
  const linkRe = new RegExp(`${GUIDE_URL_BASE.replace(/[.]/g, '\\.')}/(v[^/\\s)]+)/docs/guide/([^\\s)#]+)(#[^\\s)]*)?`, 'g');
  for (const { title, text } of highlightBullets(md)) {
    if (title === EXEMPT_TITLE) continue;
    const who = `${file}: highlight "${title}"`;
    const candidates = [...text.matchAll(linkRe)];
    if (candidates.length === 0) {
      problems.push(`${who} has no link to the guide (expected ${GUIDE_URL_BASE}/v${version}/${GUIDE_DIR}/<page>.md)`);
      continue;
    }
    const bad: string[] = [];
    let ok = false;
    for (const m of candidates) {
      const [url, tag, page, hash] = m;
      const pagePath = `${GUIDE_DIR}/${page}`;
      if (tag !== `v${version}`) {
        bad.push(`links ${url}, pinned to ${tag} instead of v${version}`);
      } else if (!/^[a-z0-9-]+\.md$/.test(page) || !tree.exists(pagePath)) {
        bad.push(`links ${url}, but ${pagePath} does not exist`);
      } else if (hash && !anchorsOf(tree.read(pagePath) ?? '').has(decodeURIComponent(hash.slice(1)).toLowerCase())) {
        bad.push(`links ${url}, but ${pagePath} has no heading with the anchor ${hash}`);
      } else {
        ok = true;
      }
    }
    if (!ok) for (const b of bad) problems.push(`${who} ${b}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------

const tree = (files: Record<string, string>) => memoryTree(files);
const INDEX = `${GUIDE_DIR}/README.md`;

describe('slugify and anchorsOf', () => {
  it('follows GitHub heading slug rules', () => {
    expect(slugify('Sync in layout')).toBe('sync-in-layout');
    expect(slugify('Ctrl/Cmd+S, and `.`')).toBe('ctrlcmds-and-');
    expect(slugify('The *Build* [setting](x.md)')).toBe('the-build-setting');
  });
  it('numbers a repeated heading and ignores headings inside code fences', () => {
    const a = anchorsOf('# One\n\n## Same\n\n## Same\n\n```\n# not a heading\n```\n');
    expect([...a]).toEqual(['one', 'same', 'same-1']);
  });
});

describe('checkIndex', () => {
  const ok = tree({ [INDEX]: '- [A](a.md) - x\n- [B](b.md#top) - y\n', [`${GUIDE_DIR}/a.md`]: '# A', [`${GUIDE_DIR}/b.md`]: '# Top' });
  it('passes when every page is listed and every listed page exists', () => {
    expect(checkIndex([INDEX, `${GUIDE_DIR}/a.md`, `${GUIDE_DIR}/b.md`], ok)).toEqual([]);
  });
  it('names a page the index does not list', () => {
    const t = tree({ [INDEX]: '- [A](a.md)\n', [`${GUIDE_DIR}/a.md`]: '# A', [`${GUIDE_DIR}/extra.md`]: '# E' });
    expect(checkIndex([INDEX, `${GUIDE_DIR}/a.md`, `${GUIDE_DIR}/extra.md`], t)).toEqual([
      `${GUIDE_DIR}/extra.md: is not listed in ${INDEX}`,
    ]);
  });
  it('names a listed page that is missing', () => {
    const t = tree({ [INDEX]: '- [A](a.md)\n- [Gone](gone.md)\n', [`${GUIDE_DIR}/a.md`]: '# A' });
    expect(checkIndex([INDEX, `${GUIDE_DIR}/a.md`], t)).toEqual([`${INDEX}: lists ${GUIDE_DIR}/gone.md, which does not exist`]);
  });
});

describe('checkLinks', () => {
  const page = `${GUIDE_DIR}/a.md`;
  const base = { [`${GUIDE_DIR}/b.md`]: '# B\n\n## Some part\n', 'docs/evidence/x/shot.png': 'png' };
  it('passes for existing pages, images and anchors, and ignores external links and code fences', () => {
    const md = '[b](b.md#some-part) ![s](../evidence/x/shot.png) [web](https://example.com/nope.md#x) [self](#mine)\n\n# Mine\n\n```\n[x](missing.md)\n```\n';
    expect(checkLinks(page, tree({ ...base, [page]: md }))).toEqual([]);
  });
  it('names a broken relative image', () => {
    const t = tree({ ...base, [page]: '![s](../evidence/x/gone.png)' });
    expect(checkLinks(page, t)).toEqual([`${page}: image "../evidence/x/gone.png" points to docs/evidence/x/gone.png, which does not exist`]);
  });
  it('names a link to a missing file', () => {
    const t = tree({ ...base, [page]: '[c](c.md)' });
    expect(checkLinks(page, t)).toEqual([`${page}: link "c.md" points to ${GUIDE_DIR}/c.md, which does not exist`]);
  });
  it('names a bad anchor, in another page and in the same page', () => {
    const t = tree({ ...base, [page]: '[b](b.md#nope)\n\n[me](#nowhere)\n\n# Here\n' });
    expect(checkLinks(page, t)).toEqual([
      `${page}: link "b.md#nope" has no matching heading: ${GUIDE_DIR}/b.md has no heading with the anchor #nope`,
      `${page}: link "#nowhere" has no matching heading: ${page} has no heading with the anchor #nowhere`,
    ]);
  });
});

describe('checkReleaseNotes', () => {
  const notes = 'release-notes/v0.11.0.md';
  const pages = { [`${GUIDE_DIR}/layouts.md`]: '# Layouts\n\n## Sync in layout\n' };
  const url = (v: string, page: string, hash = '') => `${GUIDE_URL_BASE}/v${v}/${GUIDE_DIR}/${page}${hash}`;
  const withHighlights = (body: string) => `Intro.\n\n## Highlights\n\n${body}\n\n## Changes\n\n- Something (#1)\n`;
  const run = (body: string) => checkReleaseNotes(notes, tree({ ...pages, [notes]: withHighlights(body) }));

  it('passes for highlights that link existing pages and anchors, and exempts Under the hood', () => {
    const body = [
      `- **Layouts**: text. [Guide](${url('0.11.0', 'layouts.md')})`,
      `- **Sync**: text spanning`,
      `  two lines. [Guide](${url('0.11.0', 'layouts.md', '#sync-in-layout')})`,
      '- **Under the hood**: no user-facing change.',
    ].join('\n');
    expect(run(body)).toEqual([]);
  });
  it('names a highlight without a guide link', () => {
    expect(run('- **Layouts**: text with no link.')).toEqual([
      `${notes}: highlight "Layouts" has no link to the guide (expected ${GUIDE_URL_BASE}/v0.11.0/${GUIDE_DIR}/<page>.md)`,
    ]);
  });
  it('names a link pinned to the wrong version', () => {
    const u = url('0.10.0', 'layouts.md');
    expect(run(`- **Layouts**: text. ${u}`)).toEqual([`${notes}: highlight "Layouts" links ${u}, pinned to v0.10.0 instead of v0.11.0`]);
  });
  it('names a link to a missing page and to a missing anchor', () => {
    const gone = url('0.11.0', 'gone.md');
    const anchor = url('0.11.0', 'layouts.md', '#nope');
    expect(run(`- **A**: ${gone}\n- **B**: ${anchor}`)).toEqual([
      `${notes}: highlight "A" links ${gone}, but ${GUIDE_DIR}/gone.md does not exist`,
      `${notes}: highlight "B" links ${anchor}, but ${GUIDE_DIR}/layouts.md has no heading with the anchor #nope`,
    ]);
  });
  it('does not accept the exempt title with another spelling or a bullet that only mentions the guide', () => {
    expect(run('- **Under the hood changes**: text')).toHaveLength(1);
  });
  it('skips notes below the first checked version', () => {
    const old = 'release-notes/v0.10.0.md';
    expect(checkReleaseNotes(old, tree({ [old]: withHighlights('- **Old**: no link') }))).toEqual([]);
  });
});

describe('the repo', () => {
  const disk = diskTree();
  const guideDir = path.join(ROOT, GUIDE_DIR);
  const pages = existsSync(guideDir)
    ? readdirSync(guideDir).filter((f) => f.endsWith('.md')).sort().map((f) => `${GUIDE_DIR}/${f}`)
    : [];
  const notesDir = path.join(ROOT, 'release-notes');
  const notes = existsSync(notesDir) ? readdirSync(notesDir).filter((f) => /^v\d+\.\d+\.\d+\.md$/.test(f)).map((f) => `release-notes/${f}`) : [];

  it('has a guide index and pages', () => {
    expect(disk.exists(INDEX)).toBe(true);
    expect(pages.length).toBeGreaterThan(1);
  });
  it('indexes every guide page and lists no missing one', () => {
    expect(checkIndex(pages, disk)).toEqual([]);
  });
  it('has no broken relative link, image or anchor in the guide', () => {
    expect(pages.flatMap((p) => checkLinks(p, disk))).toEqual([]);
  });
  it('links every highlight of release notes from the first checked version into the guide', () => {
    expect(notes.flatMap((n) => checkReleaseNotes(n, disk))).toEqual([]);
  });
});
