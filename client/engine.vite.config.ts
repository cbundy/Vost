import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const clientRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('../server/dist', import.meta.url));

/** The server's engine bundle: one Node file (server/dist/engine.mjs) with pinets and the engines inlined. */
export default defineConfig({
  root: clientRoot,
  logLevel: 'warn',
  publicDir: false,
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'src/serverEngine/entry.ts',
    outDir,
    emptyOutDir: true,
    target: 'node22',
    sourcemap: false,
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'engine.mjs', inlineDynamicImports: true } },
  },
});
