import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const clientRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: clientRoot,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    strictPort: false,
    // In development the API runs on the Node server (default :8787).
    proxy: {
      '/api': {
        target: process.env.VOST_SERVER_URL ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
