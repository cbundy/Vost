import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT_SRC = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

describe('client sources', () => {
  it('open no websocket and name no wss:// host: live candles come only from the Vost server', () => {
    const files = sources(CLIENT_SRC);
    expect(files.length).toBeGreaterThan(20);
    const bad = files.filter((f) => /WebSocket|wss:\/\//.test(readFileSync(f, 'utf8'))).map((f) => path.relative(CLIENT_SRC, f));
    expect(bad).toEqual([]);
  });
});
