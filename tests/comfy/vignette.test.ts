import { describe, expect, it } from 'vitest';
import { crc32, inflateSync } from 'node:zlib';
import { vignetteGradientPng } from '../../server/features/comfy/vignette';

describe('vignette mask input', () => {
  it.each([[960, 544], [736, 1280]])('encodes a smooth symmetric normalized gradient at %s × %s', (width, height) => {
    const png = vignetteGradientPng(width, height), chunks = new Map<string, Buffer>();
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
      expect(png.readUInt32BE(offset + length + 8)).toBe(crc32(png.subarray(offset + 4, offset + length + 8)));
      chunks.set(type, png.subarray(offset + 8, offset + length + 8)); offset += length + 12;
    }
    const header = chunks.get('IHDR')!;
    expect([header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9]]).toEqual([width, height, 8, 0]);
    const rows = inflateSync(chunks.get('IDAT')!);
    expect(rows.length).toBe((width + 1) * height);
    const pixel = (x: number, y: number) => rows[y * (width + 1) + x + 1];
    const centerY = Math.floor(height / 2);
    expect(pixel(0, 0)).toBe(0); expect(pixel(width / 2, centerY)).toBe(255);
    for (let x = 0; x < width / 2; x++) {
      expect(pixel(x, centerY)).toBe(pixel(width - 1 - x, centerY));
      expect(pixel(x, centerY)).toBeLessThanOrEqual(pixel(x + 1, centerY));
      expect(pixel(x + 1, centerY) - pixel(x, centerY)).toBeLessThanOrEqual(3);
    }
    // At normalized radius 0.65 the effective cloud mask is approximately 0.97.
    const outer = pixel(Math.round((width - 1) * .825), centerY) / 255;
    expect(.95 + .05 * outer).toBeCloseTo(.97, 3);
    expect(chunks.has('IEND')).toBe(true);
  });
});
