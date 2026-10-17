import { expect, test } from './fixtures';
import { readFile } from 'node:fs/promises';
import { wavFixture } from '../fixtures/audio';

test.skip(true, 'The Voice panel is temporarily removed from the interface.');

declare global {
  interface Window {
    voiceTest: { tracks: MediaStreamTrack[]; play: (url: string) => Promise<void> };
  }
}

test.beforeEach(async ({ page }) => {
  // Inject audio through a synthetic stream. Tests never access the user's microphone.
  await page.addInitScript(() => {
    window.voiceTest = { tracks: [], play: async () => undefined };
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const destination = context.createMediaStreamDestination();
      window.voiceTest.play = async url => {
        const buffer = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination); source.start();
      };
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); if (context.state !== 'closed') void context.close(); };
        window.voiceTest.tracks.push(track);
      }
      return destination.stream;
    };
  });
  await page.route('**/test-speech.wav', async route => route.fulfill({ contentType: 'audio/wav', body: await readFile('tests/fixtures/voice-answer.wav') }));
  await page.route('**/test-tone.wav', async route => route.fulfill({ contentType: 'audio/wav', body: wavFixture(1) }));
  await page.route('**/api/status', async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ json: { ...body, providers: { openai: true, gemini: true, fal: true } } });
  });
  await page.goto('/');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.duration)).toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'Voice' }).click();
});

test('waits for speech, rejects a tone, captures an utterance and sends it only on request', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const uploads: { context: { sourceId: string; videoTime: number }; bytes: number; mime: string }[] = [];
  await page.route('**/api/voice/*', async route => {
    const request = route.request();
    const form = await new Response(Uint8Array.from(request.postDataBuffer()!), { headers: { 'Content-Type': request.headers()['content-type'] } }).formData();
    const file = form.get('audio') as File;
    const context = JSON.parse(String(form.get('context')));
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.readUInt32LE(24)).toBe(16000);
    expect(bytes.readUInt16LE(34)).toBe(16);
    uploads.push({ context, bytes: bytes.length, mime: file.type });
    await route.fulfill({ json: { transcript: 'The character opened the door.', response: 'Your answer has been received.', provider: request.url().split('/').pop(), model: 'test-model', context } });
  });
  await page.getByRole('slider', { name: 'Video timeline' }).fill('12.5');
  await page.getByRole('button', { name: 'Enable mic' }).click();
  await expect(page.getByText('Listening for speech', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await expect(page.getByRole('button', { name: 'Send to LLM' })).toHaveCount(0);
  await page.evaluate(() => window.voiceTest.play('/test-tone.wav'));
  await page.waitForTimeout(2200);
  await expect(page.getByText('Listening for speech', { exact: true })).toBeVisible();
  expect(uploads).toHaveLength(0);
  await page.evaluate(() => window.voiceTest.play('/test-speech.wav'));
  await expect(page.getByText('Recording speech', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to LLM' })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText('Mic off', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.voiceTest.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  expect(uploads).toHaveLength(0);
  await page.getByRole('button', { name: 'Play recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop preview' }).click();
  for (const provider of ['openai', 'gemini']) {
    await page.getByRole('combobox', { name: 'Voice provider' }).selectOption(provider);
    await page.getByRole('button', { name: 'Send to LLM' }).click();
    await expect(page.getByLabel('Voice result')).toContainText('The character opened the door.');
  }
  expect(uploads).toHaveLength(2);
  expect(uploads[0].context).toEqual({ sourceId: 'default:sample.mp4', videoTime: 12.5 });
  expect(uploads[0].mime).toBe('audio/wav');
  expect(uploads[0].bytes).toBeGreaterThan(32000);
  expect(uploads[0].bytes).toBeLessThan(2 * 1024 * 1024);
  await page.screenshot({ path: 'test-results/voice-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
  expect(errors).toEqual([]);
});

test('disables the mic when leaving the voice panel and handles permission denial', async ({ page }) => {
  await page.getByRole('button', { name: 'Enable mic' }).click();
  await expect(page.getByText('Listening for speech', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: /Interstitials/ }).click();
  expect(await page.evaluate(() => window.voiceTest.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  await page.getByRole('tab', { name: 'Voice' }).click();
  await expect(page.getByText('Mic off', { exact: true })).toBeVisible();
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: 'Enable mic' }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone access was denied');
  await expect(page.getByRole('button', { name: 'Enable mic' })).toBeEnabled();
});
