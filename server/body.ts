/** Reads a request body as text, up to `maxBytes`. */
import type { IncomingMessage } from 'node:http';

/** The body, or `'too-large'` when it is declared or streamed over the cap (the rest is drained). */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<string | 'too-large'> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      return resolve('too-large');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) over = true;
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(over ? 'too-large' : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
