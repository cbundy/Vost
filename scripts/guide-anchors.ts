/**
 * The guide's heading anchors, shared by scripts/guide.test.ts (which checks every `#anchor` link) and
 * scripts/docs/render.ts (which writes the heading ids), so the two cannot drift.
 */

/** The markdown with fenced code blocks blanked out, so links and headings inside them are ignored. */
export function stripFences(md: string): string {
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
    .replace(/[`*~]/g, '')
    .replace(/(^|[^\p{L}\p{N}_])_+([^_]+?)_+(?![\p{L}\p{N}_])/gu, '$1$2')
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/ /g, '-');
}

/** Makes the ids of one page's headings in order: a repeated heading gets -1, -2, ... like GitHub. */
export function headingIds(): (heading: string) => string {
  const seen = new Map<string, number>();
  return (heading) => {
    const base = slugify(heading);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

/** The anchors a page offers: one per heading. */
export function anchorsOf(md: string): Set<string> {
  const idOf = headingIds();
  const out = new Set<string>();
  for (const line of stripFences(md).split('\n')) {
    const m = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.add(idOf(m[1]));
  }
  return out;
}
