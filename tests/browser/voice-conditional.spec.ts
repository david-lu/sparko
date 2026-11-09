import { readFile } from 'node:fs/promises';
import { expect, fitAll, test, type Page } from './fixtures';

declare global { interface Window { voiceTest: { play: (url: string) => Promise<void> } } }

const saved = (page: Page) => page.evaluate(async () => { const { readActiveProject } = await import('/src/features/project/database.ts' as string); return readActiveProject(); });

test.beforeEach(async ({ page }) => {
  // Inject speech through a synthetic stream. Tests never access the user's microphone.
  await page.addInitScript(() => {
    window.voiceTest = { play: async () => undefined };
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const destination = context.createMediaStreamDestination();
      window.voiceTest.play = async url => {
        const source = context.createBufferSource();
        source.buffer = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
        source.connect(destination); source.start();
      };
      return destination.stream;
    };
  });
  await page.route('**/test-speech.wav', async route => route.fulfill({ contentType: 'audio/wav', body: await readFile('tests/fixtures/voice-answer.wav') }));
  await page.route('**/api/status', async route => {
    const body = await (await route.fetch()).json();
    await route.fulfill({ json: { ...body, providers: { ...body.providers, hume: true } } });
  });
});

async function openVoiceQuestion(page: Page) {
  await page.goto('/'); await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-clip')).toHaveCount(1, { timeout: 60000 });
  await page.getByRole('button', { name: 'Add template Question & response', exact: true }).dragTo(page.locator('.story-scroll'), { force: true, targetPosition: { x: 250, y: 80 } });
  await fitAll(page);
  const project = await saved(page), source = project.storyFlow.nodes.find((n: any) => n.kind === 'source'), question = project.storyFlow.nodes.find((n: any) => n.name === 'Ask a question');
  await page.locator(`[data-node-id="${source.id}"] .story-port.output`).dragTo(page.locator(`[data-node-id="${question.id}"] .story-port.input`));
  await expect.poll(async () => (await saved(page)).storyFlow.edges.some((e: any) => e.from === source.id && e.to === question.id)).toBe(true);
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click(); await fitAll(page);
  await page.locator('.story-clip.type-conditional .story-clip-title').click();
  await expect(page.getByRole('button', { name: 'Choose Yes', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Voice', exact: true }).check();
  await expect(page.getByText(/Viewers answer out loud/)).toBeVisible();
  await expect.poll(async () => (await saved(page)).storyFlow.nodes.find((n: any) => n.kind === 'conditional' || n.conditional)?.conditionInput).toBe('voice');
  return project.storyFlow.nodes.find((n: any) => n.name === 'Celebrate');
}
// Measure after the entry animation, which scales the button while it pops in.
const box = async (page: Page) => {
  const button = page.locator('.voice-answer-button');
  await button.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
  return (await button.boundingBox())!;
};

test('a voice conditional listens, keeps its layout while judging, and follows the matched condition', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let release!: () => void; const judged = new Promise<void>(resolve => { release = resolve; });
  const requests: { options: { id: string; label: string }[]; question?: string; bytes: Buffer }[] = [];
  await page.route('**/api/voice/choice', async route => {
    const request = route.request();
    const form = await new Response(Uint8Array.from(request.postDataBuffer()!), { headers: { 'Content-Type': request.headers()['content-type'] } }).formData();
    const context = JSON.parse(String(form.get('context')));
    requests.push({ ...context, bytes: Buffer.from(await (form.get('audio') as File).arrayBuffer()) });
    await judged;
    await route.fulfill({ json: { answerId: context.options.find((o: { label: string }) => o.label === 'Yes').id, probability: 0.92, model: 'test-hume' } });
  });
  const celebrate = await openVoiceQuestion(page);
  const controls = page.getByRole('group', { name: 'Choose an answer' });
  await expect(controls.getByRole('button', { name: /^Choose / })).toHaveCount(0);
  const talk = controls.getByRole('button', { name: 'Answer out loud: Tap to talk', exact: true });
  await expect(talk).toBeVisible();
  const idle = await box(page);
  await talk.click();
  await expect(controls.getByRole('button', { name: 'Answer out loud: Listening…', exact: true })).toBeVisible({ timeout: 30000 });
  expect(await box(page)).toEqual(idle);
  await page.evaluate(() => window.voiceTest.play('/test-speech.wav'));
  const thinking = controls.getByRole('button', { name: 'Answer out loud: Thinking…', exact: true });
  await expect(thinking).toBeVisible({ timeout: 30000 });
  await expect(thinking).toHaveAttribute('aria-busy', 'true');
  expect(await box(page)).toEqual(idle);
  await page.screenshot({ path: 'test-results/voice-conditional-thinking.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(thinking).toBeVisible();
  const narrow = await box(page);
  expect(narrow.x).toBeGreaterThanOrEqual(0); expect(narrow.x + narrow.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/voice-conditional-thinking-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });

  expect(requests).toHaveLength(1);
  expect(requests[0].options.map(o => o.label)).toEqual(['Yes', 'Not yet']);
  expect(requests[0].question).toBe('Wait for the viewer');
  expect(requests[0].bytes.toString('ascii', 0, 4)).toBe('RIFF'); expect(requests[0].bytes.readUInt32LE(24)).toBe(16000);
  release();
  await expect(controls.getByRole('button', { name: 'Choose Yes', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`[data-node-id="${celebrate.id}"] .story-playhead`)).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('a voice conditional offers buttons when the microphone is unavailable', async ({ page }) => {
  await openVoiceQuestion(page);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: 'Answer out loud: Tap to talk', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose Yes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose Not yet', exact: true })).toBeVisible();
  await expect(page.locator('.voice-answer-button')).toHaveCount(0);
});
