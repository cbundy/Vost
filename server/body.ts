/** Reads a request body as bytes or text, up to `maxBytes`. */
import type { IncomingMessage } from 'node:http';

/** The raw body, or `'too-large'` when it is declared or streamed over the cap (the rest is drained). */
export function readBytes(req: IncomingMessage, maxBytes: number): Promise<Buffer | 'too-large'> {
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
    req.on('end', () => resolve(over ? 'too-large' : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** The body as UTF-8 text, or `'too-large'` (see {@link readBytes}). */
export async function readBody(req: IncomingMessage, maxBytes: number): Promise<string | 'too-large'> {
  const bytes = await readBytes(req, maxBytes);
  return bytes === 'too-large' ? bytes : bytes.toString('utf8');
}
