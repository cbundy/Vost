import { describe, expect, it } from 'vitest';
import { crc32, inflateSync } from 'node:zlib';
import { makePng } from './drawing-image.ts';

describe('makePng', () => {
  it('uses the standard CRC32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('builds a valid PNG', () => {
    const w = 40;
    const h = 30;
    const png = makePng(w, h);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const types: string[] = [];
    let idat = Buffer.alloc(0);
    let off = 8;
    while (off < png.length) {
      const len = png.readUInt32BE(off);
      const type = png.subarray(off + 4, off + 8).toString('ascii');
      const data = png.subarray(off + 8, off + 8 + len);
      const stored = png.readUInt32BE(off + 8 + len);
      expect(stored, `crc of ${type}`).toBe(crc32(png.subarray(off + 4, off + 8 + len)));
      if (type === 'IEND') expect(stored).toBe(0xae426082);
      if (type === 'IDAT') idat = Buffer.concat([idat, data]);
      types.push(type);
      off += 12 + len;
    }
    expect(off).toBe(png.length);
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(inflateSync(idat).length).toBe((w * 3 + 1) * h);
  });
});
