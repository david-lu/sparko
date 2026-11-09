import { expect, test } from '@playwright/test';

test('generation uploads keep the same center crop when original and generated references are swapped', { tag: '@slow' }, async ({ page }) => {
  await page.route('**/__generation-framing', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Reference crop</title>' }));
  await page.route('**/api/status', route => route.fulfill({ json: { uploadMode: 'local' } }));
  await page.route('**/api/comfy/status*', route => route.fulfill({ json: { ready: true } }));
  // Echo the actual upload for pixel inspection without submitting a generation job.
  await page.route('**/api/comfy/interstitials', async route => {
    const form = await new Response(Uint8Array.from(route.request().postDataBuffer()!),
      { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();
    const video = form.get('video') as File;
    await route.fulfill({ json: { requestId: 'crop-test', status: 'IN_QUEUE', uploadedVideo: Buffer.from(await video.arrayBuffer()).toString('base64') } });
  });
  await page.goto('/__generation-framing');
  const results = await page.evaluate(async () => {
    const { ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const { generationSource } = await import('/src/features/call-response/generation.ts' as string);
    const { generateInterstitial } = await import('/src/features/interstitials/api.ts' as string);
    const { MediaEngine } = await import('/src/media/MediaEngine.ts' as string);
    const fixture = async (width: number, height: number) => {
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d')!;
      // The original has extra footage at the sides; all three clips share the same central picture.
      ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, width, height);
      const scale = height / 768;
      ctx.translate((width - 1344 * scale) / 2, 0); ctx.scale(scale, scale);
      ctx.fillStyle = '#3060c0'; ctx.fillRect(0, 0, 1344, 768);
      ctx.fillStyle = '#00ee00'; ctx.fillRect(240, 180, 160, 160);
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat() });
      const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 2_000_000 });
      output.addVideoTrack(video, { frameRate: 24 }); await output.start();
      for (let frame = 0; frame < 96; frame++) await video.add(frame / 24, 1 / 24);
      video.close(); await output.finalize();
      return assets.save(new Blob([output.target.buffer], { type: 'video/mp4' }), `${width}x${height}.mp4`);
    };
    const original = await fixture(1920, 1080), generated = await fixture(1344, 768), smaller = await fixture(672, 384);
    const item = { id: 'crop', label: 'Crop', method: 'comfy', phase: 'draft', time: 2, start_range: 2, end_range: 2,
      duration: 6, prompt: 'Keep the same framing.', enable_prompt_expansion: false };
    const project = { width: 1920, height: 1080 };
    const inspect = async (job: { uploadedVideo: string }) => {
      const bytes = Uint8Array.from(atob(job.uploadedVideo), c => c.charCodeAt(0));
      const input = new Input({ source: new BlobSource(new Blob([bytes], { type: 'video/mp4' })), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack(), sink = new CanvasSink(track);
        const samples = [];
        for (const time of [.5, 2.5]) {
          const { canvas } = await sink.getCanvas(time), ctx = canvas.getContext('2d');
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
          for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
            const p = (y * canvas.width + x) * 4;
            if (data[p] < 80 && data[p + 1] > 150 && data[p + 2] < 80) {
              left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
            }
          }
          samples.push({ bounds: [left, top, right + 1, bottom + 1],
            // Sample inside the former six-pixel bars, away from chroma bleed at the crop boundary.
            edges: [[4, canvas.height / 2], [canvas.width - 5, canvas.height / 2], [canvas.width / 2, 4], [canvas.width / 2, canvas.height - 5]]
              .map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3)) });
        }
        const stats = await track.computePacketStats();
        return { width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), duration: await track.computeDuration(),
          frames: stats.packetCount, fps: stats.averagePacketRate, samples };
      } finally { input.dispose(); }
    };
    const results = [];
    for (const [before, after] of [[original, generated], [generated, original], [smaller, original]]) {
      const signal = new AbortController().signal;
      const source = await generationSource(item, { mode: 'bridge',
        before: { sceneId: 'before', assetId: before.id, inFrame: 0, outFrame: 48 },
        after: { sceneId: 'after', assetId: after.id, inFrame: 0, outFrame: 48 },
      }, signal, project);
      const job = await generateInterstitial(source.item, source.engine, source.info, signal, () => {});
      results.push(await inspect(job));
    }
    // Direct generation from the parent must use the same crop as composed references.
    const { url } = await assets.open(original.id), engine = new MediaEngine({ id: original.id, name: original.name, url });
    try {
      const job = await generateInterstitial(item, engine, await engine.inspect(), new AbortController().signal, () => {});
      results.push(await inspect(job));
    } finally { engine.dispose(); }
    return results;
  });
  expect(results).toHaveLength(4);
  for (const result of results) {
    expect(result).toMatchObject({ width: 1344, height: 768, frames: 78 });
    expect(result.duration).toBeCloseTo(78 / 24, 5); expect(result.fps).toBeCloseTo(24, 5);
    for (const sample of result.samples) {
      sample.bounds.forEach((value: number, index: number) => expect(Math.abs(value - [240, 180, 400, 340][index])).toBeLessThanOrEqual(2));
      for (const edge of sample.edges) edge.forEach((value: number, index: number) => expect(Math.abs(value - [48, 96, 192][index])).toBeLessThan(20));
    }
  }
});
