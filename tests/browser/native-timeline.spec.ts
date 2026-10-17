import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.route('**/__native-timeline', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}</style><div id="stage" style="position:relative;width:320px;height:180px"><video muted playsinline></video></div>' }));
  await page.goto('/__native-timeline');
  await page.evaluate(async () => {
    const { BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const make = async (fps: number, width: number, height: number, seconds: number, color: string) => {
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')!;
      context.fillStyle = color; context.fillRect(0, 0, width, height);
      const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
      const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 200_000 }); output.addVideoTrack(video, { frameRate: fps });
      await output.start(); for (let frame = 0; frame < seconds * fps; frame++) await video.add(frame / fps, 1 / fps);
      video.close(); await output.finalize();
      const asset = await assets.save(new Blob([output.target.buffer], { type: 'video/mp4' }), color);
      const { url } = await assets.open(asset.id); return { asset, source: { id: asset.id, assetId: asset.id, name: color, url } };
    };
    const source = await make(25, 320, 180, 3, '#ee0000'), generated = await make(24, 160, 96, 2, '#00ee00');
    const legacy = await make(24, 320, 180, 3, '#ee0000');
    const state = { source, generated, legacy, encoded: 0, controller: null as any,
      info: { duration: 3, fps: 25, width: 320, height: 180, codec: 'avc', hasAudio: false } };
    (window as any).nativeTest = state;
    const encode = VideoEncoder.prototype.encode;
    VideoEncoder.prototype.encode = function (...args) { state.encoded++; return encode.apply(this, args); };
  });
}
const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).nativeTest, c = s.controller;
  return { ...c.getSnapshot(), encoded: s.encoded, activeUrl: c.video.currentSrc, sourceUrl: s.source.source.url,
    activeTime: c.video.currentTime, activeWidth: c.video.videoWidth, activeHeight: c.video.videoHeight };
});

test('plays source and matching generated clips natively, with seekable video/audio fades and no source encoding', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { VideoPlayerController } = await import('/src/features/player/VideoPlayerController.ts' as string);
    const { TimelineComposition } = await import('/src/media/TimelineComposition.ts' as string);
    const s = (window as any).nativeTest, c = s.controller = new VideoPlayerController();
    c.attach(document.querySelector('video')); c.load(s.source.source);
    s.composition = new TimelineComposition(s.source.source, s.info, [{ id: 'insert', label: 'Insert', time: 1, phase: 'ready',
      result: { url: s.generated.source.url, assetId: s.generated.asset.id, start: .5, duration: 1, totalDuration: 2 } }]);
    c.setComposition(s.composition); c.setVolume(.8);
    const track = c.subtitleVideo.addTextTrack('subtitles', 'Source');
    c.setSubtitles(track, [new VTTCue(0, 3, 'Source dialogue')], true);
  });
  await expect.poll(async () => (await state(page)).buffering).toBe(false);
  expect((await state(page)).activeUrl).toBe((await state(page)).sourceUrl);
  await page.evaluate(() => (window as any).nativeTest.controller.seek(1.25));
  await expect.poll(async () => (await state(page)).buffering).toBe(false);
  expect(await state(page)).toMatchObject({ time: 1.25, activeTime: .75, activeWidth: 320, activeHeight: 180, encoded: 50, error: null });
  const rate = await page.evaluate(async () => {
    const { Input, UrlSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const input = new Input({ source: new UrlSource((window as any).nativeTest.controller.video.currentSrc), formats: ALL_FORMATS });
    try { return (await (await input.getPrimaryVideoTrack()).computePacketStats()).averagePacketRate; } finally { input.dispose(); }
  });
  expect(rate).toBeCloseTo(25, 6);
  expect(await page.evaluate(() => (window as any).nativeTest.controller.video.textTracks[0].mode)).toBe('hidden');
  await page.evaluate(() => (window as any).nativeTest.controller.seek(1));
  await expect.poll(async () => (await state(page)).buffering).toBe(false);
  const layers = await page.locator('video').evaluateAll(videos => videos.filter(video => Number(video.style.opacity) > 0).map(video => ({ opacity: Number(video.style.opacity), volume: (video as HTMLVideoElement).volume, time: (video as HTMLVideoElement).currentTime })));
  expect(layers).toHaveLength(2); expect(layers.map(layer => layer.volume)).toEqual([.4, .4]);
  expect(layers.map(layer => layer.opacity).sort()).toEqual([.5, 1]);
  const screenshot = await page.locator('#stage').screenshot();
  const pixel = await page.evaluate(async base64 => {
    const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode();
    const canvas = new OffscreenCanvas(320, 180), ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(160, 60, 1, 1).data];
  }, screenshot.toString('base64'));
  expect(pixel[0]).toBeGreaterThan(80); expect(pixel[1]).toBeGreaterThan(80); expect(pixel[2]).toBeLessThan(20);
  await page.evaluate(() => { const c = (window as any).nativeTest.controller; c.seek(.75); c.setSpeed(2); void c.play(); });
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(2.25);
  await page.evaluate(() => (window as any).nativeTest.controller.pause());
  expect((await state(page)).activeUrl).toBe((await state(page)).sourceUrl);
  expect((await state(page)).encoded).toBe(50);
  expect(await page.evaluate(() => (window as any).nativeTest.controller.video.textTracks[0].mode)).toBe('showing');
  await page.evaluate(() => (window as any).nativeTest.controller.dispose());
  await expect(page.locator('video')).toHaveCount(1);
});

test('opening a sparko file converts mismatched interstitials, preserves originals, and reuses conversions on reimport', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const s = (window as any).nativeTest;
    const { ProjectController } = await import('/src/features/project/ProjectController.ts' as string);
    const { InterstitialController } = await import('/src/features/interstitials/InterstitialController.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const { emptyAnalysis } = await import('/src/features/project/types.ts' as string);
    const { readAsset } = await import('/src/features/project/database.ts' as string);
    const { GeneratedPlaybackMedia } = await import('/src/media/GeneratedPlaybackMedia.ts' as string);
    const { Input, UrlSource, ALL_FORMATS } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const project = { id: 'test', name: 'Native archive', updatedAt: Date.now(), source: { name: 'Source.mp4', assetId: s.legacy.asset.id, originalAssetId: s.source.asset.id },
      interstitials: [{ id: 'generated', label: 'Generated', time: 1, phase: 'ready', method: 'fal', prompt: '', start_range: 1, end_range: 1, duration: 1, enable_prompt_expansion: false,
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
    const media = new GeneratedPlaybackMedia(s.info, false);
    try {
      const { assets } = await import('/src/features/project/assets.ts' as string);
      const url = await media.resolve({ id: original.id, assetId: original.id, name: original.name, url: (await assets.open(original.id)).url });
      const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
      let prepared;
      try { const video = await input.getPrimaryVideoTrack(); prepared = { fps: (await video.computePacketStats()).averagePacketRate, width: await video.getDisplayWidth(), height: await video.getDisplayHeight(), duration: await video.computeDuration() }; }
      finally { input.dispose(); }
      const second = await open();
      return { firstCount, finalCount: s.encoded, prepared, remapped: first.project.source.assetId !== second.project.source.assetId,
        originalSize: original.blob.size, expectedSize: s.generated.asset.blob.size, boundaries: [restored.start, restored.duration],
        sourceSize: (await readAsset(second.project.source.assetId)).blob.size, expectedSourceSize: s.source.asset.blob.size };
    } finally { media.dispose(); controller.dispose(); interstitials.dispose(); }
  });
  expect(result).toMatchObject({ firstCount: 50, finalCount: 50, remapped: true, boundaries: [.5, 1], prepared: { width: 320, height: 180, duration: 2 } });
  expect(result.prepared.fps).toBeCloseTo(25, 6);
  expect(result.originalSize).toBe(result.expectedSize); expect(result.sourceSize).toBe(result.expectedSourceSize);
});

test('cancelling generated conversion during import preserves the active project and commits no imported assets', async ({ page }) => {
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
      interstitials: [{ id: 'generated', label: 'Generated', time: 1, phase: 'ready', method: 'fal', prompt: '', start_range: 1, end_range: 1, duration: 1, enable_prompt_expansion: false,
        result: { url: s.generated.source.url, assetId: s.generated.asset.id, start: .5, duration: 1, totalDuration: 2 } }], subtitle: null, analysis: emptyAnalysis() };
    const archive = await packProject(project, [s.source.asset, s.generated.asset], new AbortController().signal, () => {});
    let cancelled = false;
    const encode = VideoEncoder.prototype.encode;
    VideoEncoder.prototype.encode = function (...args) { encode.apply(this, args); cancelled = true; controller.cancel(); };
    try {
      await controller.importProject(new File([archive], 'cancel.sparko'));
      const after = await readActiveProject();
      return { cancelled, sameSource: before.source.assetId === after.source.assetId, countBefore, countAfter: await count(),
        error: controller.getSnapshot().error, busy: controller.getSnapshot().busy };
    } finally { VideoEncoder.prototype.encode = encode; controller.dispose(); interstitials.dispose(); }
  });
  expect(result).toMatchObject({ cancelled: true, sameSource: true, error: null, busy: false });
  expect(result.countAfter).toBe(result.countBefore);
});
