import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchorsOf } from '../guide-anchors.ts';
import { renderManual } from './render.ts';
import type { Source } from './render.ts';

const ROOT = path.resolve(__dirname, '..', '..');
const VERSION = '9.8.7';
const GH = 'https://github.com/cbundy/Vost/blob/v9.8.7';

function memory(files: Record<string, string>): Source {
  return {
    exists: (p) => p in files,
    read: (p) => files[p],
    list: (dir) => Object.keys(files).filter((f) => path.posix.dirname(f) === dir).map((f) => path.posix.basename(f)),
  };
}

/** A minimal manual: an index listing `page.md`, the page itself and the five reference docs. */
function fixture(page: string, extra: Record<string, string> = {}): Source {
  const files: Record<string, string> = {
    'docs/guide/README.md': '# Guide\n\n| Page | About |\n|---|---|\n| [The page](page.md) | x |\n',
    'docs/guide/page.md': page,
    'docs/evidence/a/shot.png': 'png',
    'docs/DATA-SOURCES.md': '# Data sources\n',
    'docs/DEPLOYMENT.md': '# Deployment\n\n## Docker\n',
    'docs/PINE.md': '# Pine\n',
    'docs/STRATEGIES.md': '# Strategies\n',
    'docs/third-party-notices.md': '# Notices\n',
    ...extra,
  };
  return memory(files);
}

const pageOf = (src: Source): string => renderManual(src, VERSION).pages.get('docs/page.html') as string;

describe('renderManual on fixtures', () => {
  it('writes the index, the page and the reference docs', () => {
    const { pages } = renderManual(fixture('# Page\n'), VERSION);
    expect([...pages.keys()].sort()).toEqual([
      'docs/index.html',
      'docs/page.html',
      'docs/ref/DATA-SOURCES.html',
      'docs/ref/DEPLOYMENT.html',
      'docs/ref/PINE.html',
      'docs/ref/STRATEGIES.html',
      'docs/ref/third-party-notices.html',
    ]);
  });

  it('rewrites a .md link, keeping its anchor, to the absolute served path', () => {
    const html = pageOf(fixture('# Page\n\nSee [docker](../DEPLOYMENT.md#docker) and [home](README.md).\n'));
    expect(html).toContain('<a href="/docs/ref/DEPLOYMENT.html#docker">docker</a>');
    expect(html).toContain('<a href="/docs/">home</a>');
  });

  it('copies a relative image to a served path and lists it', () => {
    const src = fixture('# Page\n\n![A shot](../evidence/a/shot.png)\n');
    const out = renderManual(src, VERSION);
    expect(out.pages.get('docs/page.html')).toContain('<img src="/docs/img/a/shot.png" alt="A shot" loading="lazy">');
    expect([...out.images]).toEqual([['docs/evidence/a/shot.png', 'docs/img/a/shot.png']]);
  });

  it('sends other repo files to the tag-pinned GitHub URL in a new tab', () => {
    const html = pageOf(fixture('# Page\n\n[readme](../../README.md) [spike](../spikes/x/README.md#top) [l](../../LICENSE)\n'));
    expect(html).toContain(`<a href="${GH}/README.md" target="_blank" rel="noopener">readme</a>`);
    expect(html).toContain(`<a href="${GH}/docs/spikes/x/README.md#top" target="_blank" rel="noopener">spike</a>`);
    expect(html).toContain(`href="${GH}/LICENSE"`);
  });

  it('leaves external and in-page links alone', () => {
    const html = pageOf(fixture('# Page\n\n[a](https://example.com/x) [b](#page) [c](mailto:a@b.c)\n'));
    expect(html).toContain('<a href="https://example.com/x">a</a>');
    expect(html).toContain('<a href="#page">b</a>');
    expect(html).toContain('<a href="mailto:a@b.c">c</a>');
  });

  it('escapes raw HTML instead of passing it through', () => {
    const html = pageOf(fixture('# Page\n\nResults · <metric> and <script>alert(1)</script>\n\n<div onclick="x()">hi</div>\n'));
    expect(html).toContain('&lt;metric&gt;');
    expect(html).not.toContain('<metric>');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<div onclick');
  });

  it('gives headings the ids of anchorsOf, repeats numbered', () => {
    const md = '# Page\n\n## Same\n\ntext\n\n## Same\n\n## The `Build` [setting](README.md)\n\n```\n## not a heading\n```\n';
    const html = pageOf(fixture(md));
    const ids = [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['page', 'same', 'same-1', 'the-build-setting']);
    expect(new Set(ids)).toEqual(anchorsOf(md));
  });

  it('renders a GFM table as a table', () => {
    const html = pageOf(fixture('# Page\n\n| A | B |\n|---|---|\n| 1 | 2 |\n'));
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('marks the current page in the navigation and links back to the app', () => {
    const html = pageOf(fixture('# Page\n'));
    expect(html).toContain('<a href="/docs/page.html" aria-current="page">The page</a>');
    expect(html).toContain('<a href="/docs/">Guide index</a>');
    expect(html).toContain('<a class="back" href="/">Back to Vost</a>');
    expect(html).toContain('v9.8.7');
  });

  it('throws, naming the file, for a missing image', () => {
    expect(() => renderManual(fixture('# Page\n\n![x](../evidence/none.png)\n'), VERSION)).toThrow(/docs\/guide\/page\.md: image .*none\.png/);
  });

  it('throws, naming the file, for a missing link target', () => {
    expect(() => renderManual(fixture('# Page\n\n[x](gone.md)\n'), VERSION)).toThrow(/docs\/guide\/page\.md: link .*gone\.md/);
  });

  it('throws, naming the file, for an anchor the target does not have', () => {
    expect(() => renderManual(fixture('# Page\n\n[x](../DEPLOYMENT.md#nope)\n'), VERSION)).toThrow(/docs\/guide\/page\.md: link .*#nope/);
  });

  it('throws for a guide page the index does not list', () => {
    expect(() => renderManual(fixture('# Page\n', { 'docs/guide/stray.md': '# Stray\n' }), VERSION)).toThrow(/stray\.md: is not listed/);
  });
});

describe('renderManual on the repo', () => {
  const disk: Source = {
    exists: (p) => existsSync(path.join(ROOT, p)),
    read: (p) => (existsSync(path.join(ROOT, p)) ? readFileSync(path.join(ROOT, p), 'utf8') : undefined),
    list: (dir) => readdirSync(path.join(ROOT, dir)),
  };
  const { pages, images } = renderManual(disk, VERSION);
  const guideFiles = readdirSync(path.join(ROOT, 'docs/guide')).filter((f) => f.endsWith('.md'));

  it('has an output page for every guide page, with the index as index.html', () => {
    expect(pages.has('docs/index.html')).toBe(true);
    for (const f of guideFiles.filter((n) => n !== 'README.md')) expect(pages.has(`docs/${f.replace(/\.md$/, '.html')}`)).toBe(true);
    expect(pages.size).toBe(guideFiles.length + 5);
  });

  it('gives every guide heading the id anchorsOf computes', () => {
    for (const f of guideFiles) {
      const out = f === 'README.md' ? 'docs/index.html' : `docs/${f.replace(/\.md$/, '.html')}`;
      const ids = [...(pages.get(out) as string).matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids), f).toEqual(anchorsOf(readFileSync(path.join(ROOT, 'docs/guide', f), 'utf8')));
    }
  });

  it('resolves every /docs link to a page and its anchor, and every image to the copy list', () => {
    const idsOf = new Map<string, Set<string>>();
    for (const [out, html] of pages) idsOf.set(`/${out}`, new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])));
    const copied = new Set([...images.values()].map((o) => `/${o}`));
    for (const [out, html] of pages) {
      for (const m of html.matchAll(/<a href="(\/docs\/[^"#]*)(?:#([^"]*))?"/g)) {
        const url = m[1].endsWith('/') ? `${m[1]}index.html` : m[1];
        expect(idsOf.has(url), `${out}: ${m[1]}`).toBe(true);
        if (m[2]) expect(idsOf.get(url)!.has(m[2]), `${out}: ${m[1]}#${m[2]}`).toBe(true);
      }
      for (const m of html.matchAll(/<img src="([^"]+)"/g)) expect(copied.has(m[1]), `${out}: ${m[1]}`).toBe(true);
    }
    expect(images.size).toBeGreaterThan(200);
    for (const from of images.keys()) expect(existsSync(path.join(ROOT, from)), from).toBe(true);
  });

  it('makes no outside request: only GitHub link hrefs and in-text links leave the server', () => {
    for (const [out, html] of pages) {
      expect(html, out).not.toMatch(/<(script|link|iframe|embed|object)\b/i);
      expect(html, out).not.toMatch(/\b(src|srcset|poster)="(https?:)?\/\//i);
      expect(html, out).not.toMatch(/url\(\s*['"]?(https?:)?\/\//i);
      expect(html, out).not.toMatch(/@import/);
    }
  });

  it('shows <metric> as text on the backtesting page', () => {
    const html = pages.get('docs/backtesting.html') as string;
    expect(html).toContain('&lt;metric&gt;');
    expect(html).not.toContain('<metric>');
  });
});
