import { expect, test, type Page } from '@playwright/test';

async function prepareAudio(page: Page) {
  await page.route('**/__audio-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Audio regression</title>' }));
  await page.goto('/__audio-test');
  await page.evaluate(async () => {
    const { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { ensureAac } = await import('/src/media/media.ts' as string); await ensureAac();
    const fixture = async (rate: number, channels: number, duration: number, frequencies: number[]) => {
      const canvas = new OffscreenCanvas(160, 90), context = canvas.getContext('2d')!;
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
      const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 100_000 });
      // PCM keeps the fixture's exact rate even on browsers without a 32 kHz AAC encoder.
      const audio = channels ? new AudioBufferSource({ codec: 'pcm-f32' }) : null;
      output.addVideoTrack(video, { frameRate: 24 }); if (audio) output.addAudioTrack(audio);
      await output.start();
      await Promise.all([
        (async () => { for (let frame = 0; frame < duration * 24; frame++) {
          context.fillStyle = '#204080'; context.fillRect(0, 0, 160, 90); await video.add(frame / 24, 1 / 24);
        } video.close(); })(),
        (async () => { if (!audio) return;
          const buffer = new AudioBuffer({ sampleRate: rate, numberOfChannels: channels, length: duration * rate });
          for (let channel = 0; channel < channels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let frame = 0; frame < data.length; frame++) data[frame] = .2 * Math.sin(frame / rate * 2 * Math.PI * frequencies[channel]);
          }
          await audio.add(buffer); audio.close();
        })(),
      ]);
      await output.finalize();
      const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
      return { blob, source: { id: `${rate}:${channels}`, name: `${rate} Hz`, url: URL.createObjectURL(blob) } };
    };
    const clips = [await fixture(48000, 2, 1.5, [440, 660]), await fixture(32000, 2, 7, [880, 1100]),
      await fixture(44100, 1, 1.5, [550]), await fixture(48000, 0, 1, [])];
    const segment = (index: number, startFrame: number, endFrame: number, sourceStart = 0, still = false) => ({
      id: `segment:${startFrame}`, kind: 'source', label: clips[index].source.name, source: clips[index].source,
      startFrame, endFrame, sourceStart, still,
    });
    (window as any).audioFixture = { clips, composition: {
      fps: 24, info: { width: 160, height: 90, duration: 10, fps: 24, hasAudio: true, codec: 'avc' },
      segments: [segment(0, 0, 24), segment(1, 24, 168, .25), segment(2, 168, 192, .125),
        segment(1, 192, 204, 6, true), segment(3, 204, 216), segment(0, 216, 240)],
    } };
  });
}

test('composition exports and preview renders preserve audio across mixed rates, channels and silent clips', async ({ page }) => {
  await prepareAudio(page);
  const results = await page.evaluate(async () => {
    const { ALL_FORMATS, AudioSampleSink, BlobSource, BufferTarget, Input, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { renderComposition } = await import('/src/media/CompositionRenderer.ts' as string);
    const results = [];
    for (const preview of [false, true]) {
      const start = preview ? .25 : 0, end = preview ? 9.75 : 10;
      const target = new BufferTarget(), output = new Output({ target, format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
      await renderComposition((window as any).audioFixture.composition, output, { start, end, preview, signal: new AbortController().signal });
      const input = new Input({ source: new BlobSource(new Blob([target.buffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryAudioTrack();
        const rate = await track.getSampleRate(), channels = await track.getNumberOfChannels();
        const samples = [new Float32Array(Math.ceil((end - start + .1) * rate)), new Float32Array(Math.ceil((end - start + .1) * rate))];
        let previousEnd = 0, maxGap = 0;
        for await (const sample of new AudioSampleSink(track).samples()) {
          try {
            maxGap = Math.max(maxGap, Math.abs(sample.timestamp - previousEnd)); previousEnd = sample.timestamp + sample.duration;
            for (let channel = 0; channel < 2; channel++) {
              const data = new Float32Array(sample.numberOfFrames); sample.copyTo(data, { planeIndex: channel, format: 'f32-planar' });
              samples[channel].set(data, Math.round(sample.timestamp * rate));
            }
          } finally { sample.close(); }
        }
        const measure = (from: number, to: number) => samples.map(data => {
          const first = Math.round((from - start) * rate), last = Math.round((to - start) * rate);
          let energy = 0, crossings = 0;
          for (let index = first; index < last; index++) {
            energy += data[index] ** 2; if (index > first && data[index - 1] < 0 && data[index] >= 0) crossings++;
          }
          return { rms: Math.sqrt(energy / (last - first)), frequency: crossings / (to - from) };
        });
        results.push({ rate, channels, maxGap, duration: await input.computeDuration(), expectedDuration: end - start,
          tones: [measure(.4, .8), measure(1.3, 1.8), measure(6.3, 6.8), measure(7.2, 7.8), measure(9.1, 9.6)],
          silence: [measure(8.1, 8.4), measure(8.6, 8.9)] });
      } finally { input.dispose(); }
    }
    return results;
  });
  for (const result of results) {
    expect(result.rate).toBe(48000); expect(result.channels).toBe(2);
    expect(result.maxGap).toBeLessThan(1 / 48000 + .000001);
    expect(Math.abs(result.duration - result.expectedDuration)).toBeLessThan(.05);
    const expectedFrequencies = [[440, 660], [880, 1100], [880, 1100], [550, 550], [440, 660]];
    result.tones.forEach((tone, index) => tone.forEach((channel, side) => {
      expect(channel.rms).toBeGreaterThan(.1); expect(channel.rms).toBeLessThan(.18);
      expect(Math.abs(channel.frequency - expectedFrequencies[index][side])).toBeLessThan(15);
    }));
    result.silence.flat().forEach(channel => expect(channel.rms).toBeLessThan(.001));
  }
});

test('call-response generation references bridge 32 kHz audio into source audio or a silent held frame', async ({ page }) => {
  await prepareAudio(page);
  const results = await page.evaluate(async () => {
    const { ALL_FORMATS, AudioSampleSink, BlobSource, Input } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const { generationSource } = await import('/src/features/call-response/generation.ts' as string);
    const clips = (window as any).audioFixture.clips;
    const before = await assets.save(clips[1].blob, 'generated-32khz.mp4'), after = await assets.save(clips[0].blob, 'source-48khz.mp4');
    const results = [];
    for (const held of [false, true]) {
      const reference = { before: { sceneId: 'wait', assetId: before.id, inFrame: 6, outFrame: 150 },
        ...(!held ? { after: { sceneId: 'continue', assetId: after.id, inFrame: 0, outFrame: 36 } } : {}) };
      const item = { id: 'response', label: 'Response', prompt: '', time: 0, start_range: 1, end_range: 1, duration: 6, phase: 'ready', enable_prompt_expansion: false };
      const source = await generationSource(item, reference, new AbortController().signal);
      const blob = await source.engine.exportMp4({ start: 0, end: source.info.duration });
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryAudioTrack();
        let energy = 0, count = 0;
        // Decode in sequence so AAC's decoder startup does not distort the measured window.
        for await (const sample of new AudioSampleSink(track).samples()) {
          try {
            const data = new Float32Array(sample.numberOfFrames); sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
            const first = Math.max(0, Math.ceil((1.2 - sample.timestamp) * sample.sampleRate));
            const last = Math.min(data.length, Math.floor((1.8 - sample.timestamp) * sample.sampleRate));
            for (let frame = first; frame < last; frame++) { energy += data[frame] ** 2; count++; }
          } finally { sample.close(); }
        }
        const rms = Math.sqrt(energy / count);
        results.push({ held, rate: await track.getSampleRate(), channels: await track.getNumberOfChannels(), duration: await input.computeDuration(), rms });
      } finally { input.dispose(); }
    }
    return results;
  });
  for (const result of results) {
    expect(result.rate).toBe(48000); expect(result.channels).toBe(2); expect(Math.abs(result.duration - 2)).toBeLessThan(.05);
    if (result.held) expect(result.rms).toBeLessThan(.001); else expect(result.rms).toBeGreaterThan(.1);
  }
});

test('canvas playback schedules audible mixed-rate audio, silence and seeks on its shared clock', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await prepareAudio(page);
  await page.evaluate(async () => {
    const { CanvasTimelinePlayback } = await import('/src/features/player/CanvasTimelinePlayback.ts' as string);
    const video = document.createElement('video'); video.muted = false; document.body.append(video);
    const composition = { ...(window as any).audioFixture.composition, duration: 10, crossfade: false,
      at(time: number) { return this.segments.find((segment: { endFrame: number }) => Math.min(time, 9.999) * 24 < segment.endFrame); } };
    const state = { video, stream: null as any, error: null as string | null, time: 0, start: (time: number) => { state.stream.seek(time); state.stream.play(); } };
    state.stream = new CanvasTimelinePlayback(composition, video, (time: number, _playing: boolean, _buffering: boolean, error?: string) => { state.time = time; state.error = error ?? null; });
    const audio = state.stream.decks.audio, analyser = audio.context.createAnalyser(); analyser.fftSize = 2048;
    const createGain = audio.context.createGain.bind(audio.context);
    audio.context.createGain = () => { const gain = createGain(); gain.connect(analyser); return gain; };
    (state as any).rms = () => { const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples); return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); };
    (window as any).audioPlayback = state;
    (window as any).audioPlayback.start(0);
  });
  await expect.poll(() => page.evaluate(() => (window as any).audioPlayback.rms())).toBeGreaterThan(.05);
  await expect.poll(() => page.evaluate(() => (window as any).audioPlayback.time), { timeout: 20_000 }).toBeGreaterThan(2);
  expect(await page.evaluate(() => (window as any).audioPlayback.rms())).toBeGreaterThan(.05);
  await page.evaluate(() => (window as any).audioPlayback.stream.pause());
  await expect.poll(() => page.evaluate(() => (window as any).audioPlayback.rms())).toBeLessThan(.001);
  await page.evaluate(() => (window as any).audioPlayback.start(6.75));
  await expect.poll(() => page.evaluate(() => (window as any).audioPlayback.time), { timeout: 20_000 }).toBeGreaterThan(9.9);
  expect(await page.evaluate(() => (window as any).audioPlayback.error)).toBeNull();
  expect(errors).toEqual([]);
  await page.evaluate(() => { (window as any).audioPlayback.stream.dispose(); });
});
