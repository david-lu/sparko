import { expect, test } from '@playwright/test';

test('generated framing fills small borders in previews, exports and crossfades without cropping source footage', async ({ page }) => {
  await page.route('**/__framing-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Framing test</title>' }));
  await page.goto('/__framing-test');
  const results = await page.evaluate(async () => {
    const { BufferTarget, CanvasSource, CanvasSink, Mp4OutputFormat, Output, Input, BlobSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { TimelineComposition } = await import('/src/media/TimelineComposition.ts' as string);
    const { renderComposition } = await import('/src/media/CompositionRenderer.ts' as string);
    const fixture = async (height: number, color: string) => {
      const canvas = new OffscreenCanvas(320, height), ctx = canvas.getContext('2d')!;
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat() });
      const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 300_000 });
      output.addVideoTrack(video, { frameRate: 24 }); await output.start();
      ctx.fillStyle = color; ctx.fillRect(0, 0, 320, height);
      for (let frame = 0; frame < 24; frame++) await video.add(frame / 24, 1 / 24);
      video.close(); await output.finalize(); return URL.createObjectURL(new Blob([output.target.buffer], { type: 'video/mp4' }));
    };
    // Both assets deliberately differ from the parent canvas: only the generated one may be cropped.
    const sourceUrl = await fixture(188, '#ee0000'), generatedUrl = await fixture(188, '#00ee00'), squareUrl = await fixture(320, '#0000ee');
    const results = [];
    try {
      for (const preview of [true, false]) for (const matchFraming of [false, true]) for (const square of [false, true]) {
        const composition = new TimelineComposition({ id: 'source', name: 'Source', url: sourceUrl },
          { width: 320, height: 180, duration: 1, fps: 24, codec: 'avc', hasAudio: false },
          [{ id: 'generated', label: 'Generated', time: .5, phase: 'ready', result: { url: square ? squareUrl : generatedUrl, start: 0, duration: 1, totalDuration: 1 } }], { matchFraming });
        const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat() });
        await renderComposition(composition, output, { start: 0, end: 2, preview, signal: new AbortController().signal });
        const input = new Input({ source: new BlobSource(new Blob([output.target.buffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
        try {
          const track = await input.getPrimaryVideoTrack(), sink = new CanvasSink(track);
          const pixels = [];
          for (const time of [.25, .5, .75, 1.75]) {
            const { canvas } = await sink.getCanvas(time + 1e-7), ctx = canvas.getContext('2d');
            pixels.push({ edge: [...ctx.getImageData(0, 90, 1, 1).data], center: [...ctx.getImageData(160, 90, 1, 1).data] });
          }
          results.push({ preview, matchFraming, square, pixels, width: await track.getDisplayWidth(), height: await track.getDisplayHeight(),
            duration: await track.computeDuration(), frames: (await track.computePacketStats()).packetCount });
        } finally { input.dispose(); }
      }
    } finally { [sourceUrl, generatedUrl, squareUrl].forEach(URL.revokeObjectURL); }
    return results;
  });
  for (const result of results) {
    expect(result).toMatchObject({ width: 320, height: 180, frames: 48 });
    expect(result.duration).toBeCloseTo(2, 4);
    // Original footage retains its full framing on either side of the insert.
    for (const index of [0, 3]) { expect(result.pixels[index].edge[0]).toBeLessThan(15); expect(result.pixels[index].center[0]).toBeGreaterThan(200); }
    const channel = result.square ? 2 : 1;
    expect(result.pixels[2].center[channel]).toBeGreaterThan(200);
    if (result.matchFraming && !result.square) {
      expect(result.pixels[2].edge[1]).toBeGreaterThan(200);
      expect(result.pixels[1].edge[1]).toBeGreaterThan(40); // The transition decoder uses the same crop.
    } else {
      expect(result.pixels[2].edge[channel]).toBeLessThan(15);
      expect(result.pixels[1].edge[channel]).toBeLessThan(15);
    }
  }
});
