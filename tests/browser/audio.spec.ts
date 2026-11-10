import { expect, test, type Page } from '@playwright/test';

test('asset exports apply volume to audio while preserving video packets and original files', async ({ page }) => {
  await prepareAudio(page);
  const results = await page.evaluate(async () => {
    const { ALL_FORMATS, AudioSampleSink, BlobSource, EncodedPacketSink, Input } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { exportMediaVolume, extractAudio } = await import('/src/media/media.ts' as string);
    const clip = (window as any).audioFixture.clips[0];
    const audio = await extractAudio(clip.source, { start: 0, end: 1.5 });
    const inspect = async (blob: Blob) => {
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryAudioTrack(); let sum = 0, count = 0;
        for await (const sample of new AudioSampleSink(track).samples(.25, 1.1)) {
          const data = new Float32Array(sample.numberOfFrames); sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
          for (const value of data) { sum += value * value; count++; } sample.close();
        }
        const video = await input.getPrimaryVideoTrack(), packets = [];
        if (video) for await (const packet of new EncodedPacketSink(video).packets()) packets.push(packet.data);
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await new Blob(packets).arrayBuffer()))].join(',');
        return { rms: Math.sqrt(sum / count), frames: packets.length, digest };
      } finally { input.dispose(); }
    };
    const results = [];
    for (const original of [clip.blob, audio]) {
      const baseline = await inspect(original);
      for (const volume of [.25, 0]) results.push({ baseline, volume, output: await inspect(await exportMediaVolume(original, volume)) });
      results.push({ baseline, volume: 1, output: await inspect(await exportMediaVolume(original, 1)), unchanged: await exportMediaVolume(original, 1) === original });
    }
    return results;
  });
  for (const { baseline, output, volume, unchanged } of results) {
    expect(output.rms / baseline.rms).toBeCloseTo(volume, 2);
    expect(output.frames).toBe(baseline.frames); expect(output.digest).toBe(baseline.digest);
    if (volume === 1) expect(unchanged).toBe(true);
  }
});

test('timeline exports apply each asset volume through audio crossfades', async ({ page }) => {
  await prepareAudio(page);
  const results = await page.evaluate(async () => {
    const { ALL_FORMATS, AudioSampleSink, BlobSource, BufferTarget, Input, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { renderComposition } = await import('/src/media/CompositionRenderer.ts' as string);
    const { clips } = (window as any).audioFixture;
    const results = [];
    for (const volume of [.5, 0]) {
      const composition = { info: { width: 160, height: 90, duration: 3, fps: 24, hasAudio: true, codec: 'avc' }, fps: 24, crossfadeFrames: 12,
        segments: [
          { id: 'source', label: 'Source', kind: 'source', source: { ...clips[0].source, volume: .25 }, sourceStart: 0, startFrame: 0, endFrame: 36 },
          { id: 'generated', label: 'Generated', kind: 'interstitial', source: { ...clips[1].source, volume }, sourceStart: 1, startFrame: 36, endFrame: 72,
            generated: { start: 1, duration: 1.5, totalDuration: 7, url: clips[1].source.url } },
        ] };
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat() });
      await renderComposition(composition, output, { start: 0, end: 3, signal: new AbortController().signal });
      const input = new Input({ source: new BlobSource(new Blob([output.target.buffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryAudioTrack(), rate = await track.getSampleRate(), data = new Float32Array(rate * 4);
        for await (const sample of new AudioSampleSink(track).samples()) {
          const values = new Float32Array(sample.numberOfFrames); sample.copyTo(values, { planeIndex: 0, format: 'f32-planar' });
          data.set(values, Math.round(sample.timestamp * rate)); sample.close();
        }
        const amplitude = (frequency: number, from: number, to: number) => {
          const first = Math.round(from * rate), last = Math.round(to * rate); let sin = 0, cos = 0;
          for (let i = first; i < last; i++) { sin += data[i] * Math.sin(i / rate * 2 * Math.PI * frequency); cos += data[i] * Math.cos(i / rate * 2 * Math.PI * frequency); }
          return 2 * Math.hypot(sin, cos) / (last - first);
        };
        results.push({ volume, source: amplitude(440, .4, .7), generated: amplitude(880, 2, 2.3), incomingFade: amplitude(880, 1.2, 1.3), outgoingFade: amplitude(440, 1.2, 1.3) });
      } finally { input.dispose(); }
    }
    return results;
  });
  for (const result of results) {
    expect(result.source).toBeCloseTo(.05, 2);
    expect(result.generated).toBeCloseTo(.2 * result.volume, 2);
    expect(result.outgoingFade).toBeGreaterThan(.015); expect(result.outgoingFade).toBeLessThan(.04);
    if (result.volume === 0) expect(result.incomingFade).toBeLessThan(.001);
    else { expect(result.incomingFade).toBeGreaterThan(.03); expect(result.incomingFade).toBeLessThan(.07); }
  }
});

async function prepareAudio(page: Page) {
  await page.route('**/__audio-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Audio regression</title>' }));
  await page.goto('/__audio-test');
  await page.evaluate(async () => {
    const { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { ensureAac } = await import('/src/media/media.ts' as string); await ensureAac();
    const fixture = async (rate: number, channels: number, duration: number, frequencies: number[]) => {
      const canvas = new OffscreenCanvas(160, 90), context = canvas.getContext('2d')!;
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
      // Baseline avoids software H.264 encoders emitting an undecodable High/Level 1b stream at this fixture size.
      const video = new CanvasSource(canvas, { codec: 'avc', fullCodecString: 'avc1.42001e', bitrate: 100_000 });
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

test('project audio layers mix in rendered output with offsets, trims, volume and export-range seeks', async ({ page }) => {
  await prepareAudio(page);
  const results = await page.evaluate(async () => {
    const { ALL_FORMATS, AudioSampleSink, BlobSource, BufferTarget, Input, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { renderComposition } = await import('/src/media/CompositionRenderer.ts' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const { clips } = (window as any).audioFixture;
    const ids = [];
    for (const clip of clips.slice(0, 3)) { const asset = await assets.save(clip.blob, 'Audio'); await assets.open(asset.id); ids.push(asset.id); }
    const layer = (assetId: string, patch: any) => ({ id: crypto.randomUUID(), name: 'Audio', assetId, startFrame: 0, inFrame: 0, outFrame: 36, volume: .5, muted: false, ...patch });
    const composition = { info: { width: 160, height: 90, duration: 3, fps: 24, hasAudio: true, codec: 'avc' }, fps: 24, crossfade: false,
      segments: [0, 36].map(startFrame => ({ id: `clip:${startFrame}`, label: 'Video', kind: 'source', source: { ...clips[0].source, volume: 0 }, sourceStart: 0, startFrame, endFrame: startFrame + 36 })),
      audioLayers: [layer(ids[0], {}), layer(ids[1], { startFrame: 12, inFrame: 24, outFrame: 72, volume: .25 }), layer(ids[2], { muted: true })] };
    const results = [];
    for (const start of [0, .625]) {
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat() });
      await renderComposition(composition, output, { start, end: 3, signal: new AbortController().signal });
      const input = new Input({ source: new BlobSource(new Blob([output.target.buffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryAudioTrack(), rate = await track.getSampleRate(), data = new Float32Array(rate * 4);
        for await (const sample of new AudioSampleSink(track).samples()) {
          const values = new Float32Array(sample.numberOfFrames); sample.copyTo(values, { planeIndex: 0, format: 'f32-planar' });
          const offset = Math.round(sample.timestamp * rate); data.set(values.subarray(Math.max(0, -offset)), Math.max(0, offset)); sample.close();
        }
        const amplitude = (frequency: number, from: number, to: number) => {
          const first = Math.round((from - start) * rate), last = Math.round((to - start) * rate); let sin = 0, cos = 0;
          for (let i = first; i < last; i++) { sin += data[i] * Math.sin(i / rate * 2 * Math.PI * frequency); cos += data[i] * Math.cos(i / rate * 2 * Math.PI * frequency); }
          return 2 * Math.hypot(sin, cos) / (last - first);
        };
        results.push({ first: amplitude(440, .8, 1), second: amplitude(880, .8, 1), muted: amplitude(550, .8, 1), afterCut: amplitude(880, 1.7, 1.9), trimmed: amplitude(440, 1.7, 1.9), ended: amplitude(880, 2.7, 2.9) });
      } finally { input.dispose(); }
    }
    return results;
  });
  for (const result of results) {
    expect(result.first).toBeCloseTo(.1, 2); expect(result.second).toBeCloseTo(.05, 2); expect(result.afterCut).toBeCloseTo(.05, 2);
    expect(result.muted).toBeLessThan(.002); expect(result.trimmed).toBeLessThan(.002); expect(result.ended).toBeLessThan(.002);
  }
});

test('project layers remain audible together across shots and follow seek, speed, mute, pause and end', async ({ page }) => {
  await prepareAudio(page);
  await page.evaluate(async () => {
    const { CanvasFlowPlayback } = await import('/src/features/call-response/CanvasFlowPlayback.ts' as string);
    const { runtimeFlow, edge } = await import('/src/features/story-flow/model.ts' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const { clips } = (window as any).audioFixture;
    const media: { id: string; url: string }[] = [];
    for (const clip of clips.slice(0, 3)) { const asset = await assets.save(clip.blob, 'Audio'); const opened = await assets.open(asset.id); media.push({ ...asset, url: opened.url }); }
    const nodes = ['one', 'two', 'three'].map((id, index) => ({ id, name: id, kind: 'source', x: index * 100, y: 0, loopCount: 0, volume: 0, source: { assetId: media[1].id, inFrame: 0, outFrame: 48 } }));
    const graph = { version: 1, entryId: 'one', nodes, edges: [edge('one', 'two'), edge('two', 'three')], templates: [] };
    const flow = runtimeFlow(graph, [], media[1].id, 7);
    flow.audioLayers = [
      { id: 'music', name: 'Music', assetId: media[1].id, startFrame: 0, inFrame: 0, outFrame: 144, volume: .5, muted: false },
      { id: 'effect', name: 'Effect', assetId: media[0].id, startFrame: 48, inFrame: 0, outFrame: 24, volume: .25, muted: false },
    ];
    const video = document.createElement('video'); document.body.append(video);
    let ready = false, error = '';
    const playback = new CanvasFlowPlayback(flow, video, { id: media[1].id, assetId: media[1].id, name: 'Video', url: media[1].url }, (_session: any, buffering: boolean, failure?: string) => { ready = !buffering; error = failure ?? ''; }, { width: 160, height: 90, duration: 7, fps: 24, hasAudio: true, codec: 'avc' });
    const audio = (playback as any).decks.audio, analyser = audio.context.createAnalyser(); analyser.fftSize = 8192;
    const createGain = audio.context.createGain.bind(audio.context);
    audio.context.createGain = () => { const gain = createGain(); gain.connect(analyser); return gain; };
    const amplitude = (frequency: number) => {
      const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data); let sin = 0, cos = 0;
      for (let i = 0; i < data.length; i++) { sin += data[i] * Math.sin(i / audio.context.sampleRate * 2 * Math.PI * frequency); cos += data[i] * Math.cos(i / audio.context.sampleRate * 2 * Math.PI * frequency); }
      return 2 * Math.hypot(sin, cos) / data.length;
    };
    (window as any).layerPlayback = { playback, flow, amplitude, ready: () => ready, error: () => error, voices: () => [...audio.voices.keys()] };
    playback.seekScene('one', 36, true);
  });
  await expect.poll(() => page.evaluate(() => (window as any).layerPlayback.playback.session.sceneId)).toBe('two');
  // The analyser downmixes stereo to mono; each fixture puts a different tone in each channel.
  await expect.poll(() => page.evaluate(() => (window as any).layerPlayback.amplitude(880)), { intervals: [30, 50, 100] }).toBeGreaterThan(.035);
  await expect.poll(() => page.evaluate(() => (window as any).layerPlayback.amplitude(440)), { intervals: [30, 50, 100] }).toBeGreaterThan(.017);
  await expect.poll(() => page.evaluate(() => (window as any).layerPlayback.playback.session.elapsedFrames), { intervals: [100] }).toBeGreaterThan(76);
  expect(await page.evaluate(() => (window as any).layerPlayback.amplitude(440))).toBeLessThan(.005);
  expect(await page.evaluate(() => (window as any).layerPlayback.amplitude(880))).toBeGreaterThan(.035);
  await page.evaluate(() => { const t = (window as any).layerPlayback; t.playback.pause(); });
  await expect.poll(() => page.evaluate(() => (window as any).layerPlayback.amplitude(880))).toBeLessThan(.002);
  await page.evaluate(() => { const t = (window as any).layerPlayback; t.playback.seekScene('two', 6); t.playback.setSettings({ volume: 1, muted: false, speed: 2 }); t.playback.play(); });
  await expect.poll(() => page.evaluate(() => (window as any).layerPlayback.amplitude(1760)), { intervals: [30, 50, 100] }).toBeGreaterThan(.035);
  await page.evaluate(() => { const t = (window as any).layerPlayback; t.playback.setFlow({ ...t.flow, audioLayers: t.flow.audioLayers.map((layer: any) => ({ ...layer, muted: true })) }); });
  await expect.poll(() => page.evaluate(() => (window as any).layerPlayback.amplitude(1760))).toBeLessThan(.002);
  await page.evaluate(() => { const t = (window as any).layerPlayback; t.playback.setFlow(t.flow); t.playback.setSettings({ volume: 1, muted: true, speed: 1 }); t.playback.seekScene('two', 6, true); });
  await expect.poll(() => page.evaluate(() => (window as any).layerPlayback.amplitude(880))).toBeLessThan(.002);
  expect(await page.evaluate(() => (window as any).layerPlayback.error())).toBe('');
  await page.evaluate(() => (window as any).layerPlayback.playback.dispose());
});

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
        results.push({ rate, channels, maxGap, duration: await input.computeDuration(), expectedDuration: end - start, videoDuration: await (await input.getPrimaryVideoTrack()).computeDuration(),
          tones: [measure(.4, .8), measure(1.3, 1.8), measure(6.3, 6.8), measure(7.2, 7.8), measure(9.1, 9.6)],
          silence: [measure(8.1, 8.4), measure(8.6, 8.9)] });
      } finally { input.dispose(); }
    }
    return results;
  });
  for (const result of results) {
    expect(result.rate).toBe(48000); expect(result.channels).toBe(2);
    expect(result.maxGap).toBeLessThan(1 / 48000 + .000001);
    // AAC encoders add priming and whole-packet padding (up to four 1024-sample packets).
    expect(result.videoDuration).toBeCloseTo(result.expectedDuration, 5);
    expect(Math.abs(result.duration - result.expectedDuration)).toBeLessThan(4096 / result.rate);
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
        results.push({ held, rate: await track.getSampleRate(), channels: await track.getNumberOfChannels(), duration: await input.computeDuration(), videoDuration: await (await input.getPrimaryVideoTrack()).computeDuration(), rms });
      } finally { input.dispose(); }
    }
    return results;
  });
  for (const result of results) {
    expect(result.rate).toBe(48000); expect(result.channels).toBe(2); expect(result.videoDuration).toBeCloseTo(2, 5); expect(Math.abs(result.duration - 2)).toBeLessThan(4096 / result.rate);
    if (result.held) expect(result.rms).toBeLessThan(.001); else expect(result.rms).toBeGreaterThan(.1);
  }
});

test('Idle uses audio from the full render while keeping the finished loop video', async ({ page }) => {
  await prepareAudio(page);
  await page.evaluate(async () => {
    const { CanvasMediaDecks } = await import('/src/features/player/CanvasMediaDecks.ts' as string);
    const clips = (window as any).audioFixture.clips;
    const video = document.createElement('video'); document.body.append(video);
    const decks = new CanvasMediaDecks(video, { width: 160, height: 90, duration: 1, fps: 24, hasAudio: false, codec: 'avc' }, false);
    const audio = (decks as any).audio, analyser = audio.context.createAnalyser(); analyser.fftSize = 2048;
    const createGain = audio.context.createGain.bind(audio.context);
    audio.context.createGain = () => { const gain = createGain(); gain.connect(analyser); return gain; };
    const state = { decks, enabled: true, ready: false, rms: () => {
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    } };
    const start = audio.context.currentTime;
    const timer = setInterval(() => {
      const frame = (audio.context.currentTime - start) % .9;
      state.ready = decks.render([{ key: 'idle:body', source: clips[3].source, sourceFootage: false,
        time: frame, muted: !state.enabled, opacity: 1, gain: 1,
        audio: { key: 'idle:audio', source: clips[1].source, time: 2 + frame } }], true,
      { volume: 1, muted: false, speed: 1 });
    }, 16);
    (window as any).idleAudioTest = { ...state, stop: () => { clearInterval(timer); decks.dispose(); }, setEnabled: (value: boolean) => { state.enabled = value; },
      getReady: () => state.ready, getVideo: () => decks.layers[0]?.source.url === clips[3].source.url };
  });
  await expect.poll(() => page.evaluate(() => (window as any).idleAudioTest.getReady()), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).idleAudioTest.rms()), { timeout: 20_000 }).toBeGreaterThan(.05);
  expect(await page.evaluate(() => (window as any).idleAudioTest.getVideo())).toBe(true);
  await page.evaluate(() => (window as any).idleAudioTest.setEnabled(false));
  await expect.poll(() => page.evaluate(() => (window as any).idleAudioTest.rms())).toBeLessThan(.001);
  await page.evaluate(() => (window as any).idleAudioTest.stop());
});

test('Idle soundtrack loops on the playback clock and follows pause, mute and exit', async ({ page }) => {
  await page.route('**/__music-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Music test</title>' }));
  await page.goto('/__music-test');
  await page.evaluate(async () => {
    const { CanvasAudio } = await import('/src/features/player/CanvasAudio.ts' as string);
    const { default: url } = await import('/assets/working-something-out-loop.wav?url' as string);
    const audio = new CanvasAudio();
    await audio.prepareMusic(url);
    const analyser = audio.context.createAnalyser(); analyser.fftSize = 2048;
    const createGain = audio.context.createGain.bind(audio.context);
    audio.context.createGain = () => { const gain = createGain(); gain.connect(analyser); return gain; };
    const sources: AudioBufferSourceNode[] = [];
    const createSource = audio.context.createBufferSource.bind(audio.context);
    audio.context.createBufferSource = () => { const source = createSource(); sources.push(source); return source; };
    await audio.context.resume();
    audio.renderMusic(true, true, .4, 1);
    (window as any).musicTest = { audio, sources, rms: () => {
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    } };
  });
  await expect.poll(() => page.evaluate(() => (window as any).musicTest.rms())).toBeGreaterThan(.01);
  const soundtrack = await page.evaluate(() => {
    const source = (window as any).musicTest.sources[0] as AudioBufferSourceNode;
    return { loop: source.loop, duration: source.buffer!.duration, sampleRate: source.buffer!.sampleRate };
  });
  expect(soundtrack.loop).toBe(true);
  // AudioContext resampling rounds the buffer length to a whole sample.
  expect(Math.abs(soundtrack.duration - 29.84)).toBeLessThanOrEqual(1 / soundtrack.sampleRate);
  await page.evaluate(() => (window as any).musicTest.audio.renderMusic(true, true, 0, 1));
  await expect.poll(() => page.evaluate(() => (window as any).musicTest.rms())).toBeLessThan(.001);
  await page.evaluate(() => (window as any).musicTest.audio.renderMusic(true, true, .4, 1));
  await expect.poll(() => page.evaluate(() => (window as any).musicTest.rms())).toBeGreaterThan(.01);
  await page.evaluate(() => (window as any).musicTest.audio.pause());
  await expect.poll(() => page.evaluate(() => (window as any).musicTest.rms())).toBeLessThan(.001);
  await page.evaluate(() => (window as any).musicTest.audio.renderMusic(true, true, .4, 1.5));
  await expect.poll(() => page.evaluate(() => (window as any).musicTest.rms())).toBeGreaterThan(.01);
  expect(await page.evaluate(() => (window as any).musicTest.sources.at(-1).playbackRate.value)).toBe(1.5);
  await page.evaluate(() => (window as any).musicTest.audio.renderMusic(false, true, 0, 1));
  await expect.poll(() => page.evaluate(() => (window as any).musicTest.rms())).toBeLessThan(.001);
  await page.evaluate(() => (window as any).musicTest.audio.dispose());
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
    const rates = new Set<number>(), createBufferSource = audio.context.createBufferSource.bind(audio.context);
    audio.context.createBufferSource = () => {
      const source = createBufferSource(), start = source.start.bind(source);
      source.start = (...args: Parameters<AudioBufferSourceNode['start']>) => { rates.add(source.buffer!.sampleRate); start(...args); };
      return source;
    };
    (state as any).scheduledRates = () => ({ actual: [...rates], expected: audio.context.sampleRate });
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
  const rates = await page.evaluate(() => (window as any).audioPlayback.scheduledRates());
  expect(rates.actual).toEqual([rates.expected]);
  expect(errors).toEqual([]);
  await page.evaluate(() => { (window as any).audioPlayback.stream.dispose(); });
});
