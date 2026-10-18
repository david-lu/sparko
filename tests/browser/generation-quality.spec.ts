import { expect, test } from '@playwright/test';

test('call-response references and finished Idle retain the generated clip resolution', async ({ page }) => {
  await page.goto('/');
  const dimensions = await page.evaluate(async () => {
    const { ALL_FORMATS, BlobSource, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const { generationSource } = await import('/src/features/call-response/generation.ts' as string);
    const { finishLoop } = await import('/src/features/call-response/finishLoop.ts' as string);
    const canvas = new OffscreenCanvas(768, 1344), context = canvas.getContext('2d')!;
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 2_000_000 });
    output.addVideoTrack(video, { frameRate: 24 }); await output.start();
    for (let frame = 0; frame < 48; frame++) {
      context.fillStyle = frame % 2 ? '#cc8844' : '#4477cc'; context.fillRect(0, 0, 768, 1344);
      await video.add(frame / 24, 1 / 24);
    }
    video.close(); await output.finalize();
    const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
    const asset = await assets.save(blob, 'quality-source.mp4');
    const reference = { before: { sceneId: 'call', assetId: asset.id, inFrame: 0, outFrame: 48 }, mode: 'extend' as const };
    const item = { id: 'idle', label: 'Idle', prompt: '', time: 0, start_range: 1, end_range: 0,
      duration: 6, phase: 'ready' as const, enable_prompt_expansion: false };
    const source = await generationSource(item, reference, new AbortController().signal);
    const referenceBlob = await source.engine.exportMp4({ start: 0, end: source.info.duration }, { maxDimension: 1344 });
    const finished = await finishLoop(blob, { url: 'asset:quality-source', start: 0, duration: 1, totalDuration: 2, reference }, new AbortController().signal);
    const size = async (media: Blob) => {
      const input = new Input({ source: new BlobSource(media), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        return [await track.getDisplayWidth(), await track.getDisplayHeight()];
      } finally { input.dispose(); }
    };
    return { reference: await size(referenceBlob), idle: await size(finished.blob) };
  });
  expect(dimensions).toEqual({ reference: [768, 1344], idle: [768, 1344] });
});
