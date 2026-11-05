import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { readBody } from './body.ts';

const fake = (chunks: string[], headers: Record<string, string> = {}): IncomingMessage => Object.assign(Readable.from(chunks.map((c) => Buffer.from(c))), { headers }) as unknown as IncomingMessage;

describe('readBody', () => {
  it('returns the body under the cap', async () => {
    expect(await readBody(fake(['ab', 'cd']), 4)).toBe('abcd');
  });
  it('says too-large when the declared length is over the cap, and drains the request', async () => {
    const req = fake(['abcdef'], { 'content-length': '6' });
    expect(await readBody(req, 4)).toBe('too-large');
    await new Promise((r) => req.on('end', r)); // resume() lets the stream finish
  });
  it('says too-large when the streamed body is over the cap', async () => {
    expect(await readBody(fake(['abc', 'def']), 4)).toBe('too-large');
  });
});
