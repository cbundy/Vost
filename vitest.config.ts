import { defineConfig } from 'vitest/config';

// Quiet on success, failures only: every agent, the factory loop's gate and CI
// read this output on every run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['client/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    reporters: ['dot'],
    silent: true,
  },
});
