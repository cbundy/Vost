import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { readBody, readBytes } from './body.ts';

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

describe('readBytes', () => {
  const stream = (chunks: Buffer[], headers: Record<string, string> = {}): IncomingMessage => Object.assign(Readable.from(chunks), { headers }) as unknown as IncomingMessage;
  it('returns the exact bytes, including ones that are not UTF-8', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0xff, 0xfe, 0x00, 0xc3, 0x28]);
    const got = await readBytes(stream([bytes.subarray(0, 3), bytes.subarray(3)]), 100);
    expect(Buffer.isBuffer(got) && got.equals(bytes)).toBe(true);
  });
  it('enforces its cap, declared and streamed', async () => {
    expect(await readBytes(stream([Buffer.alloc(3), Buffer.alloc(3)]), 4)).toBe('too-large');
    expect(await readBytes(stream([Buffer.alloc(6)], { 'content-length': '6' }), 4)).toBe('too-large');
    expect(await readBytes(stream([Buffer.alloc(4)]), 4)).toHaveLength(4);
  });
});
