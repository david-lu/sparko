import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

async function setup(page: Page, moving = false, sourceFps = 25) {
  await page.route('**/__native-timeline', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}</style><div id="stage" style="position:relative;width:320px;height:180px"><video muted playsinline></video></div>' }));
  await page.goto('/__native-timeline');
  await page.evaluate(async ({ moving, sourceFps }) => {
    const { BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const make = async (fps: number, width: number, height: number, seconds: number, color: string) => {
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')!;
      context.fillStyle = color; context.fillRect(0, 0, width, height);
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
      const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 200_000 }); output.addVideoTrack(video, { frameRate: fps });
      await output.start(); for (let frame = 0; frame < seconds * fps; frame++) {
        if (moving) {
          context.fillStyle = color; context.fillRect(0, 0, width, height);
          context.fillStyle = '#fff'; context.fillRect((frame * 7) % width, 0, 8, height);
        }
        await video.add(frame / fps, 1 / fps);
      }
      video.close(); await output.finalize();
      const asset = await assets.save(new Blob([output.target.buffer], { type: 'video/mp4' }), color);
      const { url } = await assets.open(asset.id); return { asset, source: { id: asset.id, assetId: asset.id, name: color, url } };
    };
    const source = await make(sourceFps, 320, 180, 3, '#ee0000'), generated = await make(24, 160, 96, 2, '#00ee00');
    const legacy = await make(24, 320, 180, 3, '#ee0000');
    const state = { source, generated, legacy, encoded: 0, controller: null as any,
      info: { duration: 3, fps: sourceFps, width: 320, height: 180, codec: 'avc', hasAudio: false } };
    (window as any).nativeTest = state;
    const encode = VideoEncoder.prototype.encode;
    VideoEncoder.prototype.encode = function (...args) { state.encoded++; return encode.apply(this, args); };
  }, { moving, sourceFps });
}
test('source-only editor playback loads captions and uses the canvas transport', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/status', route => route.fulfill({ json: { uploadMode: 'local', requiresPassword: false,
    providers: { openai: false, gemini: false, comfy: false }, models: { openai: 'mock', gemini: 'mock' },
    defaultVideo: { name: 'sample.mp4', size: 0, url: '/media/sample.mp4' } } }));
  await page.route('**/media/sample.mp4', route => route.fulfill({ path: path.resolve('tests/fixtures/interstitial-reference.mp4'), contentType: 'video/mp4' }));
  await page.goto('/'); await page.getByRole('button', { name: /Sample video/ }).click();
  await expect(page.locator('.playback-canvas')).toHaveAttribute('data-renderer', 'webgpu');
  await expect(page.locator('.buffering')).toHaveCount(0);
  await page.getByLabel('Choose subtitle file').setInputFiles({ name: 'source.vtt', mimeType: 'text/vtt', buffer: Buffer.from('WEBVTT\n\n00:00.000 --> 00:03.000\nCanvas captions\n') });
  await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('0.5');
  await expect(page.locator('.playback-captions')).toContainText('Canvas captions');
  await page.locator('.playback-canvas').click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Video timeline', exact: true }).inputValue())).toBeGreaterThan(1);
  await page.locator('.playback-canvas').click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('renders and crossfades decoded frames on one WebGPU canvas without native playback or preview encoding', async ({ page }) => {
  await setup(page, true, 60);
  await page.evaluate(async () => {
    const { VideoPlayerController } = await import('/src/features/player/VideoPlayerController.ts' as string);
    const { TimelineComposition } = await import('/src/media/TimelineComposition.ts' as string);
    const s = (window as any).nativeTest;
    s.nativePlay = HTMLMediaElement.prototype.play;
    s.nativeStarts = 0; HTMLMediaElement.prototype.play = async () => { s.nativeStarts++; throw new Error('Native playback must not run'); };
    const c = s.controller = new VideoPlayerController(); c.attach(document.querySelector('video')); c.load(s.source.source);
    c.setComposition(new TimelineComposition(s.source.source, s.info, [{ id: 'insert', label: 'Insert', time: 1, phase: 'ready',
      result: { url: s.generated.source.url, start: .5, duration: 1, totalDuration: 2 } }], { crossfadeFrames: 12 }));
    c.setSubtitles(null, [new VTTCue(0, 3, 'Source dialogue')], true);
  });
  const snapshot = () => page.evaluate(() => (window as any).nativeTest.controller.getSnapshot());
  await expect.poll(async () => { const s = await snapshot(); return s.error ?? s.buffering; }).toBe(false);
  await expect(page.locator('canvas.playback-canvas')).toHaveAttribute('data-renderer', 'webgpu');
  await expect(page.locator('canvas.playback-canvas')).toHaveCount(1);
  await expect(page.locator('video')).toHaveCount(1); await expect(page.locator('video')).toBeHidden();
  const seek = async (time: number) => {
    await page.evaluate(time => (window as any).nativeTest.controller.seek(time), time);
    await expect.poll(async () => { const s = await snapshot(); return s.error ?? s.buffering; }).toBe(false);
  };
  const pixel = async () => {
    const screenshot = await page.locator('canvas.playback-canvas').screenshot();
    return page.evaluate(async base64 => {
      const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
      const canvas = new OffscreenCanvas(img.width, img.height), ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(160, 60, 1, 1).data];
    }, screenshot.toString('base64'));
  };
  await seek(.75); const blend = await pixel();
  expect(blend[0]).toBeGreaterThan(80); expect(blend[1]).toBeGreaterThan(80); expect(blend[2]).toBeLessThan(30);
  await seek(1.25); const body = await pixel();
  expect(body[1]).toBeGreaterThan(200); expect(body[0]).toBeLessThan(30);
  await expect(page.locator('.playback-captions')).toBeEmpty();
  await seek(2.25); const returning = await pixel();
  expect(returning[0]).toBeGreaterThan(80); expect(returning[1]).toBeGreaterThan(80);
  await seek(2.75); await expect(page.locator('.playback-captions')).toContainText('Source dialogue');
  await seek(.25);
  await page.evaluate(() => {
    const s = (window as any).nativeTest; s.bufferEvents = 0; s.lastBuffer = false;
    s.controller.subscribe(() => { const next = s.controller.getSnapshot(); if (next.playing && next.buffering && !s.lastBuffer) s.bufferEvents++; s.lastBuffer = next.buffering; });
    s.controller.setSpeed(1.25); void s.controller.play();
  });
  await expect.poll(async () => (await snapshot()).time, { timeout: 6000 }).toBeGreaterThan(3.5);
  await page.evaluate(() => (window as any).nativeTest.controller.pause());
  const result = await page.evaluate(() => {
    const s = (window as any).nativeTest; return { encoded: s.encoded, nativeStarts: s.nativeStarts, buffers: s.bufferEvents,
      buffersPresent: s.controller.getSnapshot().buffered.length > 0, audioVoices: s.controller.timeline.decks.audio.voices.size };
  });
  expect(result).toMatchObject({ encoded: 0, nativeStarts: 0, buffersPresent: true, audioVoices: 0 });
  expect(result.buffers).toBeLessThanOrEqual(3);
  const mirror = await page.evaluate(async () => {
    const s = (window as any).nativeTest; HTMLMediaElement.prototype.play = s.nativePlay;
    HTMLVideoElement.prototype.requestPictureInPicture = async function () { s.pip = this.srcObject instanceof MediaStream; return {} as PictureInPictureWindow; };
    await s.controller.requestPictureInPicture();
    return { stream: s.pip, width: s.controller.video.videoWidth, height: s.controller.video.videoHeight, muted: s.controller.video.muted };
  });
  expect(mirror).toEqual({ stream: true, width: 320, height: 180, muted: true });
  await page.evaluate(() => (window as any).nativeTest.controller.dispose());
  await expect(page.locator('canvas.playback-canvas')).toHaveCount(0);
});

test('uses the same decoded-frame pipeline without WebGPU and closes its media resources', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    const { VideoPlayerController } = await import('/src/features/player/VideoPlayerController.ts' as string);
    const s = (window as any).nativeTest, c = s.controller = new VideoPlayerController();
    c.attach(document.querySelector('video')); c.load(s.source.source);
  });
  await expect.poll(() => page.evaluate(() => { const s = (window as any).nativeTest.controller.getSnapshot(); return s.error ?? s.buffering; })).toBe(false);
  await expect(page.locator('.playback-canvas')).toHaveAttribute('data-renderer', 'canvas2d');
  const result = await page.evaluate(async () => {
    const s = (window as any).nativeTest, decks = s.controller.timeline.decks;
    const frames = [...decks.decks.values()].flatMap((deck: any) => deck.decoder.frames), context = decks.audio.context;
    const canvas = new OffscreenCanvas(320, 180), ctx = canvas.getContext('2d')!; ctx.drawImage(s.controller.canvas, 0, 0);
    const pixel = [...ctx.getImageData(160, 60, 1, 1).data];
    s.controller.dispose();
    await Promise.resolve();
    return { encoded: s.encoded, pixel, context: context.state, decks: decks.decks.size,
      closed: frames.length > 0 && frames.every((frame: any) => { try { frame.toVideoFrame().close(); return false; } catch { return true; } }) };
  });
  expect(result).toMatchObject({ encoded: 0, context: 'closed', decks: 0, closed: true });
  expect(result.pixel[0]).toBeGreaterThan(200);
  await expect(page.locator('.playback-canvas')).toHaveCount(0);
});

test('opening a sparko file preserves mismatched originals and their reference bounds without preview encoding', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const s = (window as any).nativeTest;
    const { ProjectController } = await import('/src/features/project/ProjectController.ts' as string);
    const { InterstitialController } = await import('/src/features/interstitials/InterstitialController.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const { emptyAnalysis } = await import('/src/features/project/types.ts' as string);
    const { readAsset } = await import('/src/features/project/database.ts' as string);
    const { Input, UrlSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const project = { id: 'test', name: 'Native archive', updatedAt: Date.now(), source: { name: 'Source.mp4', assetId: s.legacy.asset.id, originalAssetId: s.source.asset.id },
      interstitials: [{ id: 'generated', label: 'Generated', time: 1, phase: 'ready', method: 'comfy', prompt: '', start_range: 1, end_range: 1, duration: 1, enable_prompt_expansion: false,
        result: { url: s.generated.source.url, assetId: s.generated.asset.id, start: .5, duration: 1, totalDuration: 2 } }], subtitle: null, analysis: emptyAnalysis() };
    const archive = await packProject(project, [s.source.asset, s.legacy.asset, s.generated.asset], new AbortController().signal, () => {});
    const interstitials = new InterstitialController(), controller = new ProjectController(interstitials);
    const open = async () => {
      await controller.importProject(new File([archive], 'test.sparko'));
      const snapshot = controller.getSnapshot(); if (snapshot.error) throw new Error(snapshot.error);
      return snapshot;
    };
    const first = await open(), firstCount = s.encoded;
    const restored = first.project.interstitials[0].result, original = await readAsset(restored.assetId);
    try {
      const { assets } = await import('/src/features/project/assets.ts' as string);
      const url = (await assets.open(original.id)).url;
      const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
      let prepared;
      try { const video = await input.getPrimaryVideoTrack(); prepared = { fps: (await video.computePacketStats()).averagePacketRate, width: await video.getDisplayWidth(), height: await video.getDisplayHeight(), duration: await video.computeDuration() }; }
      finally { input.dispose(); }
      const second = await open();
      return { firstCount, finalCount: s.encoded, prepared, remapped: first.project.source.assetId !== second.project.source.assetId,
        originalSize: original.blob.size, expectedSize: s.generated.asset.blob.size, boundaries: [restored.start, restored.duration],
        sourceSize: (await readAsset(second.project.source.assetId)).blob.size, expectedSourceSize: s.source.asset.blob.size };
    } finally { controller.dispose(); interstitials.dispose(); }
  });
  expect(result).toMatchObject({ firstCount: 0, finalCount: 0, remapped: true, boundaries: [.5, 1], prepared: { width: 160, height: 96, duration: 2 } });
  expect(result.prepared.fps).toBeCloseTo(24, 6);
  expect(result.originalSize).toBe(result.expectedSize); expect(result.sourceSize).toBe(result.expectedSourceSize);
});

test('cancelling interstitial validation during import preserves the active project and commits no imported assets', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const s = (window as any).nativeTest;
    const { ProjectController } = await import('/src/features/project/ProjectController.ts' as string);
    const { InterstitialController } = await import('/src/features/interstitials/InterstitialController.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const { emptyAnalysis } = await import('/src/features/project/types.ts' as string);
    const { readActiveProject } = await import('/src/features/project/database.ts' as string);
    const interstitials = new InterstitialController(), controller = new ProjectController(interstitials);
    const count = async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('sparko-projects'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise<number>(resolve => { const request = db.transaction('assets').objectStore('assets').count(); request.onsuccess = () => resolve(request.result); }); }
      finally { db.close(); }
    };
    await controller.openVideo(new File([s.source.asset.blob], 'Existing.mp4', { type: 'video/mp4' }));
    const before = await readActiveProject(), countBefore = await count();
    const project = { id: 'test', name: 'Cancelled import', updatedAt: Date.now(), source: { name: 'Source.mp4', assetId: s.source.asset.id },
      interstitials: [{ id: 'generated', label: 'Generated', time: 1, phase: 'ready', method: 'comfy', prompt: '', start_range: 1, end_range: 1, duration: 1, enable_prompt_expansion: false,
        result: { url: s.generated.source.url, assetId: s.generated.asset.id, start: .5, duration: 1, totalDuration: 2 } }], subtitle: null, analysis: emptyAnalysis() };
    const archive = await packProject(project, [s.source.asset, s.generated.asset], new AbortController().signal, () => {});
    let cancelled = false;
    const unsubscribe = controller.subscribe(() => { if (!cancelled && controller.getSnapshot().message.startsWith('Checking interstitial')) { cancelled = true; controller.cancel(); } });
    try {
      await controller.importProject(new File([archive], 'cancel.sparko'));
      const after = await readActiveProject();
      return { cancelled, sameSource: before.source.assetId === after.source.assetId, countBefore, countAfter: await count(),
        error: controller.getSnapshot().error, busy: controller.getSnapshot().busy };
    } finally { unsubscribe(); controller.dispose(); interstitials.dispose(); }
  });
  expect(result).toMatchObject({ cancelled: true, sameSource: true, error: null, busy: false });
  expect(result.countAfter).toBe(result.countBefore);
});
