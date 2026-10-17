import { expect, test, type Page } from '@playwright/test';
import type { FlowEdge, PlaybackSession } from '../../src/features/call-response/model';

async function setup(page: Page, { retry = false, mismatch = false, native = false } = {}) {
  await page.route('**/__flow-buffering', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div style="position:relative;width:640px;height:480px"><video muted playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"></video></div>' }));
  await page.goto('/__flow-buffering');
  return page.evaluate(async ({ retry, mismatch, native }) => {
    const { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { FlowPlayback } = await import('/src/features/call-response/FlowPlayback.ts' as string);
    const { createTestFlow, addAnswer } = await import('/src/features/call-response/model.ts' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const make = async (color: string, duration: number, rate: number, height = 96, fps = 24) => {
      const canvas = new OffscreenCanvas(160, height), ctx = canvas.getContext('2d')!;
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
      const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 100_000 }), audio = new AudioBufferSource({ codec: 'pcm-f32' });
      output.addVideoTrack(video, { frameRate: fps }); output.addAudioTrack(audio); await output.start();
      await Promise.all([
        (async () => { for (let frame = 0; frame < duration * fps; frame++) { ctx.fillStyle = color; ctx.fillRect(0, 0, 160, height); for (let bit = 0; bit < 5; bit++) { ctx.fillStyle = (frame % 24) & (1 << bit) ? '#fff' : '#000'; ctx.fillRect(bit * 5, 0, 5, 10); } await video.add(frame / fps, 1 / fps); } video.close(); })(),
        (async () => { const samples = new AudioBuffer({ sampleRate: rate, numberOfChannels: 2, length: duration * rate }); for (let channel = 0; channel < 2; channel++) { const data = samples.getChannelData(channel); for (let i = 0; i < data.length; i++) data[i] = .05 * Math.sin(i / rate * 2 * Math.PI * 440); } await audio.add(samples); audio.close(); })(),
      ]);
      await output.finalize(); const asset = await assets.save(new Blob([output.target.buffer], { type: 'video/mp4' }), color); await assets.open(asset.id); return asset;
    };
    let flow = addAnswer(createTestFlow()); const third = flow.interaction.answers.at(-1)!;
    const original = await make('#ee0000', 2, 48000, 96, 25);
    const colors: Record<string, string> = { intro: '#ee0000', call: '#eeee00', wait: '#444444', correct: '#00ee00', incorrect: '#0000ee', continue: '#ee0000', [third.sceneId]: '#ee00ee' };
    for (const scene of flow.scenes) {
      const source = ['intro', 'continue'].includes(scene.id) ? original : await make(colors[scene.id], 1, scene.id === 'correct' ? 32000 : 44100, mismatch ? 100 : 96);
      scene.clip = { ...scene.clip, assetId: source.id, inFrame: scene.id === 'continue' ? 24 : 0, outFrame: scene.id === 'continue' ? 48 : 24 };
      scene.draft = false; scene.plannedFrames = undefined;
    }
    if (retry) flow.edges.find((edge: FlowEdge) => edge.id === 'incorrect-continue')!.to = 'wait';
    const video = document.querySelector('video')!; video.muted = true;
    if (native) Object.defineProperty(window, 'MediaSource', { value: undefined, configurable: true });
    const state = { encoded: 0, playback: null as any, buffering: true, error: '', loadstarts: 0, seeks: 0, waiting: 0, times: [] as number[], scenes: [] as string[], third, flow };
    for (const [event, field] of [['loadstart', 'loadstarts'], ['seeking', 'seeks'], ['waiting', 'waiting']]) video.addEventListener(event, () => (state as any)[field]++);
    const encode = VideoEncoder.prototype.encode; VideoEncoder.prototype.encode = function (...args) { state.encoded++; return encode.apply(this, args); }; state.playback = new FlowPlayback(flow, video, { id: 'original', assetId: original.id, name: 'Original', url: assets.url(original.id) }, (session: PlaybackSession, buffering: boolean, error?: string) => {
      state.buffering = buffering; if (error) state.error = error;
      if (state.scenes.at(-1) !== session.sceneId) state.scenes.push(session.sceneId);
      state.times.push(video.currentTime);
    }, { width: 160, height: 96, duration: 2, fps: 25, codec: 'avc', hasAudio: true });
    (window as any).flowBufferTest = state;
    return { thirdId: third.id, thirdScene: third.sceneId };
  }, { retry, mismatch, native });
}
const read = (page: Page) => page.evaluate(() => { const s = (window as any).flowBufferTest; return { ...s.playback.session, encoded: s.encoded, activeTime: s.playback.video.currentTime, sourceTime: s.playback.sourceTime, buffering: s.buffering, error: s.error, loads: s.loadstarts, seeks: s.seeks, waiting: s.waiting, scenes: s.scenes }; });
const fast = { timeout: 15_000, intervals: [50, 100, 150] };

const activePixel = (page: Page, x = 0, y = 48) => page.evaluate(({ x, y }) => {
  const video = (window as any).flowBufferTest.playback.video as HTMLVideoElement;
  const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight), ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0); return [...ctx.getImageData(x, y, 1, 1).data];
}, { x, y });

test('framing changes preserve the native playhead, speed and pending response', async ({ page }) => {
  await setup(page, { mismatch: true });
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('wait', 12));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  await page.evaluate(() => { const p = (window as any).flowBufferTest.playback; p.branch('wait', 'correct'); p.pause(); p.setSettings({ volume: .6, muted: true, speed: 1.25 }); });
  const before = await read(page);
  expect(before).toMatchObject({ sceneId: 'wait', frame: 12, outcome: 'correct', playing: false });
  expect((await activePixel(page))[1]).toBeLessThan(15);
  for (const enabled of [true, false, true]) {
    await page.evaluate(value => (window as any).flowBufferTest.playback.setMatchFraming(value), enabled);
    await expect.poll(async () => (await read(page)).buffering).toBe(false);
    expect(await read(page)).toMatchObject({ sceneId: 'wait', frame: before.frame, outcome: 'correct', playing: false,
      visit: before.visit, attempts: before.attempts, loopIteration: before.loopIteration, error: '' });
    if (enabled) await expect.poll(async () => (await activePixel(page))[1]).toBeGreaterThan(40);
    else await expect.poll(async () => (await activePixel(page))[1]).toBeLessThan(15);
    expect(await page.evaluate(() => { const v = (window as any).flowBufferTest.playback.video; return [v.videoWidth, v.videoHeight, v.playbackRate]; })).toEqual([160, 96, 1.25]);
  }
  await page.evaluate(() => (window as any).flowBufferTest.playback.play());
  await expect.poll(async () => (await read(page)).sceneId, fast).toBe('correct');
  await expect.poll(async () => (await activePixel(page))[1]).toBeGreaterThan(200);
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});

test('native playback also works without MediaSource and returns to the original source URL', async ({ page }) => {
  await setup(page, { native: true });
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  const original = await page.evaluate(() => (window as any).flowBufferTest.playback.video.currentSrc);
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('correct', 12));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await read(page)).activeTime).toBe(.5);
  expect((await activePixel(page, 80))[1]).toBeGreaterThan(200);
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('continue', 12));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await read(page)).activeTime).toBe(1.5);
  expect(await page.evaluate(() => (window as any).flowBufferTest.playback.video.currentSrc)).toBe(original);
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});

test('idle loops and branches reuse generated media without encoding the source', async ({ page }) => {
  const third = await setup(page);
  await expect.poll(async () => (await read(page)).encoded, { timeout: 30_000 }).toBeGreaterThanOrEqual(125);
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  await page.evaluate(() => (window as any).flowBufferTest.playback.play());
  await expect.poll(async () => (await read(page)).loopIteration, fast).toBeGreaterThanOrEqual(3);
  await page.evaluate(id => (window as any).flowBufferTest.playback.branch('wait', id), third.thirdId);
  await expect.poll(async () => (await read(page)).sceneId, fast).toBe(third.thirdScene);
  await expect.poll(async () => (await read(page)).frame, fast).toBeGreaterThanOrEqual(3);
  const color = await activePixel(page, 80);
  expect(color[0]).toBeGreaterThan(180); expect(color[2]).toBeGreaterThan(180); expect(color[1]).toBeLessThan(40);
  await expect.poll(async () => (await read(page)).finished).toBe(true);
  const result = await read(page); expect(result.error).toBe('');
  // Five one-second inserts; the encoder may pad the last frame beside an audio packet.
  expect(result.encoded).toBeLessThanOrEqual(130);
  expect(result.scenes).toEqual(['intro', 'call', 'wait', third.thirdScene, 'continue']);
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});

test('retrying a response, rapid seeking and source subtitles stay tied to the native scene clock', async ({ page }) => {
  await setup(page, { retry: true });
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  await page.evaluate(() => {
    const s = (window as any).flowBufferTest;
    const track = document.querySelector('video')!.addTextTrack('subtitles', 'Source captions');
    s.playback.setSubtitles(track, [new VTTCue(.25, .75, 'Intro source'), new VTTCue(1.25, 1.75, 'Source continuation')]);
    s.playback.seekScene('wait', 18, true);
  });
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  await page.evaluate(() => (window as any).flowBufferTest.playback.branch('wait', 'incorrect'));
  await expect.poll(async () => (await read(page)).sceneId, fast).toBe('incorrect');
  await expect.poll(async () => (await read(page)).sceneId, fast).toBe('wait');
  expect((await read(page)).outcome).toBeNull();
  await page.evaluate(() => (window as any).flowBufferTest.playback.branch('wait', 'correct'));
  await expect.poll(async () => (await read(page)).sceneId, fast).toBe('correct');
  await expect.poll(async () => (await read(page)).finished).toBe(true);
  expect(await page.evaluate(() => {
    const track = (window as any).flowBufferTest.playback.video.textTracks[0];
    return { mode: track.mode, cues: Array.from(track.cues as TextTrackCueList).map(cue => [cue.startTime, cue.endTime]) };
  })).toEqual({ mode: 'showing', cues: [[.25, .75], [1.25, 1.75]] });
  await page.evaluate(() => { const p = (window as any).flowBufferTest.playback; p.seekScene('correct', 10); p.seekScene('incorrect', 8); p.seekScene('wait', 12); });
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect(await read(page)).toMatchObject({ sceneId: 'wait', frame: 12, sourceTime: .5, activeTime: .5, playing: false, error: '' });
  expect(await page.evaluate(() => (window as any).flowBufferTest.playback.video.textTracks[0].mode)).toBe('hidden');
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});
