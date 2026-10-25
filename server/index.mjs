#!/usr/bin/env node
/**
 * Vost server entry point. The server itself is TypeScript (`./main.ts`) that
 * Node runs by type stripping, which needs Node 22.18 or newer; this file stays
 * plain JavaScript so an older Node can still print a clear message.
 */
const [major, minor] = process.versions.node.split('.').map(Number);
// Type stripping is on by default from 22.18 and from 23.6.
if (major < 22 || (major === 22 && minor < 18) || (major === 23 && minor < 6)) {
  console.error(`Vost needs Node 22.18 or newer (found v${process.versions.node})`);
  process.exit(1);
}

await import('./main.ts');
