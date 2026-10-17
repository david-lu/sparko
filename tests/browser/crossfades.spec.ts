import { expect, test } from '@playwright/test';

test('crossfades blend video and mixed-rate audio in exports, previews and partial seeks', async ({ page }) => {
  await page.route('**/__crossfade-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Crossfade test</title>' }));
  await page.goto('/__crossfade-test');
  const results = await page.evaluate(async () => {
    const { AudioBufferSource, AudioSampleSink, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { TimelineComposition } = await import('/src/media/TimelineComposition.ts' as string);
    const { renderComposition } = await import('/src/media/CompositionRenderer.ts' as string);
    const fixture = async (color: string, rate: number, frequency: number, duration: number) => {
      const canvas = new OffscreenCanvas(160, 96), ctx = canvas.getContext('2d')!;
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
      const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 100_000 });
      const audio = new AudioBufferSource({ codec: 'pcm-f32' });
      output.addVideoTrack(video, { frameRate: 24 }); output.addAudioTrack(audio); await output.start();
      await Promise.all([
        (async () => { for (let frame = 0; frame < duration * 24; frame++) { ctx.fillStyle = color; ctx.fillRect(0, 0, 160, 96); await video.add(frame / 24, 1 / 24); } video.close(); })(),
        (async () => {
          const buffer = new AudioBuffer({ numberOfChannels: 2, length: duration * rate, sampleRate: rate });
          for (let channel = 0; channel < 2; channel++) { const data = buffer.getChannelData(channel); for (let i = 0; i < data.length; i++) data[i] = .2 * Math.sin(i / rate * 2 * Math.PI * frequency); }
          await audio.add(buffer); audio.close();
        })(),
      ]);
      await output.finalize(); return URL.createObjectURL(new Blob([output.target.buffer], { type: 'video/mp4' }));
    };
    const sourceUrl = await fixture('#ee0000', 48000, 440, 3), generatedUrl = await fixture('#00ee00', 32000, 880, 4);
    const results = [];
    try { for (const mode of ['export', 'preview', 'disabled', 'partial']) {
      const composition = new TimelineComposition({ id: 'source', name: 'Source', url: sourceUrl }, { duration: 3, fps: 24, width: 160, height: 96, hasAudio: true, codec: 'avc' },
        [{ id: 'generated', label: 'Generated', time: 1, phase: 'ready', result: { url: generatedUrl, start: 1, duration: 2, totalDuration: 4 } }], { crossfade: mode !== 'disabled' });
      const start = mode === 'partial' ? 23 / 24 : 0, end = mode === 'partial' ? 26 / 24 : composition.duration;
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
      try { await renderComposition(composition, output, { start, end, signal: new AbortController().signal, preview: mode === 'preview' }); }
      catch (error) { throw new Error(`${mode}: ${(error as Error).message}`); }
      const input = new Input({ source: new BlobSource(new Blob([output.target.buffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
      try {
        const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
        const sink = new CanvasSink(video, { width: 1, height: 1, fit: 'fill' });
        const frames = mode === 'partial' ? [23, 24, 25] : [12, 21, 22, 23, 24, 25, 26, 48, 69, 70, 71, 72, 73, 74, 96];
        const colors = [];
        for (const frame of frames) { const sample = await sink.getCanvas(frame / 24 - start + 1e-7); colors.push([...sample.canvas.getContext('2d').getImageData(0, 0, 1, 1).data]); }
        const rate = await audio.getSampleRate(), data = new Float32Array(Math.ceil((end - start + .1) * rate));
        let previousEnd = 0, maxGap = 0;
        for await (const sample of new AudioSampleSink(audio).samples()) {
          try {
            maxGap = Math.max(maxGap, Math.abs(sample.timestamp - previousEnd)); previousEnd = sample.timestamp + sample.duration;
            const plane = new Float32Array(sample.numberOfFrames); sample.copyTo(plane, { planeIndex: 0, format: 'f32-planar' }); data.set(plane, Math.round(sample.timestamp * rate));
          } finally { sample.close(); }
        }
        const amplitude = (frequency: number, from: number, to: number) => {
          const first = Math.round((from - start) * rate), last = Math.round((to - start) * rate);
          let sin = 0, cos = 0;
          for (let i = first; i < last; i++) { sin += data[i] * Math.sin(i / rate * 2 * Math.PI * frequency); cos += data[i] * Math.cos(i / rate * 2 * Math.PI * frequency); }
          return 2 * Math.hypot(sin, cos) / (last - first);
        };
        results.push({ mode, colors, frames, duration: await video.computeDuration(), packets: (await video.computePacketStats()).packetCount, rate,
          audioDuration: await audio.computeDuration(), maxGap,
          incomingBeforeCut: mode === 'partial' ? 0 : amplitude(880, .94, .97), outgoingAfterCut: mode === 'partial' ? 0 : amplitude(440, 1.03, 1.06) });
      } finally { input.dispose(); }
    } } finally { URL.revokeObjectURL(sourceUrl); URL.revokeObjectURL(generatedUrl); }
    return results;
  });
  for (const result of results) {
    const partial = result.mode === 'partial';
    expect(result.duration).toBeCloseTo(partial ? 3 / 24 : 5, 4);
    expect(result.packets).toBe(partial ? 3 : 120);
    expect(result.rate).toBe(48000); expect(result.maxGap).toBeLessThan(.002);
    expect(Math.abs(result.audioDuration - result.duration)).toBeLessThan(.05);
    const color = (frame: number) => result.colors[result.frames.indexOf(frame)];
    if (result.mode === 'disabled') {
      expect(color(23)[0]).toBeGreaterThan(200); expect(color(24)[1]).toBeGreaterThan(200);
      expect(color(23)[1]).toBeLessThan(20); expect(color(24)[0]).toBeLessThan(20);
      expect(result.incomingBeforeCut).toBeLessThan(.02); expect(result.outgoingAfterCut).toBeLessThan(.02);
    } else {
      for (const frame of partial ? [23, 24, 25] : [22, 23, 24, 25, 70, 71, 72, 73]) { expect(color(frame)[0]).toBeGreaterThan(15); expect(color(frame)[1]).toBeGreaterThan(15); }
      expect(color(23)[0]).toBeGreaterThan(color(24)[0]); expect(color(23)[1]).toBeLessThan(color(24)[1]);
      if (!partial) { expect(result.incomingBeforeCut).toBeGreaterThan(.025); expect(result.outgoingAfterCut).toBeGreaterThan(.025); }
    }
  }
  const full = results[0], partial = results[3];
  for (let i = 0; i < partial.colors.length; i++) for (let channel = 0; channel < 3; channel++) expect(Math.abs(partial.colors[i][channel] - full.colors[full.frames.indexOf(partial.frames[i])][channel])).toBeLessThan(8);
});
