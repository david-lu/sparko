import { readFile } from 'node:fs/promises';
import { test, expect, openVideo, readProject, saveAndReopen, type Page } from './fixtures';
import { wavFixture } from '../fixtures/audio';
import { writeClipMetadata } from '../../src/media/clipMetadata';
import { clipMetadata } from '../fixtures/clip-metadata';

async function holdAsset(page: Page, assetId: string) {
  await page.evaluate(async assetId => {
    const { assets } = await import('/src/features/project/assets.ts' as string);
    const open = assets.open.bind(assets);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    assets.open = async (id: string) => { if (id === assetId) await waiting; return open(id); };
    (window as any).releaseAsset = () => { assets.open = open; release(); };
  }, assetId);
}

for (const width of [1440, 390]) test(`saved loops use volume without a second audio toggle at ${width}px`, async ({ page }) => {
  await page.addInitScript(() => {
    const createGain = AudioContext.prototype.createGain;
    (window as any).volumeGains = [];
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this), entry = { gain, active: true };
      const disconnect = gain.disconnect.bind(gain);
      gain.disconnect = () => { entry.active = false; disconnect(); };
      (window as any).volumeGains.push(entry); return gain;
    };
  });
  const metadata = { ...clipMetadata, clip: { ...clipMetadata.clip, loop: true }, settings: { ...clipMetadata.settings, loopAudio: false } };
  const blob = await writeClipMetadata(new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')], { type: 'video/mp4' }), metadata, new AbortController().signal);
  await page.setViewportSize({ width, height: 1000 }); await page.goto('/');
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles({ name: 'Legacy loop.mp4', mimeType: 'video/mp4', buffer: Buffer.from(await blob.arrayBuffer()) });
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.locator('.story-clip-title').click();
  expect((await readProject(page)).interstitials[0].loopAudio).toBe(false);
  await expect(page.getByRole('checkbox', { name: 'Play generated clip audio' })).toHaveCount(0);
  await page.locator('.inspector-output>summary').click();
  await expect(page.locator('.interstitial-preview video')).toHaveJSProperty('muted', false);
  const slider = page.getByRole('slider', { name: 'Clip volume', exact: true });
  await slider.fill('35');
  await page.getByRole('button', { name: 'Play', exact: true }).press('Enter');
  const gainIs = (value: number) => page.evaluate(value => (window as any).volumeGains.some((entry: any) => entry.active && Math.abs(entry.gain.gain.value - value) < .001), value);
  await expect.poll(() => gainIs(.35)).toBe(true);
  await page.getByRole('button', { name: 'Mute clip', exact: true }).click(); await expect(slider).toHaveValue('0');
  await expect.poll(() => gainIs(0)).toBe(true);
  await page.getByRole('button', { name: 'Unmute clip', exact: true }).click(); await expect(slider).toHaveValue('35');
  await expect.poll(() => gainIs(.35)).toBe(true);
  await expect(page.locator('.interstitial-preview video')).toHaveJSProperty('muted', false);
  await slider.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/loop-volume-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

for (const width of [1440, 390]) test(`clip volume edits playback while asset previews and downloads stay unchanged at ${width}px`, async ({ page }) => {
  await page.addInitScript(() => {
    const createGain = AudioContext.prototype.createGain;
    (window as any).volumeGains = [];
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this), entry = { gain, active: true };
      const disconnect = gain.disconnect.bind(gain);
      gain.disconnect = () => { entry.active = false; disconnect(); };
      (window as any).volumeGains.push(entry); return gain;
    };
  });
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  const sourceId = (await readProject(page)).source.assetId;
  await page.locator('.story-clip-title').click();
  const slider=page.getByRole('slider',{name:'Clip volume',exact:true});await slider.fill('35');
  await holdAsset(page, sourceId);
  await page.getByRole('button', { name: 'Library asset interstitial-reference.mp4', exact: true }).click();
  await expect(slider).toHaveCount(0);
  const positions = () => page.locator('.asset-inspector').evaluate(el => {
    const top = el.getBoundingClientRect().top;
    return ['.asset-preview', '.asset-preview-actions', '.inspector-group:last-child'].map(selector => {
      const r = el.querySelector(selector)!.getBoundingClientRect(); return { top: r.top - top, height: r.height };
    });
  });
  const loading = await positions();
  await page.evaluate(() => (window as any).releaseAsset());
  await expect(page.locator('.asset-preview video')).toHaveJSProperty('readyState', 4);
  expect(await positions()).toEqual(loading);
  await expect(page.locator('.asset-preview video')).toHaveJSProperty('volume', 1);
  await expect.poll(async () => (await readProject(page)).storyFlow.nodes[0].volume).toBe(.35);
  await page.locator('.asset-preview video').dispatchEvent('error');
  await expect(page.getByRole('button', { name: 'Preview errors', exact: true })).toBeVisible();
  expect(await positions()).toEqual(loading);
  await page.screenshot({ path: `test-results/asset-volume-${width}.png`, fullPage: true });

  // The timeline uses this clip gain; Library media retains its original sound.
  await page.locator('.story-clip.type-source .story-clip-title').click();
  await expect(slider).toHaveValue('35');
  await page.getByRole('button', { name: 'Play', exact: true }).press('Enter');
  const gainIs = (value: number) => page.evaluate(value => (window as any).volumeGains.some((entry: any) => entry.active && Math.abs(entry.gain.gain.value - value) < .001), value);
  await expect.poll(() => gainIs(.35)).toBe(true);
  await slider.fill('60'); await expect.poll(() => gainIs(.6)).toBe(true);
  await page.getByRole('button', { name: 'Mute clip', exact: true }).click(); await expect(slider).toHaveValue('0');
  await expect.poll(() => gainIs(0)).toBe(true);
  await page.getByRole('button', { name: 'Unmute clip', exact: true }).click(); await expect(slider).toHaveValue('60');
  if (await page.getByRole('button', { name: 'Pause', exact: true }).isVisible()) await page.getByRole('button', { name: 'Pause', exact: true }).press('Enter');

  await page.getByLabel('Import library assets', { exact: true }).setInputFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: wavFixture(2) });
  await expect(page.getByLabel('Asset name', { exact: true })).toHaveValue('Tone.wav');
  await expect(page.locator('.asset-preview audio')).toHaveJSProperty('volume', 1);
  await page.getByRole('button',{name:'Add to timeline',exact:true}).click();
  await slider.fill('25'); await slider.blur();
  await slider.fill('30'); await slider.blur();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(slider).toHaveValue('25');
  const audio = (await readProject(page)).library.find((a: any) => a.name === 'Tone.wav');
  await page.getByRole('button',{name:'Reveal in Library',exact:true}).click();
  const beforeDownload = await positions();
  await holdAsset(page, audio.assetId);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveAttribute('aria-busy', 'true');
  expect(await positions()).toEqual(beforeDownload);
  await page.evaluate(() => (window as any).releaseAsset());
  const file = await download;
  const bytes = await readFile((await file.path())!);
  const levels = await page.evaluate(async bytes => {
    const { ALL_FORMATS, AudioSampleSink, BlobSource, Input } = await import('/node_modules/.vite/deps/mediabunny.js' as string);
    const { readAsset, readActiveProject } = await import('/src/features/project/database.ts' as string);
    const project = await readActiveProject(), original = await readAsset(project.library.find((a: any) => a.name === 'Tone.wav').assetId);
    const rms = async (blob: Blob) => {
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryAudioTrack(); let sum = 0, count = 0;
        for await (const sample of new AudioSampleSink(track).samples(.25, 1.25)) {
          const data = new Float32Array(sample.numberOfFrames); sample.copyTo(data, { planeIndex: 0, format: 'f32-planar' });
          for (const value of data) { sum += value * value; count++; } sample.close();
        }
        return Math.sqrt(sum / count);
      } finally { input.dispose(); }
    };
    return { original: await rms(original.blob), exported: await rms(new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' })) };
  }, [...bytes]);
  expect(levels.exported / levels.original).toBeCloseTo(1, 2);
  expect(await positions()).toEqual(beforeDownload);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width === 1440) {
    await saveAndReopen(page);
    await page.getByRole('button', { name: 'Select Tone.wav', exact: true }).click(); await expect(slider).toHaveValue('25');
    await page.getByRole('button', { name: 'Select interstitial-reference.mp4', exact: true }).click(); await expect(slider).toHaveValue('60');
  }
});
