import { test, expect, openVideo, addBridge, openGenerationTimeline, closeGenerationTimeline, readProject, saveAndReopen, dragIntoView, type Page } from './fixtures';
import { wavFixture } from '../fixtures/audio';

const sounds = (page: Page) => readProject(page).then(project => project.interstitials[0]);
const wav = (name: string, seconds: number) => ({ name, mimeType: 'audio/wav', buffer: wavFixture(seconds) });

for (const width of [1440, 390]) test(`input audio tracks add, edit, play, delete, undo and persist at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await openVideo(page); await addBridge(page);
  const editor = await openGenerationTimeline(page), ruler = editor.getByRole('slider', { name: 'Timeline ruler', exact: true });
  // Undo removes the first track entirely.
  await editor.getByRole('button', { name: 'Add audio track', exact: true }).click();
  await expect.poll(async () => (await sounds(page)).inputAudioTracks?.length).toBe(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await sounds(page)).inputAudioTracks ?? []).toEqual([]);
  await expect(editor.getByRole('group', { name: /audio track$/ })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Add audio track', exact: true }).click();
  const lane = editor.getByRole('group', { name: 'Input · Audio 1 audio track', exact: true });
  await expect(lane).toBeVisible();
  await expect(editor.getByLabel('Audio track name', { exact: true })).toHaveValue('Audio 1');
  await expect(editor.getByLabel('Selected generation input', { exact: true })).toHaveValue(/^track:/);

  const maskPath = (channel: 'video' | 'audio') => editor.getByRole('button', { name: `Edit ${channel} mask`, exact: true }).locator('path.mask-curve-line').getAttribute('d');
  const silentMask = { video: await maskPath('video'), audio: await maskPath('audio') };
  // Sounds land at the playhead, one after another, without overlapping.
  await ruler.press('Home'); for (let i = 0; i < 6; i++) await ruler.press('Shift+ArrowRight');
  await editor.getByLabel('Upload sounds', { exact: true }).setInputFiles([wav('Line.wav', 2), wav('Hit.wav', .5)]);
  await expect(lane.getByRole('button', { name: /^Sound / })).toHaveCount(2);
  await expect.poll(async () => (await sounds(page)).inputAudioTracks?.[0]?.clips).toMatchObject([
    { name: 'Line.wav', frame: 21, inFrame: 0, outFrame: 48, volume: 1 }, { name: 'Hit.wav', frame: 69, inFrame: 0, outFrame: 12, volume: 1 }]);
  await expect(lane.locator('.generation-waveform-clip svg')).toHaveCount(2);
  // Input sound keeps its audio in the mask; the picture still generates.
  expect(await maskPath('audio')).not.toBe(silentMask.audio);
  expect(await maskPath('video')).toBe(silentMask.video);

  const card = editor.getByRole('group', { name: 'Sound Line.wav', exact: true });
  await card.getByLabel('Start (s)', { exact: true }).fill('1');
  await card.getByLabel('Source in (s)', { exact: true }).fill('0.5');
  await card.getByRole('slider', { name: 'Volume Line.wav', exact: true }).fill('40');
  await expect.poll(async () => (await sounds(page)).inputAudioTracks[0].clips[0]).toMatchObject({ frame: -15, inFrame: 12, outFrame: 48, volume: .4 });

  const hit = lane.getByRole('button', { name: 'Sound Hit.wav on Audio 1', exact: true });
  await hit.focus(); await hit.press('Shift+ArrowLeft');
  await expect.poll(async () => (await sounds(page)).inputAudioTracks[0].clips[1].frame).toBe(59);

  // Track sound plays with the preview transport instead of stopping it.
  await ruler.press('Home');
  await editor.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLAudioElement>('audio[data-generation-sound]')].some(audio => !audio.paused))).toBe(true);
  await expect(editor.getByRole('button', { name: 'Pause timeline', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Pause timeline', exact: true }).click();

  const saved = (await sounds(page)).inputAudioTracks;
  await hit.focus(); await hit.press('Delete');
  await expect(lane.getByRole('button', { name: /^Sound / })).toHaveCount(1);
  await expect(lane.getByRole('button', { name: 'Sound Line.wav on Audio 1', exact: true })).toBeFocused();
  await expect(editor.locator('.generation-property-status')).toHaveText('Sound deleted. Undo restores it.');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await sounds(page)).inputAudioTracks).toEqual(saved);

  await editor.getByLabel('Selected generation input', { exact: true }).selectOption({ label: 'Input audio · Audio 1' });
  await editor.locator('.generation-sound-properties').getByRole('button', { name: 'Mute Track Audio 1', exact: true }).click();
  await expect(lane).toContainText('Audio 1 · muted');
  await editor.getByRole('button', { name: 'Add audio track', exact: true }).click();
  await expect(editor.getByRole('group', { name: 'Input · Audio 2 audio track', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Delete track', exact: true }).click();
  await expect(editor.getByRole('group', { name: 'Input · Audio 2 audio track', exact: true })).toHaveCount(0);
  await expect(lane).toBeFocused();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/generation-audio-tracks-${width}.png` });

  const expected = (await sounds(page)).inputAudioTracks;
  expect(expected).toMatchObject([{ name: 'Audio 1', muted: true, clips: [{ name: 'Line.wav' }, { name: 'Hit.wav' }] }]);
  await closeGenerationTimeline(page);
  await saveAndReopen(page);
  const reopened = (await sounds(page)).inputAudioTracks;
  expect(reopened.map((track: any) => ({ ...track, clips: track.clips.map((clip: any) => ({ ...clip, assetId: undefined })) })))
    .toEqual(expected.map((track: any) => ({ ...track, clips: track.clips.map((clip: any) => ({ ...clip, assetId: undefined })) })));
});

for (const width of [1440, 390]) test(`the audio mix sets every input level, keeps playing, and drags are one undo step at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await openVideo(page); await addBridge(page);
  const editor = await openGenerationTimeline(page), mix = editor.locator('.generation-audio-mix');
  await expect(mix).toContainText('Input');
  await expect(mix.getByRole('slider', { name: 'Start reference volume', exact: true })).toBeEnabled();
  await expect(mix.getByRole('slider', { name: 'End reference volume', exact: true })).toBeEnabled();

  await editor.getByRole('button', { name: 'Add audio track', exact: true }).click();
  await editor.getByLabel('Upload sounds', { exact: true }).setInputFiles([wav('Line.wav', 3)]);
  await expect(editor.getByRole('button', { name: 'Sound Line.wav on Audio 1', exact: true })).toBeVisible();
  await editor.getByRole('slider', { name: 'Timeline ruler', exact: true }).press('Home');
  await editor.getByRole('button', { name: 'Play timeline', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Pause timeline', exact: true })).toBeVisible();

  // Levels change while the preview keeps playing. A drag is one undo step.
  const start = mix.getByRole('slider', { name: 'Start reference volume', exact: true });
  await start.scrollIntoViewIfNeeded(); const box = (await start.boundingBox())!;
  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => (await sounds(page)).startReferenceVolume).toBeLessThan(.6);
  const dragged = (await sounds(page)).startReferenceVolume;
  await mix.getByRole('slider', { name: 'Audio 1 track volume', exact: true }).fill('50');
  await mix.getByRole('button', { name: 'Mute End reference', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Pause timeline', exact: true })).toBeVisible();
  await expect.poll(async () => { const item = await sounds(page); return [item.startReferenceVolume, item.endReferenceVolume, item.inputAudioTracks[0].volume]; }).toEqual([dragged, 0, .5]);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLAudioElement>('audio[data-generation-sound]')].map(audio => audio.volume))).toEqual([.5]);
  await editor.getByRole('button', { name: 'Pause timeline', exact: true }).click();
  await expect(mix.locator('output').first()).toHaveText(`${Math.round(dragged * 100)}%`);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => { const item = await sounds(page); return [item.startReferenceVolume ?? 1, item.endReferenceVolume ?? 1, item.inputAudioTracks[0].volume]; }).toEqual([1, 1, undefined]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mix.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/generation-audio-mix-${width}.png` });
});

test('reference exports apply each side’s level on the export clock', async ({ page }) => {
  await page.goto('/');
  const rms = await page.evaluate(async () => {
    const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource, Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { ensureAac, exportMp4 } = await import('/src/media/media.ts' as string); await ensureAac();
    const canvas = new OffscreenCanvas(160, 90); canvas.getContext('2d')!.fillRect(0, 0, 160, 90);
    const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat() });
    const video = new CanvasSource(canvas, { codec: 'avc', fullCodecString: 'avc1.42001e', bitrate: 100_000 }), audio = new AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
    output.addVideoTrack(video, { frameRate: 24 }); output.addAudioTrack(audio); await output.start();
    const buffer = new AudioBuffer({ numberOfChannels: 1, sampleRate: 48000, length: 4 * 48000 }), samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = .5 * Math.sin(i / 48000 * 440 * Math.PI * 2);
    await audio.add(buffer); audio.close();
    for (let frame = 0; frame < 96; frame++) await video.add(frame / 24, 1 / 24);
    video.close(); await output.finalize();
    const url = URL.createObjectURL(new Blob([output.target.buffer], { type: 'video/mp4' }));
    const blob = await exportMp4({ id: 'tone', name: 'Tone', url }, { start: .5, end: 3.5 }, { audioLevels: { split: 1.5, before: .25, after: 1 } });
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }), level = [[0, 0], [0, 0]];
    for await (const { buffer: chunk, timestamp } of new AudioBufferSink((await input.getPrimaryAudioTrack())!).buffers()) {
      const data = chunk.getChannelData(0);
      for (let i = 0; i < data.length; i++) { const t = timestamp + i / chunk.sampleRate; if (t > .2 && t < 1.3) { level[0][0] += data[i] ** 2; level[0][1]++; } if (t > 1.7 && t < 2.8) { level[1][0] += data[i] ** 2; level[1][1]++; } }
    }
    return level.map(([sum, count]) => Math.sqrt(sum / count));
  });
  expect(rms[1]).toBeGreaterThan(.25);
  expect(rms[0] / rms[1]).toBeCloseTo(.25, 1);
});

for (const width of [1440, 390]) test(`Library audio dropped on the timeline starts a track, and drops onto existing tracks at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await openVideo(page); await addBridge(page);
  await page.getByLabel('Import library assets', { exact: true }).setInputFiles([wav('Rain.wav', 1), wav('Door.wav', .5)]);
  const rain = page.getByRole('button', { name: 'Library asset Rain.wav', exact: true }), door = page.getByRole('button', { name: 'Library asset Door.wav', exact: true });
  await expect(door).toBeVisible();
  const nodeId = (await readProject(page)).storyFlow.nodes.find((n: any) => n.interstitialId).id;
  await page.locator(`[data-node-id="${nodeId}"] .story-clip-title`).click();
  const editor = await openGenerationTimeline(page), tracks = editor.locator('.generation-timeline-tracks');
  const geometry = () => editor.locator('.generation-timeline-scroll,.generation-drop-status').evaluateAll(elements => elements.map(el => ({ y: (el as HTMLElement).offsetTop, height: el.clientHeight })));
  const before = await geometry();

  await rain.scrollIntoViewIfNeeded(); const source = (await rain.boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2 + 8, { steps: 3 });
  await tracks.scrollIntoViewIfNeeded(); const box = (await tracks.boundingBox())!;
  await page.mouse.move(box.x + box.width * .5, box.y + 80, { steps: 10 }); await page.mouse.move(box.x + box.width * .5, box.y + 80);
  await expect(editor.locator('.generation-drop-preview.sound')).toBeVisible();
  await expect(editor.locator('.generation-drop-status')).toHaveText('Release to add sound on a new audio track');
  expect(await geometry()).toEqual(before);
  await page.mouse.up();
  const lane = editor.getByRole('group', { name: 'Input · Audio 1 audio track', exact: true });
  await expect(lane.getByRole('button', { name: 'Sound Rain.wav on Audio 1', exact: true })).toBeVisible();
  const frame = (await sounds(page)).inputAudioTracks[0].clips[0].frame;
  expect(Math.abs(39 + frame - Math.round(226 * .5))).toBeLessThanOrEqual(1);

  // A drop on an existing track adds to it, after anything already there.
  await dragIntoView(page, door, lane, { x: 4, y: 26 });
  await expect(lane.getByRole('button', { name: /^Sound / })).toHaveCount(2);
  const clips = (await sounds(page)).inputAudioTracks[0].clips;
  expect(clips).toMatchObject([{ name: 'Rain.wav', outFrame: 24 }, { name: 'Door.wav', outFrame: 12 }]);
  expect(clips[1].frame).toBeLessThan(clips[0].frame);
  await expect(editor.getByRole('group', { name: 'Sound Door.wav', exact: true })).toBeVisible();
});

const formData = async (route: { request: () => { postDataBuffer: () => Buffer | null; headers: () => Record<string, string> } }) =>
  new Response(Uint8Array.from(route.request().postDataBuffer()!), { headers: { 'Content-Type': route.request().headers()['content-type'] } }).formData();

test('input sound is sent to the model; sound over the result is separate and needs no new render', { tag: ['@generation'] }, async ({ page }) => {
  let form: FormData | undefined;
  await page.route('**/api/status', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), providers: { openai: false, gemini: false, comfy: true } } }); });
  await page.route('**/api/comfy/status*', route => route.fulfill({ json: { ready: true } }));
  await page.route('**/api/comfy/interstitials', async route => {
    form = await formData(route);
    await route.fulfill({ status: 202, json: { requestId: 'sound-render-job', status: 'IN_QUEUE', insertion: { start: 1, duration: 2, totalDuration: 5 } } });
  });
  await page.route('**/api/comfy/jobs/sound-render-job/events', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: refresh\ndata: {}\n\n' }));
  await page.route('**/api/comfy/jobs/sound-render-job', route => route.fulfill({ json: { requestId: 'sound-render-job', status: 'COMPLETED', videoUrl: 'https://example.test/sound.mp4' } }));
  await page.route('https://example.test/sound.mp4', route => route.fulfill({ contentType: 'video/mp4', path: 'tests/fixtures/interstitial-reference.mp4' }));
  await openVideo(page); await addBridge(page);
  await page.getByLabel('Video prompt', { exact: true }).fill('She answers the question');
  let editor = await openGenerationTimeline(page);
  const ruler = editor.getByRole('slider', { name: 'Timeline ruler', exact: true });
  await ruler.press('Home'); for (let i = 0; i < 6; i++) await ruler.press('Shift+ArrowRight');
  await editor.getByRole('button', { name: 'Add audio track', exact: true }).click();
  await editor.getByLabel('Upload sounds', { exact: true }).setInputFiles([wav('Answer.wav', 2)]);
  await expect(editor.getByRole('button', { name: 'Sound Answer.wav on Audio 1', exact: true })).toBeVisible();
  await closeGenerationTimeline(page);

  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(async () => (await sounds(page)).phase, { timeout: 60000 }).toBe('ready');
  expect(form!.get('fullInput')).toBe('true');
  expect(JSON.parse(String(form!.get('timelineAudioInputs')))).toEqual([{ frame: 21, frames: 48 }]);
  const input = form!.get('video') as File;
  const tracks = await page.evaluate(async bytes => {
    const { Input, BlobSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const media = new Input({ source: new BlobSource(new Blob([new Uint8Array(bytes)])), formats: ALL_FORMATS });
    return { audio: !!await media.getPrimaryAudioTrack(), duration: await media.computeDuration() };
  }, [...new Uint8Array(await input.arrayBuffer())]);
  expect(tracks.audio).toBe(true);

  editor = await openGenerationTimeline(page);
  await editor.locator('.generation-player-modes').getByRole('button', { name: 'Generated', exact: true }).click();
  await expect(editor.getByRole('group', { name: /^Input · / })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Add audio track', exact: true }).click();
  const lane = editor.getByRole('group', { name: 'Generated · Audio 1 audio track', exact: true });
  await expect(lane).toBeVisible();
  await editor.getByLabel('Upload sounds', { exact: true }).setInputFiles([wav('Score.wav', 1)]);
  await expect(lane.getByRole('button', { name: 'Sound Score.wav on Audio 1', exact: true })).toBeVisible();
  // The Generated tab's mix sets the clip's story volume and the generated tracks.
  const mix = editor.locator('.generation-audio-mix');
  await expect(mix).toContainText('Generated');
  await expect(mix.getByRole('slider', { name: 'Start reference volume', exact: true })).toHaveCount(0);
  await mix.getByRole('slider', { name: 'Generated video volume', exact: true }).fill('30');
  await expect.poll(async () => (await readProject(page)).storyFlow.nodes.find((node: any) => node.interstitialId).volume).toBe(.3);
  await mix.getByRole('slider', { name: 'Audio 1 track volume', exact: true }).fill('70');
  await expect.poll(async () => (await sounds(page)).generatedAudioTracks[0].volume).toBe(.7);
  const item = await sounds(page);
  expect(item.generatedAudioTracks[0].clips).toMatchObject([{ name: 'Score.wav', volume: 1 }]);
  expect(item.inputAudioTracks[0].clips).toMatchObject([{ name: 'Answer.wav' }]);
  // The render stays current: only input changes ask for a new generation.
  await closeGenerationTimeline(page);
  await expect(page.locator('.interstitial-edited')).toBeHidden();
  await expect(page.getByText('Settings edited · ready to regenerate')).toHaveCount(0);
});
