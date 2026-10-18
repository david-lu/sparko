import { expect, test, type Page } from '@playwright/test';
import type { FlowEdge, PlaybackSession } from '../../src/features/call-response/model';

async function setup(page: Page, { retry = false, mismatch = false, native = false, references = false } = {}) {
  await page.route('**/__flow-buffering', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div style="position:relative;width:640px;height:480px"><video muted playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"></video></div>' }));
  await page.goto('/__flow-buffering');
  return page.evaluate(async ({ retry, mismatch, native, references }) => {
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
      const generated = !['intro', 'continue'].includes(scene.id);
      const source = !generated ? original : await make(colors[scene.id], references ? 2 : 1, scene.id === 'correct' ? 32000 : 44100, mismatch ? 100 : 96);
      const inFrame = scene.id === 'continue' ? 24 : generated && references ? 12 : 0;
      scene.clip = { ...scene.clip, assetId: source.id, inFrame, outFrame: inFrame + 24 };
      if (generated) scene.generated = { url: assets.url(source.id), start: inFrame / 24, duration: 1, totalDuration: references ? 2 : 1 };
      if (references && scene.id === 'wait') scene.generated = { ...scene.generated!, fullAssetId: source.id,
        fullRange: { start: .5, duration: 1, totalDuration: 2 } };
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
  }, { retry, mismatch, native, references });
}
const read = (page: Page) => page.evaluate(() => { const s = (window as any).flowBufferTest; return { ...s.playback.session, encoded: s.encoded, activeTime: s.playback.playback.decks.layers.at(-1)?.time, sourceTime: s.playback.sourceTime, buffering: s.buffering, error: s.error, loads: s.loadstarts, seeks: s.seeks, waiting: s.waiting, scenes: s.scenes }; });
const fast = { timeout: 15_000, intervals: [50, 100, 150] };

const activePixel = async (page: Page, x = 0, y = 48) => {
  const screenshot = await page.locator('canvas.playback-canvas').screenshot();
  return page.evaluate(async ({ base64, x, y }) => {
    const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
    const canvas = new OffscreenCanvas(img.width, img.height), ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const scale = Math.min(img.width / 160, img.height / 96);
    return [...ctx.getImageData((img.width - 160 * scale) / 2 + x * scale, (img.height - 96 * scale) / 2 + y * scale, 1, 1).data];
  }, { base64: screenshot.toString('base64'), x, y });
};

test('Call Response crossfades blend GPU video and audio gains and toggle without moving the playhead', async ({ page }) => {
  const third = await setup(page, { native: true, references: true });
  // Finish preparation of every alternative before checking that fade edits reuse it.
  for (const id of ['call', 'wait', 'correct', 'incorrect', third.thirdScene]) {
    await page.evaluate(id => (window as any).flowBufferTest.playback.seekScene(id, 12), id);
    await expect.poll(async () => (await read(page)).buffering).toBe(false);
  }
  const blend = async () => {
    const layers = await page.evaluate(() => {
      const decks = (window as any).flowBufferTest.playback.playback.decks;
      return (decks.layers as { key: string; opacity: number; gain: number; muted?: boolean }[]).map(layer =>
        ({ clip: layer.key, opacity: layer.opacity, volume: layer.gain, muted: !!layer.muted }));
    });
    return { layers, pixel: await activePixel(page, 80) };
  };
  for (const [scene, frame, before, after] of [['intro', 22, 'intro', 'call'], ['continue', 2, 'correct', 'continue']] as const) {
    await page.evaluate(({ scene, frame }) => (window as any).flowBufferTest.playback.seekScene(scene, frame), { scene, frame });
    await expect.poll(async () => (await read(page)).buffering).toBe(false);
    const rendered = await blend();
    expect(rendered.layers.map(layer => layer.clip!.split(':')[0])).toEqual([before, after]);
    expect(rendered.layers.map(layer => layer.opacity)).toEqual([1, .5]);
    expect(rendered.layers.map(layer => layer.volume)).toEqual([.5, .5]);
    expect(rendered.layers.every(layer => !layer.muted)).toBe(true);
    if (scene === 'intro') { expect(rendered.pixel[0]).toBeGreaterThan(200); expect(rendered.pixel[1]).toBeGreaterThan(80); expect(rendered.pixel[1]).toBeLessThan(160); }
    if (scene === 'continue') { expect(rendered.pixel[0]).toBeGreaterThan(80); expect(rendered.pixel[1]).toBeGreaterThan(80); expect(rendered.pixel[2]).toBeLessThan(20); }
  }
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('call', 22));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await blend()).layers).toMatchObject([
    { clip: 'call:0:body', opacity: 1, volume: .5, muted: false },
    { clip: 'wait:1:reference', opacity: .5, volume: 0, muted: true },
  ]);
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('correct', 2));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await blend()).layers.map(layer => ({ clip: layer.clip!.split(':')[0], opacity: layer.opacity, volume: layer.volume, muted: layer.muted }))).toEqual([
    { clip: 'correct', opacity: 1, volume: 1, muted: false },
  ]);
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('intro', 22));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  const original = await read(page);
  await page.evaluate(() => (window as any).flowBufferTest.playback.setCrossfade(false));
  await expect.poll(async () => (await blend()).layers.length).toBe(1);
  expect((await blend()).pixel[1]).toBeLessThan(20);
  await page.evaluate(() => (window as any).flowBufferTest.playback.setCrossfade(true));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await blend()).layers).toHaveLength(2);
  expect(await read(page)).toMatchObject({ sceneId: original.sceneId, frame: original.frame, visit: original.visit, playing: false, encoded: original.encoded, error: '' });
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('intro', 18));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await blend()).layers).toHaveLength(1);
  await page.evaluate(() => (window as any).flowBufferTest.playback.setCrossfade(true, 12));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await blend()).layers.map(layer => layer.opacity)).toEqual([1, .5]);
  expect((await blend()).layers.map(layer => layer.volume)).toEqual([.5, .5]);
  expect(await read(page)).toMatchObject({ sceneId: 'intro', frame: 18, playing: false, encoded: original.encoded });
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('continue', 3));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await blend()).layers.map(layer => layer.opacity)).toEqual([1, .25]);
  expect((await blend()).layers.map(layer => layer.volume)).toEqual([.75, .25]);
  await page.evaluate(() => (window as any).flowBufferTest.playback.setCrossfade(true, 4));
  for (const [scene, frames] of [['call', [0, 1, 10]], ['wait', [0, 1, 22, 23]], ['correct', [6, 22, 23]], ['incorrect', [6, 22, 23]]] as const) for (const frame of frames) {
    await page.evaluate(({ scene, frame }) => (window as any).flowBufferTest.playback.seekScene(scene, frame), { scene, frame });
    await expect.poll(async () => (await read(page)).buffering).toBe(false);
    const rendered = await blend();
    expect(rendered.layers).toHaveLength(1);
    expect(rendered.layers[0]).toMatchObject({ opacity: 1, volume: scene === 'wait' ? 0 : 1, muted: scene === 'wait' });
  }
  await page.evaluate(() => { const p = (window as any).flowBufferTest.playback; p.seekScene('wait', 23); p.branch('wait', 'incorrect'); p.pause(); });
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await blend()).layers).toMatchObject([
    { clip: 'wait:0:reference', muted: true, opacity: 1 },
    { clip: 'incorrect:1:body', muted: true, opacity: 0 },
  ]);
  await page.evaluate(() => { const p = (window as any).flowBufferTest.playback; p.seekScene('wait', 22); p.branch('wait', 'incorrect'); p.pause(); });
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  const idleExit = await page.evaluate(() => (window as any).flowBufferTest.playback.playback.decks.layers.map((layer: { key: string; time: number }) => ({ key: layer.key, time: layer.time })));
  expect(idleExit[0]).toMatchObject({ key: 'wait:0:reference' });
  expect(idleExit[0].time).toBeCloseTo(2 - 2 / 24);
  expect(idleExit[1].time).toBeCloseTo(.5 - 2 / 24);
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('incorrect', 0));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await blend()).layers).toHaveLength(1);
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});

test('framing changes preserve the canvas playhead, speed and pending response', async ({ page }) => {
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
    expect(await page.evaluate(() => { const p = (window as any).flowBufferTest.playback; return [p.canvas.width, p.canvas.height, p.playback.settings.speed]; })).toEqual([160, 96, 1.25]);
  }
  await page.evaluate(() => (window as any).flowBufferTest.playback.play());
  await expect.poll(async () => (await read(page)).sceneId, fast).toBe('correct');
  await expect.poll(async () => (await activePixel(page))[1]).toBeGreaterThan(200);
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});

test('canvas playback works without MediaSource and returns to the source frames', async ({ page }) => {
  await setup(page, { native: true });
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  await expect(page.locator('canvas')).toHaveAttribute('data-renderer', 'webgpu');
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('correct', 12));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await read(page)).activeTime).toBe(.5);
  expect((await activePixel(page, 80))[1]).toBeGreaterThan(200);
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('continue', 12));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await read(page)).activeTime).toBe(1.5);
  expect((await activePixel(page, 80))[0]).toBeGreaterThan(200);
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});

test('idle loops and branches reuse generated media without encoding the source', async ({ page }) => {
  const third = await setup(page);
  expect((await read(page)).encoded).toBe(0);
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
  // Preview decodes the original assets directly, including mixed audio sample rates.
  expect(result.encoded).toBe(0);
  expect(result.scenes).toEqual(['intro', 'call', 'wait', third.thirdScene, 'continue']);
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});

for (const loopAudio of [false, true]) test(`Idle ${loopAudio ? 'with' : 'without'} source audio stays buffered across repeated loop boundaries`, async ({ page }) => {
  await setup(page, { references: true });
  await page.evaluate(loopAudio => {
    const state = (window as any).flowBufferTest;
    const idle = state.flow.scenes.find((scene: { id: string }) => scene.id === 'wait');
    idle.loopAudio = loopAudio;
    // The saved finished loop is gray; the full original is green.
    idle.generated.fullAssetId = state.flow.scenes.find((scene: { id: string }) => scene.id === 'correct').clip.assetId;
    state.playback.setFlow(state.flow);
    state.playback.seekScene('wait', 0);
  }, loopAudio);
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect((await activePixel(page, 80))[1]).toBeGreaterThan(180);
  await page.evaluate(() => {
    const state = (window as any).flowBufferTest;
    state.loopEvents = [];
    const player = state.playback.playback;
    const changed = player.changed;
    player.changed = (session: PlaybackSession, buffering: boolean, error?: string) => {
      if (session.sceneId === 'wait') state.loopEvents.push({ visit: session.visit, frame: session.frame, buffering });
      changed(session, buffering, error);
    };
    state.playback.play();
  });
  await expect.poll(async () => (await read(page)).loopIteration, fast).toBeGreaterThanOrEqual(4);
  const events = await page.evaluate(() => {
    const state = (window as any).flowBufferTest;
    state.playback.pause();
    return state.loopEvents as { visit: number; frame: number; buffering: boolean }[];
  });
  expect(events.filter(event => event.visit > 0 && event.frame < 2 && event.buffering)).toEqual([]);
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});

test('retrying a response, rapid seeking and source subtitles stay tied to the shared audio clock', async ({ page }) => {
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
  await page.evaluate(() => (window as any).flowBufferTest.playback.seekScene('continue', 12));
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  await expect(page.locator('.playback-captions')).toContainText('Source continuation');
  await page.evaluate(() => { const p = (window as any).flowBufferTest.playback; p.seekScene('correct', 10); p.seekScene('incorrect', 8); p.seekScene('wait', 12); });
  await expect.poll(async () => (await read(page)).buffering).toBe(false);
  expect(await read(page)).toMatchObject({ sceneId: 'wait', frame: 12, sourceTime: .5, activeTime: .5, playing: false, error: '' });
  expect(await page.evaluate(() => (window as any).flowBufferTest.playback.video.textTracks[0].mode)).toBe('hidden');
  await expect(page.locator('.playback-captions')).toBeEmpty();
  await page.evaluate(() => (window as any).flowBufferTest.playback.dispose());
});
