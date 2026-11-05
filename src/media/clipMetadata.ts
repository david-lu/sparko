import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } from 'mediabunny';
import { CLIP_METADATA_TAG, parseClipMetadata, parseComfyClipMetadata, serializeClipMetadata, type ClipMetadata } from '../../shared/clip-metadata';

export async function readClipMetadata(blob: Blob, signal: AbortSignal): Promise<ClipMetadata | undefined> {
  signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const abort = () => input.dispose(); signal.addEventListener('abort', abort, { once: true });
  try {
    const tags = await input.getMetadataTags(); signal.throwIfAborted();
    // A local tag may describe an extracted loop and takes precedence over the original graph.
    const comfy = parseComfyClipMetadata(tags.raw?.prompt) ?? parseComfyClipMetadata(tags.comment);
    if (tags.raw?.[CLIP_METADATA_TAG] === undefined) return comfy;
    const local = parseClipMetadata(tags.raw[CLIP_METADATA_TAG]);
    // Preserve local loop bounds, recovering only the same render's missing seed.
    return local && local.seed === undefined && comfy?.id === local.id && comfy.seed !== undefined ? { ...local, seed: comfy.seed } : local;
  } catch { signal.throwIfAborted(); return; }
  finally { signal.removeEventListener('abort', abort); input.dispose(); }
}

/** Copy encoded packets and all existing tags, including Comfy's graph. Never re-encode. */
export async function writeClipMetadata(blob: Blob, metadata: ClipMetadata, signal: AbortSignal, onProgress?: (value: number) => void): Promise<Blob> {
  signal.throwIfAborted();
  const text = serializeClipMetadata(metadata);
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
