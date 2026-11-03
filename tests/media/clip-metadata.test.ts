import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, EncodedPacketSink, Input, Mp4OutputFormat, Output } from 'mediabunny';
import { readClipMetadata, writeClipMetadata } from '../../src/media/clipMetadata';
import { MAX_CLIP_METADATA_BYTES, parseClipMetadata } from '../../shared/clip-metadata';
import { clipMetadata } from '../fixtures/clip-metadata';
const signal = () => new AbortController().signal;
const fixture = async () => new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')], { type: 'video/mp4' });
async function inspect(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const tracks = [];
    for (const track of await input.getTracks()) {
      const packets = [];
      for await (const packet of new EncodedPacketSink(track).packets()) packets.push({ data: packet.data, timestamp: packet.timestamp, duration: packet.duration, type: packet.type });
      tracks.push({ codec: await track.getCodec(), packets });
    }
    return { tracks, tags: await input.getMetadataTags() };
  } finally { input.dispose(); }
}
describe('portable MP4 clip metadata', () => {
  it('round trips Unicode, source provenance and Comfy tags without changing encoded video packets', async () => {
    const original = await fixture();
    expect(await readClipMetadata(original, signal())).toBeUndefined();
    const comfy = JSON.stringify({ noise: { inputs: { noise_seed: 1234 } }, conditioning: { inputs: { prompt: clipMetadata.prompt } } });
    const input = new Input({ source: new BlobSource(original), formats: ALL_FORMATS });
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ metadataFormat: 'mdta' }) });
    try {
      const conversion = await Conversion.init({ input, output, copy: { mode: 'forced' }, tags: { raw: { prompt: comfy } } });
      await conversion.execute();
    } finally { input.dispose(); }
    const tagged = await writeClipMetadata(new Blob([output.target.buffer!], { type: 'video/mp4' }), clipMetadata, signal());
    const saved = await writeClipMetadata(tagged, { ...clipMetadata, clip: { ...clipMetadata.clip, name: 'Renamed clip' } }, signal());
    expect(await readClipMetadata(saved, signal())).toEqual({ ...clipMetadata, clip: { ...clipMetadata.clip, name: 'Renamed clip' } });
    const before = await inspect(original), after = await inspect(saved);
    expect(after.tracks).toEqual(before.tracks);
    expect(after.tracks).toHaveLength(1);
    expect(after.tags.raw?.prompt).toBe(comfy);
  });
  it('ignores malformed, unsupported or oversized metadata and rejects cancelled work', async () => {
    for (const value of ['{', 'null', JSON.stringify({ ...clipMetadata, version: 2 }), JSON.stringify({ ...clipMetadata, media: { start: 10, duration: 3, totalDuration: 4 } }), ' '.repeat(MAX_CLIP_METADATA_BYTES + 1)]) expect(parseClipMetadata(value)).toBeUndefined();
    const controller = new AbortController(); controller.abort();
    await expect(readClipMetadata(await fixture(), controller.signal)).rejects.toThrow();
    await expect(writeClipMetadata(await fixture(), clipMetadata, controller.signal)).rejects.toThrow();
  });
});
