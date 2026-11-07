/** A bounded JPEG for multimodal prompt context, preserving the source aspect ratio. */
export async function imagePreview(blob: Blob, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(blob);
  try {
    signal.throwIfAborted();
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to preview image references.');
    for (const size of [512, 384, 256, 128]) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', .65);
      if (data.length <= 32_000) return data;
    }
    throw new Error('Unable to create a small enough image preview.');
  } finally { bitmap.close(); }
}
