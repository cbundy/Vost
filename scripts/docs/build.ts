/**
 * Writes the built-in manual to client/dist/docs/: the user guide and the reference docs it links as web pages, and
 * the screenshots they show. Runs after `vite build` (which empties client/dist); the server serves the result as it
 * serves the rest of client/dist. Fails, naming the file, when an image or a link target is missing.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderManual } from './render.ts';
import type { Source } from './render.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const abs = (p: string): string => path.join(root, p);

const source: Source = {
  exists: (p) => existsSync(abs(p)),
  read: (p) => (existsSync(abs(p)) ? readFileSync(abs(p), 'utf8') : undefined),
  list: (dir) => (existsSync(abs(dir)) ? readdirSync(abs(dir)) : []),
};

const version = (JSON.parse(readFileSync(abs('package.json'), 'utf8')) as { version: string }).version;
const { pages, images } = renderManual(source, version);

const outDir = abs('client/dist/docs');
rmSync(outDir, { recursive: true, force: true });
for (const [out, html] of pages) {
  mkdirSync(path.dirname(abs(`client/dist/${out}`)), { recursive: true });
  writeFileSync(abs(`client/dist/${out}`), html);
}
for (const [from, out] of images) {
  mkdirSync(path.dirname(abs(`client/dist/${out}`)), { recursive: true });
  copyFileSync(abs(from), abs(`client/dist/${out}`));
}
console.log(`manual: ${pages.size} pages and ${images.size} images written to client/dist/docs/`);
