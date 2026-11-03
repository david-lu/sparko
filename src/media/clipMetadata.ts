import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } from 'mediabunny';
import { CLIP_METADATA_TAG, MAX_CLIP_METADATA_BYTES, clipMetadataSchema, parseClipMetadata, type ClipMetadata } from '../../shared/clip-metadata';

export async function readClipMetadata(blob: Blob, signal: AbortSignal): Promise<ClipMetadata | undefined> {
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const abort = () => input.dispose(); signal.addEventListener('abort', abort, { once: true });
  try {
    const tags = await input.getMetadataTags(); signal.throwIfAborted();
    return parseClipMetadata(tags.raw?.[CLIP_METADATA_TAG]);
  } catch { signal.throwIfAborted(); return; }
  finally { signal.removeEventListener('abort', abort); input.dispose(); }
}

/** Copy encoded packets and all existing tags, including Comfy's graph. Never re-encode. */
export async function writeClipMetadata(blob: Blob, metadata: ClipMetadata, signal: AbortSignal, onProgress?: (value: number) => void): Promise<Blob> {
  signal.throwIfAborted();
  const text = JSON.stringify(clipMetadataSchema.parse(metadata));
  if (new TextEncoder().encode(text).length > MAX_CLIP_METADATA_BYTES) throw new Error('Clip metadata exceeds 256 KB.');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory', metadataFormat: 'mdta' }) });
  let conversion: Conversion | undefined;
  const abort = () => { if (conversion) void conversion.cancel().catch(() => undefined); else input.dispose(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    conversion = await Conversion.init({ input, output, copy: { mode: 'forced' }, tags: tags => ({ ...tags,
      raw: { ...tags.raw, [CLIP_METADATA_TAG]: text } }) });
    signal.throwIfAborted();
    if (!conversion.isValid || conversion.discardedTracks.length) throw new Error('Unable to save clip metadata without changing its media tracks.');
    conversion.onProgress = onProgress;
    await conversion.execute(); signal.throwIfAborted();
    if (!output.target.buffer) throw new Error('Saving clip metadata produced no video.');
    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', abort);
    if (conversion && conversion.state !== 'done') await conversion.cancel().catch(() => undefined);
    input.dispose();
  }
}
