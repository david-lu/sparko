import { crc32, deflateSync } from 'node:zlib';
import { COMFY } from '../../../shared/constants.js';

/** Normalized 8-bit gradient, mapped to 0.95 + 0.05 * value by the graph.
 * Same elliptical smoothstep used by the approved vignette experiment.
 */
export function vignetteGradientPng(width: number, height: number): Buffer<ArrayBuffer> {
  if (![width, height].every(value => Number.isInteger(value) && value >= 32 && value <= COMFY.maxDimension)) throw new Error('Invalid vignette dimensions.');
  const pixels = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const radius = Math.hypot((x - (width - 1) / 2) / ((width - 1) / 2), (y - (height - 1) / 2) / ((height - 1) / 2));
    const t = Math.max(0, Math.min(1, (radius - 0.2) / 0.8));
    pixels[y * (width + 1) + x + 1] = Math.round((1 - t * t * (3 - 2 * t)) * 255);
  }
  const chunk = (name: string, data: Buffer) => {
    const buffer = Buffer.alloc(data.length + 12);
    buffer.writeUInt32BE(data.length); buffer.write(name, 4, 'ascii'); data.copy(buffer, 8);
    buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4);
    return buffer;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; // 8-bit grayscale, filter 0.
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
