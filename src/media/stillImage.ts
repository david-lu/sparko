import type { MediaSource } from './media';

export const DEFAULT_IMAGE_DURATION = 1;

/** Decode once, including only the first frame of animated image formats. */
export async function loadStillImage(source: MediaSource, signal?: AbortSignal): Promise<ImageBitmap> {
  signal?.throwIfAborted();
  let blob: Blob = source.file!;
  if (!blob) {
    const response = await fetch(source.url, { signal });
    if (!response.ok) throw new Error(`Unable to load ${source.name}.`);
    blob = await response.blob();
  }
  const image = await createImageBitmap(blob);
  if (signal?.aborted) { image.close(); signal.throwIfAborted(); }
  return image;
}

export function stillCanvas(image: ImageBitmap, width: number, height: number, fit: 'contain' | 'cover' = 'contain') {
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')!;
  const scale = (fit === 'cover' ? Math.max : Math.min)(width / image.width, height / image.height);
  context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
  context.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale);
  return canvas;
}
