import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, EncodedPacketSink, Input, Mp4OutputFormat, Output, type MetadataTags } from 'mediabunny';
import { readClipMetadata, writeClipMetadata } from '../../src/media/clipMetadata';
import { MAX_CLIP_METADATA_BYTES, parseClipMetadata, parseComfyClipMetadata, clipOriginSchema } from '../../shared/clip-metadata';
import { clipMetadata } from '../fixtures/clip-metadata';
import { bridgeWorkflow } from '../../server/features/comfy/workflow';
import { comfyBridgePlan } from '../../shared/comfy';
const signal = () => new AbortController().signal;
const fixture = async () => new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')], { type: 'video/mp4' });
async function withTags(tags: MetadataTags, metadataFormat: 'mdta' | 'mdir' = 'mdta') {
  const input = new Input({ source: new BlobSource(await fixture()), formats: ALL_FORMATS });
  const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ metadataFormat }) });
  try {
    const conversion = await Conversion.init({ input, output, copy: { mode: 'forced' }, tags });
    await conversion.execute();
    return new Blob([output.target.buffer!], { type: 'video/mp4' });
  } finally { input.dispose(); }
}
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
  it('recovers only the connected sampler seed in older graphs and preserves an explicit seed', async () => {
    const graph = {
      sample: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['actual_noise', 0] } },
      actual_noise: { class_type: 'RandomNoise', inputs: { noise_seed: 0 } },
      noise: { class_type: 'RandomNoise', inputs: { noise_seed: 999 } },
      output: { _meta: { sparko: clipMetadata } },
    };
    expect(parseComfyClipMetadata(JSON.stringify(graph))?.seed).toBe(0);
    expect(parseComfyClipMetadata(JSON.stringify({ ...graph, sample: undefined }))?.seed).toBeUndefined();
    const local = { ...clipMetadata, seed: Number.MAX_SAFE_INTEGER };
    expect(await readClipMetadata(await withTags({ raw: { prompt: JSON.stringify(graph), sparko: JSON.stringify(local) } }), signal())).toEqual(local);
    const other = { ...clipMetadata, id: '44444444-4444-4444-8444-444444444444' };
    expect(await readClipMetadata(await withTags({ raw: { prompt: JSON.stringify(graph), sparko: JSON.stringify(other) } }), signal())).toEqual(other);
    graph.output._meta.sparko = local;
    expect(parseComfyClipMetadata(JSON.stringify(graph))?.seed).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '123'])('rejects invalid saved seeds (%s)', seed => {
    expect(parseClipMetadata(JSON.stringify({ ...clipMetadata, seed }))).toBeUndefined();
    expect(parseClipMetadata(JSON.stringify({ ...clipMetadata, settings: { ...clipMetadata.settings, seed } }))).toBeUndefined();
  });
  it.each(['prompt', 'comment'] as const)('reads direct Comfy downloads with a %s tag and no local sparko tag', async format => {
    const origin = clipOriginSchema.parse(clipMetadata);
    const graph = bridgeWorkflow('uploaded-reference', { clipOrigin: origin, before: 1.625, after: 1.625, duration: 6,
      prompt: 'Exact submitted prompt', width: 960, height: 544, hasAudio: true }, 1234);
    const prompt = JSON.stringify(graph);
    const blob = await withTags(format === 'prompt' ? { raw: { prompt } } : { comment: JSON.stringify({ prompt }) }, format === 'prompt' ? 'mdta' : 'mdir');
    expect((await inspect(blob)).tags.raw?.sparko).toBeUndefined();
    expect(await readClipMetadata(blob, signal())).toEqual({ ...origin, seed: 1234, prompt: 'Exact submitted prompt', media: comfyBridgePlan(1.625, 1.625, 6).insertion });
    // Loop extraction and local updates must override the original graph's media range.
    const local = await writeClipMetadata(blob, clipMetadata, signal());
    expect(await readClipMetadata(local, signal())).toEqual({ ...clipMetadata, seed: 1234 });
    const invalidLocal = await withTags({ raw: { prompt, sparko: JSON.stringify({ ...clipMetadata, version: 2 }) } });
    expect(await readClipMetadata(invalidLocal, signal())).toBeUndefined();
  });
  it('does not infer reference identities from an ordinary graph or accept invalid embedded data', () => {
    const wrap = (metadata: unknown) => JSON.stringify({ prompt: JSON.stringify({ output: { _meta: { sparko: metadata } } }) });
    for (const text of ['{', 'null', JSON.stringify({ prompt: '{' }), JSON.stringify({ before: { inputs: { video: 'upload.mp4' } } }),
      wrap({ ...clipMetadata, version: 2 }), wrap({ ...clipMetadata, references: { before: { ...clipMetadata.references.before, outFrame: 0 } } }), ' '.repeat(MAX_CLIP_METADATA_BYTES * 4 + 1)]) {
      expect(parseComfyClipMetadata(text)).toBeUndefined();
    }
  });
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
