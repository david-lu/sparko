import { z } from 'zod';
import { IMAGE_REFERENCE } from '../../../shared/image-references.js';
import { HttpError } from '../../shared/http.js';

const encodedImage = z.string().max(Math.ceil(IMAGE_REFERENCE.maxBytes / 3) * 4 + 23)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);
export function parseImageReferences(value: unknown): Blob[] {
  if (value === undefined) return [];
  const text = z.string().max(IMAGE_REFERENCE.maxCount * (Math.ceil(IMAGE_REFERENCE.maxBytes / 3) * 4 + 30) + 2).parse(value);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new HttpError(400, 'Invalid image references. Reattach your images.'); }
  return z.array(encodedImage).max(IMAGE_REFERENCE.maxCount).parse(parsed).map(image => {
    const encoded = image.slice(23), bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded || bytes.length > IMAGE_REFERENCE.maxBytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new HttpError(400, 'Invalid JPEG image reference. Reattach your images.');
    }
    return new Blob([bytes], { type: 'image/jpeg' });
  });
}
