import { IMAGE_REFERENCE, type ImageReference } from '../../../shared/image-references';
import { assets } from '../project/assets';

export function imageDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const reader = new FileReader();
    const abort = () => reader.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    reader.onload = () => { cleanup(); resolve(String(reader.result)); };
    reader.onerror = () => { cleanup(); reject(new Error('Unable to read the image reference.')); };
    reader.onabort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    reader.readAsDataURL(blob);
  });
}

/** Decode locally and keep a bounded, portable JPEG with its original aspect ratio. */
export async function prepareImageReference(file: File, signal: AbortSignal): Promise<ImageReference> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (!file.size || file.size > IMAGE_REFERENCE.maxInputBytes) throw new Error('Choose an image smaller than 20 MB.');
  signal.throwIfAborted();
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('Unable to read this image. Choose another PNG, JPEG or WebP.'); }
  try {
    signal.throwIfAborted();
    const scale = Math.min(1, IMAGE_REFERENCE.maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image preparation is unavailable in this browser.');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encode = (quality: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to prepare this image.')), 'image/jpeg', quality));
    let blob = await encode(.9);
    if (blob.size > IMAGE_REFERENCE.maxBytes) blob = await encode(.7);
    if (blob.size > IMAGE_REFERENCE.maxBytes) throw new Error('This image has too much detail. Resize it and try again.');
    signal.throwIfAborted();
    const asset = await assets.save(blob, file.name.slice(0, 1000), signal);
    return { assetId: asset.id, name: asset.name };
  } finally { bitmap.close(); }
}

export async function referenceImageData(references: ImageReference[] = [], signal: AbortSignal) {
  if (references.length > IMAGE_REFERENCE.maxCount) throw new Error('H3 supports up to 9 image references.');
  const images: string[] = [];
  for (const reference of references) {
    signal.throwIfAborted();
    const { asset } = await assets.open(reference.assetId);
    if (asset.blob.type !== 'image/jpeg' || !asset.blob.size || asset.blob.size > IMAGE_REFERENCE.maxBytes) throw new Error(`Reattach the image reference “${reference.name}”.`);
    images.push(await imageDataUrl(asset.blob, signal));
  }
  return images;
}

/** Small previews keep prompt enhancement within the existing 1 MB JSON limit. */
export async function referenceImagePreviews(references: ImageReference[] = [], signal: AbortSignal) {
  const images: string[] = [];
  for (const reference of references) {
    signal.throwIfAborted();
    const { asset } = await assets.open(reference.assetId), bitmap = await createImageBitmap(asset.blob);
    try {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Unable to preview image references.');
      for (const size of [512, 384, 256, 128]) {
        const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', .65);
        if (data.length <= 32_000) { images.push(data); break; }
      }
    } finally { bitmap.close(); }
  }
  return images;
}
