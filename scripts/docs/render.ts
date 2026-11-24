/**
 * Turns the user guide (docs/guide/) and the reference docs it links into the web pages the app serves at /docs.
 * Everything here is pure: it reads files through a `Source` and returns the pages, so the unit tests can run it on
 * fixtures and on the repo, and scripts/docs/build.ts only has to write the result to disk.
 */
import path from 'node:path';
import { Marked } from 'marked';
import type { Tokens } from 'marked';
import { headingIds } from '../guide-anchors.ts';

export const GUIDE_DIR = 'docs/guide';
const INDEX = `${GUIDE_DIR}/README.md`;
const EVIDENCE_DIR = 'docs/evidence';
const GITHUB_BLOB = 'https://github.com/cbundy/Vost/blob';
/** The reference docs the guide links, rendered next to it under /docs/ref/. */
export const REFERENCE_DOCS = ['DATA-SOURCES', 'DEPLOYMENT', 'PINE', 'STRATEGIES', 'third-party-notices'].map((n) => `docs/${n}.md`);

export interface Source {
  exists(p: string): boolean;
  read(p: string): string | undefined;
  /** The names of the files directly inside a repo folder. */
  list(dir: string): string[];
}

export interface Rendered {
  /** Output path under client/dist (for example `docs/index.html`) to the page's HTML. */
  pages: Map<string, string>;
  /** Repo path of each image the pages use to its output path under client/dist (for example `docs/img/chart/x.png`). */
  images: Map<string, string>;
}

interface NavEntry {
  title: string;
  /** Repo path of the markdown file. */
  file: string;
}

/** The URL path a rendered markdown file is served at, or undefined for a file that is not rendered. */
export function pageUrl(file: string): string | undefined {
  if (file === INDEX) return '/docs/';
  if (path.posix.dirname(file) === GUIDE_DIR && file.endsWith('.md')) return `/docs/${path.posix.basename(file, '.md')}.html`;
  if (REFERENCE_DOCS.includes(file)) return `/docs/ref/${path.posix.basename(file, '.md')}.html`;
  return undefined;
}

const outputPath = (url: string): string => (url.endsWith('/') ? `${url.slice(1)}index.html` : url.slice(1));

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isExternal = (t: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//');

/** The guide's pages in index order: Getting started first, then the pages the index lists, as `[title](page.md)`. */
export function guideNav(src: Source): NavEntry[] {
  const index = src.read(INDEX);
  if (index === undefined) throw new Error(`${INDEX}: the guide index does not exist`);
  const out: NavEntry[] = [];
  const seen = new Set<string>();
  for (const m of index.matchAll(/\[([^\]]+)\]\(([^)#\s]+\.md)(?:#[^)\s]*)?\)/g)) {
    if (isExternal(m[2])) continue;
    const file = path.posix.normalize(path.posix.join(GUIDE_DIR, m[2]));
    if (path.posix.dirname(file) !== GUIDE_DIR || file === INDEX || seen.has(file)) continue;
    seen.add(file);
    out.push({ title: m[1], file });
  }
  return out;
}

const titleOf = (md: string, fallback: string): string => /^#\s+(.+?)\s*#*\s*$/m.exec(md)?.[1].replace(/[`*]/g, '') ?? fallback;

interface PageState {
  file: string;
  version: string;
  src: Source;
  images: Map<string, string>;
  /** Every `/docs/...#anchor` link on the page, to check once all pages are known. */
  anchorLinks: { dest: string; anchor: string; target: string }[];
}

/** Where a markdown link or image target goes: its served URL, and whether it leaves for GitHub. */
function rewrite(target: string, image: boolean, st: PageState): { href: string; github: boolean } {
  if (isExternal(target) || target.startsWith('#')) return { href: target, github: false };
  const hash = target.indexOf('#');
  const rel = decodeURIComponent(hash === -1 ? target : target.slice(0, hash));
  const frag = hash === -1 ? '' : target.slice(hash);
  const dest = path.posix.normalize(path.posix.join(path.posix.dirname(st.file), rel));
  if (image) {
    if (!st.src.exists(dest)) throw new Error(`${st.file}: image "${target}" points to ${dest}, which does not exist`);
    if (!dest.startsWith(`${EVIDENCE_DIR}/`)) throw new Error(`${st.file}: image "${target}" is outside ${EVIDENCE_DIR}/, so it cannot be copied`);
    const out = `docs/img/${dest.slice(EVIDENCE_DIR.length + 1)}`;
    st.images.set(dest, out);
    return { href: `/${out}`, github: false };
  }
  const url = pageUrl(dest);
  if (url !== undefined) {
    if (!st.src.exists(dest)) throw new Error(`${st.file}: link "${target}" points to ${dest}, which does not exist`);
    if (frag !== '') st.anchorLinks.push({ dest, anchor: decodeURIComponent(frag.slice(1)).toLowerCase(), target });
    return { href: `${url}${frag}`, github: false };
  }
  return { href: `${GITHUB_BLOB}/v${st.version}/${dest}${frag}`, github: true };
}

function markdownOf(md: string, st: PageState, ids: string[]): string {
  const idOf = headingIds();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(this, token: Tokens.Heading): string {
        const id = idOf(token.text);
        ids.push(id);
        return `<h${token.depth} id="${escapeHtml(id)}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
      },
      link(this, token: Tokens.Link): string {
        const { href, github } = rewrite(token.href, false, st);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        const extra = github ? ' target="_blank" rel="noopener"' : '';
        return `<a href="${escapeHtml(href)}"${title}${extra}>${this.parser.parseInline(token.tokens)}</a>`;
      },
      image(token: Tokens.Image): string {
        const { href } = rewrite(token.href, true, st);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(token.text)}"${title} loading="lazy">`;
      },
      // Raw HTML in the markdown is shown as text, never passed through.
      html(token: Tokens.HTML | Tokens.Tag): string {
        return escapeHtml(token.text);
      },
    },
  });
  return marked.parse(md, { async: false });
}

const CSS = `:root{color-scheme:dark;--bg:#09090b;--panel:#111114;--panel-2:#17171b;--border:#212126;--border-2:#2f2f36;--text:#e8e8ed;--muted:#9b9ba6;--accent:#3b82f6;--accent-2:#60a5fa;--mono:ui-monospace,'SF Mono','Cascadia Code',Menlo,Consolas,monospace}
*{box-sizing:border-box}
html{scroll-padding-top:64px}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
a{color:var(--accent-2)}
header.doc-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:16px;height:48px;padding:0 16px;background:var(--panel);border-bottom:1px solid var(--border)}
header.doc-head .brand{font-weight:600}
header.doc-head .ver{color:var(--muted)}
header.doc-head .back{margin-left:auto;text-decoration:none;border:1px solid var(--border-2);border-radius:6px;padding:4px 10px;color:var(--text)}
header.doc-head .back:hover{background:var(--panel-2)}
.doc-layout{display:flex;align-items:flex-start;max-width:1280px;margin:0 auto}
nav.doc-nav{position:sticky;top:48px;flex:0 0 240px;max-height:calc(100vh - 48px);overflow:auto;padding:16px;border-right:1px solid var(--border)}
nav.doc-nav h2{margin:16px 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
nav.doc-nav h2:first-child{margin-top:0}
nav.doc-nav ul{list-style:none;margin:0;padding:0}
nav.doc-nav a{display:block;padding:3px 8px;border-radius:6px;color:var(--text);text-decoration:none}
nav.doc-nav a:hover{background:var(--panel-2)}
nav.doc-nav a[aria-current=page]{background:var(--panel-2);color:var(--accent-2);font-weight:600}
main.doc-main{flex:1;min-width:0;padding:24px 32px 64px}
main.doc-main h1,main.doc-main h2,main.doc-main h3,main.doc-main h4{line-height:1.3}
main.doc-main h2{margin-top:2em;padding-bottom:.3em;border-bottom:1px solid var(--border)}
code{font-family:var(--mono);font-size:.9em;background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:1px 4px}
pre{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px;overflow:auto}
pre code{background:none;border:0;padding:0}
img{display:block;max-width:100%;height:auto;margin:12px 0;border:1px solid var(--border);border-radius:8px}
table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}
th,td{border:1px solid var(--border-2);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--panel-2)}
blockquote{margin:12px 0;padding:2px 14px;border-left:3px solid var(--border-2);color:var(--muted)}
@media(max-width:760px){.doc-layout{display:block}nav.doc-nav{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--border)}main.doc-main{padding:16px}}`;

function pageHtml(file: string, title: string, body: string, nav: NavEntry[], version: string): string {
  const item = (url: string, text: string): string =>
    `<li><a href="${url}"${pageUrl(file) === url ? ' aria-current="page"' : ''}>${escapeHtml(text)}</a></li>`;
  const guide = [item('/docs/', 'Guide index'), ...nav.map((e) => item(pageUrl(e.file) as string, e.title))].join('');
  const refs = REFERENCE_DOCS.map((f) => item(pageUrl(f) as string, path.posix.basename(f, '.md').replace(/-/g, ' '))).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - Vost manual</title>
<style>${CSS}</style>
</head>
<body>
<header class="doc-head"><span class="brand">Vost manual</span><span class="ver">v${escapeHtml(version)}</span><a class="back" href="/">Back to Vost</a></header>
<div class="doc-layout">
<nav class="doc-nav" aria-label="Manual"><h2>User guide</h2><ul>${guide}</ul><h2>Reference</h2><ul>${refs}</ul></nav>
<main class="doc-main">
${body}</main>
</div>
</body>
</html>
`;
}

/** Renders the whole manual. Throws, naming the file, when an image or a link target is missing or an anchor does not resolve. */
export function renderManual(src: Source, version: string): Rendered {
  const nav = guideNav(src);
  const files = [INDEX, ...nav.map((e) => e.file), ...REFERENCE_DOCS];
  for (const name of src.list(GUIDE_DIR)) {
    const f = `${GUIDE_DIR}/${name}`;
    if (name.endsWith('.md') && !files.includes(f)) throw new Error(`${f}: is not listed in ${INDEX}, so it would not be in the manual`);
  }
  const pages = new Map<string, string>();
  const images = new Map<string, string>();
  const idsOf = new Map<string, Set<string>>();
  const pending: { file: string; links: PageState['anchorLinks'] }[] = [];
  for (const file of files) {
    const md = src.read(file);
    if (md === undefined) throw new Error(`${file}: the file does not exist`);
    const st: PageState = { file, version, src, images, anchorLinks: [] };
    const ids: string[] = [];
    const body = markdownOf(md, st, ids);
    idsOf.set(file, new Set(ids));
    pending.push({ file, links: st.anchorLinks });
    pages.set(outputPath(pageUrl(file) as string), pageHtml(file, titleOf(md, file), body, nav, version));
  }
  for (const { file, links } of pending) {
    for (const l of links) {
      if (!idsOf.get(l.dest)?.has(l.anchor)) throw new Error(`${file}: link "${l.target}" has no matching heading: ${l.dest} has no heading with the anchor #${l.anchor}`);
    }
  }
  return { pages, images };
}
