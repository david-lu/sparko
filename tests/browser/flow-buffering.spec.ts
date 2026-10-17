import { expect, test, type Page } from '@playwright/test';
import type { FlowEdge, PlaybackSession } from '../../src/features/call-response/model';

async function setup(page: Page, retry = false) {
  await page.route('**/__flow-buffering', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><video muted playsinline></video>' }));
  await page.goto('/__flow-buffering');
  return page.evaluate(async retry => {
    const { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { FlowPlayback } = await import('/src/features/call-response/FlowPlayback.ts' as string);
    const { createTestFlow, addAnswer } = await import('/src/features/call-response/model.ts' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const make = async (color: string, duration: number, rate: number) => {
      const canvas = new OffscreenCanvas(160, 96), ctx = canvas.getContext('2d')!;
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
      const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 100_000 }), audio = new AudioBufferSource({ codec: 'pcm-f32' });
      output.addVideoTrack(video, { frameRate: 24 }); output.addAudioTrack(audio); await output.start();
      await Promise.all([
        (async () => { for (let frame = 0; frame < duration * 24; frame++) { ctx.fillStyle = color; ctx.fillRect(0, 0, 160, 96); for (let bit = 0; bit < 5; bit++) { ctx.fillStyle = (frame % 24) & (1 << bit) ? '#fff' : '#000'; ctx.fillRect(bit * 5, 0, 5, 10); } await video.add(frame / 24, 1 / 24); } video.close(); })(),
        (async () => { const samples = new AudioBuffer({ sampleRate: rate, numberOfChannels: 2, length: duration * rate }); for (let channel = 0; channel < 2; channel++) { const data = samples.getChannelData(channel); for (let i = 0; i < data.length; i++) data[i] = .05 * Math.sin(i / rate * 2 * Math.PI * 440); } await audio.add(samples); audio.close(); })(),
      ]);
      await output.finalize(); const asset = await assets.save(new Blob([output.target.buffer], { type: 'video/mp4' }), color); await assets.open(asset.id); return asset;
    };
    let flow = addAnswer(createTestFlow()); const third = flow.interaction.answers.at(-1)!;
    const original = await make('#ee0000', 2, 48000);
    const colors: Record<string, string> = { intro: '#ee0000', call: '#eeee00', wait: '#444444', correct: '#00ee00', incorrect: '#0000ee', continue: '#ee0000', [third.sceneId]: '#ee00ee' };
    for (const scene of flow.scenes) { const source = ['intro', 'continue'].includes(scene.id) ? original : await make(colors[scene.id], 1, scene.id === 'correct' ? 32000 : 44100); scene.clip = { ...scene.clip, assetId: source.id, inFrame: scene.id === 'continue' ? 24 : 0, outFrame: scene.id === 'continue' ? 48 : 24 }; }
    if (retry) flow.edges.find((edge: FlowEdge) => edge.id === 'incorrect-continue')!.to = 'wait';
    const video = document.querySelector('video')!; video.muted = true;
    const state = { playback: null as any, buffering: true, error: '', loadstarts: 0, seeks: 0, waiting: 0, times: [] as number[], scenes: [] as string[], third, flow };
    for (const [event, field] of [['loadstart', 'loadstarts'], ['seeking', 'seeks'], ['waiting', 'waiting']]) video.addEventListener(event, () => (state as any)[field]++);
    state.playback = new FlowPlayback(flow, video, { id: 'original', assetId: original.id, name: 'Original', url: assets.url(original.id) }, (session: PlaybackSession, buffering: boolean, error?: string) => {
      state.buffering = buffering; if (error) state.error = error;
      if (state.scenes.at(-1) !== session.sceneId) state.scenes.push(session.sceneId);
      state.times.push(video.currentTime);
    }, { width: 160, height: 96, duration: 2, fps: 24, codec: 'avc', hasAudio: true });
    (window as any).flowBufferTest = state;
    return { thirdId: third.id, thirdScene: third.sceneId };
  }, retry);
}
const read = (page: Page) => page.evaluate(() => { const s = (window as any).flowBufferTest; return { ...s.playback.session, ...s.playback.diagnostics, sourceTime: s.playback.sourceTime, buffering: s.buffering, error: s.error, loads: s.loadstarts, seeks: s.seeks, waiting: s.waiting, scenes: s.scenes }; });
const fast = { timeout: 15_000, intervals: [50, 100, 150] };

test('idle loops and every response are prepared, then a selected branch plays without reload or seek', async ({ page }) => {
  const third = await setup(page);
  await expect.poll(async () => (await read(page)).preparedScenes, { timeout: 30_000 }).toEqual(expect.arrayContaining(['wait', 'correct', 'incorrect', third.thirdScene]));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  await page.evaluate(() => { const s = (window as any).flowBufferTest; s.waiting = 0; s.playback.play(); });
  await expect.poll(async () => (await read(page)).loopIteration, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
  await page.evaluate(id => (window as any).flowBufferTest.playback.branch('wait', id), third.thirdId);
  await expect.poll(async () => (await read(page)).sceneId, fast).toBe(third.thirdScene);
  await expect.poll(async () => (await read(page)).frame, fast).toBeGreaterThanOrEqual(3);
  const color = await page.locator('video').evaluate(video => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d')!; ctx.drawImage(video as HTMLVideoElement, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; });
  expect(color[0]).toBeGreaterThan(180); expect(color[2]).toBeGreaterThan(180); expect(color[1]).toBeLessThan(40);
  await expect.poll(async () => (await read(page)).finished).toBe(true);
  const result = await read(page); expect(result.error).toBe(''); expect(result.loads).toBe(1); expect(result.seeks).toBe(0); expect(result.waiting).toBe(0);
  expect(result.scenes).toEqual(['intro', 'call', 'wait', third.thirdScene, 'continue']);
  expect(await page.evaluate(() => { const times: number[] = (window as any).flowBufferTest.times; return times.every((time, i) => i === 0 || time >= times[i - 1]); })).toBe(true);
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});

test('a response can retry the idle loop, and explicit seeking reuses prepared assets without stale playback', async ({ page }) => {
  await setup(page, true);
  await expect.poll(async () => (await read(page)).preparedScenes, { timeout: 30_000 }).toContain('incorrect');
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  const initialCues = await page.evaluate(() => {
    const s = (window as any).flowBufferTest;
    const track = document.querySelector('video')!.addTextTrack('subtitles', 'Source captions');
    track.mode = 'hidden'; s.captions = track;
    s.playback.setSubtitles(track, [new VTTCue(.25, .75, 'Intro source'), new VTTCue(1.25, 1.75, 'Source continuation')]);
    return Array.from(track.cues || []).map(cue => [cue.startTime, cue.endTime, (cue as VTTCue).text]);
  });
  expect(initialCues).toEqual([[.25, .75, 'Intro source']]);
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('wait', 18, true));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  await page.evaluate(() => (window as any).flowBufferTest.playback.branch('wait', 'incorrect'));
  await expect.poll(async () => (await read(page)).sceneId, fast).toBe('incorrect');
  await expect.poll(async () => (await read(page)).sceneId, fast).toBe('wait');
  expect((await read(page)).outcome).toBeNull();
  await page.evaluate(() => (window as any).flowBufferTest.playback.branch('wait', 'correct'));
  await expect.poll(async () => (await read(page)).sceneId, fast).toBe('correct');
  await expect.poll(async () => (await read(page)).finished).toBe(true);
  const continuationCues = await page.evaluate(() => Array.from((window as any).flowBufferTest.captions.cues as TextTrackCueList).filter(cue => (cue as VTTCue).text === 'Source continuation').map(cue => [cue.startTime, cue.endTime]));
  expect(continuationCues).toHaveLength(1);
  expect(continuationCues[0][0]).toBeGreaterThan(1.25);
  expect(continuationCues[0][1] - continuationCues[0][0]).toBeCloseTo(.5);
  await page.evaluate(() => { const p = (window as any).flowBufferTest.playback; p.seekScene('correct', 10); p.seekScene('incorrect', 8); p.seekScene('wait', 12); });
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect(await read(page)).toMatchObject({ sceneId: 'wait', frame: 12, sourceTime: .5, playing: false, error: '' });
  expect(await page.evaluate(() => (window as any).flowBufferTest.captions.cues.length)).toBe(0);
  const displayedFrame = await page.locator('video').evaluate(video => {
    const canvas = document.createElement('canvas'); canvas.width = 25; canvas.height = 10;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(video as HTMLVideoElement, 0, 0);
    return Array.from({ length: 5 }, (_, bit) => ctx.getImageData(bit * 5 + 2, 4, 1, 1).data[0] > 128 ? 1 << bit : 0).reduce((frame, bit) => frame | bit, 0);
  });
  expect(displayedFrame).toBe(12);
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});
