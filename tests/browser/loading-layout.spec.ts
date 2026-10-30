import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const workspace = ['.workspace-grid', '.video-stage', '.timeline-section', '.sidebar'];
const editor = ['.interstitial-editor', '.prompt-field-heading', '.enhance-prompt', 'textarea', '.interstitial-time-fields', '.interstitial-editor button[type=submit]', '.task-status'];
async function bounds(page: Page, selectors: string[], scrollRoot?: string) {
  return page.evaluate(({ selectors, scrollRoot }) => selectors.map(selector => {
    const element = document.querySelector(selector)!;
    const scrollTop = scrollRoot ? document.querySelector(scrollRoot)?.scrollTop ?? 0 : 0;
    const { x, y, width, height } = element.getBoundingClientRect();
    return { selector, x, y: y + scrollTop, width, height };
  }), { selectors, scrollRoot });
}
function unchanged(actual: Awaited<ReturnType<typeof bounds>>, expected: Awaited<ReturnType<typeof bounds>>) {
  for (let i = 0; i < expected.length; i++) for (const property of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual[i][property] - expected[i][property]), `${expected[i].selector} ${property}`).toBeLessThanOrEqual(.25);
  }
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
  test(`initial project read keeps the chooser steady without a loading blurb at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      const samples: number[] = [];
      (window as any).__projectOverflow = samples;
      const measure = () => {
        const main = document.querySelector('.project-start');
        if (main) {
          const rect = main.getBoundingClientRect();
          samples.push(Math.max(rect.right - innerWidth, -rect.left, main.scrollWidth - main.clientWidth,
            document.documentElement.scrollWidth - innerWidth));
        }
        requestAnimationFrame(measure);
      };
      requestAnimationFrame(measure);
    });
    let releaseStatus!: () => void;
    const pendingStatus = new Promise<void>(resolve => { releaseStatus = resolve; });
    await page.route('**/api/status', async route => {
      await pendingStatus;
      await route.fulfill({ json: {
        requiresPassword: false, uploadMode: 'local', providers: { openai: true, gemini: false, comfy: true },
        models: { openai: 'test', gemini: 'test' }, defaultVideo: { name: 'sample.mp4', url: '/media/sample.mp4', size: 1000 }, defaultProject: { url: 'https://example.test/sample.sparko' },
      } });
    });
    await page.goto('/');
    await expect(page.locator('.project-start-pending')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
    await expect(page.getByText(/interactive interstitial creator/)).toBeVisible();
    const selectors = ['.project-start-header', '.project-start-actions', '.project-start-sections', '.project-start-section:first-child', '.project-start-section:last-child'];
    const pending = await bounds(page, selectors);
    await page.waitForTimeout(850);
    await expect(page.locator('.project-start-feedback')).toHaveCount(0);
    unchanged(await bounds(page, selectors), pending);
    releaseStatus();
    await expect(page.getByRole('button', { name: /Sample project/ })).toBeEnabled();
    await expect(page.locator('.project-start-empty:not(.project-start-pending)')).toBeVisible();
    unchanged(await bounds(page, selectors), pending);
    const overflow = await page.evaluate(() => (window as any).__projectOverflow as number[]);
    expect(overflow.length).toBeGreaterThan(0);
    expect(Math.max(...overflow), 'project page overflow during startup').toBeLessThanOrEqual(1);
  });

  test(`project chooser stays fixed through loading, cancellation, and error at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/status', route => route.fulfill({ json: {
      requiresPassword: false, uploadMode: 'local', providers: { openai: true, gemini: false, comfy: true },
      models: { openai: 'test', gemini: 'test' }, defaultVideo: { name: 'sample.mp4', url: '/media/sample.mp4', size: 1000 }, defaultProject: { url: 'https://example.test/sample.sparko' },
    } }));
    let releaseDownload!: () => void;
    const downloading = new Promise<void>(resolve => { releaseDownload = resolve; });
    let holdDownload = true;
    await page.route('https://example.test/sample.sparko', async route => {
      if (holdDownload) await downloading;
      await route.fulfill({ status: 503, body: 'Sample unavailable' }).catch(() => {});
    });
    await page.goto('/');
    const sample = page.getByRole('button', { name: /Sample project/ });
    await expect(sample).toBeEnabled();
    const selectors = ['.project-start-header', '.project-start-status', '.project-start-actions', '.project-start-sections', '.project-start-sample'];
    const idle = await bounds(page, selectors, '.project-start');
    await page.screenshot({ path: `test-results/project-chooser-${viewport.width}.png` });

    await sample.click();
    await expect(page.locator('.project-start-feedback[role="status"]')).toContainText('Downloading sample project');
    unchanged(await bounds(page, selectors, '.project-start'), idle);
    await page.getByRole('button', { name: 'Cancel project operation' }).click();
    releaseDownload();
    await expect(sample).toBeEnabled();
    await expect(page.locator('.project-start-feedback')).toHaveCount(0);
    unchanged(await bounds(page, selectors, '.project-start'), idle);

    holdDownload = false;
    await sample.click();
    await expect(page.getByRole('alert')).toContainText('503');
    unchanged(await bounds(page, selectors, '.project-start'), idle);
    await page.getByRole('button', { name: 'Dismiss error' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    unchanged(await bounds(page, selectors, '.project-start'), idle);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  });

  test(`discarding an edit does not show a closing message on the chooser at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
    await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled();
    await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
    await page.evaluate(() => {
      (window as any).__chooserMessages = [];
      new MutationObserver(() => {
        const message = document.querySelector('.project-start-feedback[role="status"]')?.textContent;
        if (message) (window as any).__chooserMessages.push(message);
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await page.getByText('File', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Close project' }).click();
    await page.getByRole('dialog', { name: 'Save changes before closing?' }).getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
    expect(await page.evaluate(() => (window as any).__chooserMessages)).toEqual([]);
  });

  test(`loading preserves workspace and editor geometry at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const video = await readFile('tests/fixtures/interstitial-reference.mp4');
    await page.route('**/api/status', route => route.fulfill({ json: {
      requiresPassword: false, uploadMode: 'local', providers: { openai: true, gemini: false, comfy: true },
      models: { openai: 'test', gemini: 'test' }, defaultVideo: { name: 'sample.mp4', url: '/media/sample.mp4', size: video.length }, defaultProject: null,
    } }));
    await page.goto('/');
    await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
    await expect(page.getByRole('button', { name: /^Add regular interstitial/ })).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator('.buffering')).toHaveCount(0);

    // Opening a project leaves the workspace geometry stable.
    const baseWorkspace = await bounds(page, workspace);
    unchanged(await bounds(page, workspace), baseWorkspace);

    await page.getByRole('slider', { name: 'Video timeline', exact: true }).fill('2');
    await page.getByRole('button', { name: /^Add regular interstitial/ }).click();
    await page.getByLabel('Interstitial prompt').fill('Continue the dance');
    await page.locator('.sidebar').evaluate(element => { element.scrollTop = 0; });
    const idleEditor = await bounds(page, editor);
    let finishEnhancing!: () => void;
    const enhancing = new Promise<void>(resolve => { finishEnhancing = resolve; });
    await page.route('**/api/interstitials/enhance-prompt', async route => {
      await enhancing;
      await route.fulfill({ json: { prompt: 'Continue the dance in the same shot.', model: 'test' } });
    });
    await page.getByRole('button', { name: 'Enhance prompt', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByRole('button', { name: 'Enhancing…', exact: true })).toBeDisabled();
    unchanged(await bounds(page, editor), idleEditor);
    finishEnhancing();
    await expect(page.getByLabel('Interstitial prompt')).toHaveValue('Continue the dance in the same shot.');
    unchanged(await bounds(page, editor), idleEditor);

    let complete = false, releaseDownload!: () => void;
    const downloading = new Promise<void>(resolve => { releaseDownload = resolve; });
    await page.route('**/api/comfy/interstitials', route => route.fulfill({ status: 202, json: { requestId: 'layout-job', status: 'IN_QUEUE' } }));
    await page.route('**/api/comfy/jobs/layout-job', route => route.fulfill({ json: complete
      ? { requestId: 'layout-job', status: 'COMPLETED', videoUrl: 'https://example.test/layout.mp4', insertion: { start: 1, duration: 2, totalDuration: 4 } }
      : { requestId: 'layout-job', status: 'IN_PROGRESS', progress: .4, progressDetails: { stage: 'A long generation stage that must never wrap and push the editor controls down', step: 8, steps: 20 } } }));
    await page.route('https://example.test/layout.mp4', async route => { await downloading; await route.fulfill({ contentType: 'video/mp4', body: video }); });
    await page.getByRole('button', { name: 'Generate', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByRole('progressbar', { name: 'Generating interstitial' })).toBeVisible({ timeout: 60_000 });
    unchanged(await bounds(page, editor), idleEditor);
    await expect(page.getByRole('button', { name: 'Cancel interstitial generation' })).toBeEnabled();
    complete = true;
    await expect(page.getByRole('progressbar', { name: 'Downloading generated video' })).toBeVisible();
    unchanged(await bounds(page, editor), idleEditor);
    await page.screenshot({ path: `test-results/loading-states-${viewport.width}.png` });
    releaseDownload();
    await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled({ timeout: 60_000 });
    // A new result legitimately adds a video preview. Controls above it must stay put.
    unchanged(await bounds(page, editor.slice(1)), idleEditor.slice(1));

    // Hold the file writer so the busy workspace can be measured even when archive code is eager-loaded.
    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({
        name: 'layout.sparko',
        createWritable: async () => {
          await new Promise<void>(resolve => { (window as any).__releaseSave = resolve; });
          return { write: async () => {}, close: async () => {}, abort: async () => {} };
        },
      }) });
    });
    const beforeExport = await bounds(page, workspace);
    await page.locator('.file-menu summary').first().click();
    await page.getByRole('menuitem', { name: 'Save project', exact: true }).click();
    await expect(page.locator('.project-status')).toBeVisible();
    unchanged(await bounds(page, workspace), beforeExport);
    await page.getByRole('button', { name: 'Cancel project operation' }).click();
    await page.evaluate(() => (window as any).__releaseSave());
    await expect(page.locator('.project-status')).toHaveCount(0);
    unchanged(await bounds(page, workspace), beforeExport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  });

  test(`all clip phases preserve headers, rows and controls at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/__loading-layout', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('/src/main.tsx', '/tests/browser/loading-layout-harness.tsx') });
    });
    await page.goto('/__loading-layout');
    await expect(page.locator('#clip .interstitial-editor').first()).toBeVisible();
    await page.getByRole('button', { name: 'Enable mic', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    const selectors = ['#clip .panel-content', ...[1, 2, 3, 4].map(n => `#clip .clip-subpanel:nth-child(${n}) .clip-subpanel-heading`), '#clip .interstitial-editor', '#clip textarea', '#clip .interstitial-time-fields', '#clip button[type=submit]', '#clip .task-status', '#rows .interstitial-row', '#voice .mic-status', '#voice .voice-capture-actions', '#voice .voice-capture-actions>.button'];
    const idle = await bounds(page, selectors);
    const stages = [
      { phase: 'preparing', progress: .2 }, { phase: 'uploading' }, { phase: 'queued', queuePosition: 1000 },
      { phase: 'rendering', progress: .4, progressDetails: { stage: 'A very long provider status that must fit within one row without changing the clip layout', step: 8, steps: 20 } },
      { phase: 'loading', progressDetails: { stage: 'Downloading generated video' } },
      { phase: 'loading', progress: .7, progressDetails: { stage: 'Saving generated video' } },
      { phase: 'loading', progressDetails: { stage: 'Checking generated video' } }, { phase: 'ready' },
    ];
    for (const patch of stages) {
      await page.evaluate(patch => (window as any).setClipPhase(patch), patch);
      await expect(page.locator('#clip .clip-subpanel-heading').first()).toContainText(patch.phase === 'ready' ? 'Video ready' : patch.phase === 'preparing' ? 'Preparing' : patch.phase === 'uploading' ? 'Uploading' : patch.phase === 'queued' ? 'Queued' : patch.progressDetails!.stage);
      unchanged(await bounds(page, selectors), idle);
    }
    for (const [phase, label] of Object.entries({ requesting: 'Waiting for microphone access', loading: 'Loading speech detection', listening: 'Listening for speech', recording: 'Recording speech', stopping: 'Finishing answer', idle: 'Mic off' })) {
      await page.evaluate(phase => (window as any).setMicPhase(phase), phase);
      await expect(page.locator('#voice .mic-status')).toContainText(label);
      unchanged(await bounds(page, selectors), idle);
    }
    await page.evaluate(() => (window as any).setMicPhase('ready'));
    const send = page.getByRole('button', { name: 'Send to LLM', exact: true });
    await expect(send).toBeEnabled();
    let voiceRequests = 0;
    await page.route('**/api/voice/openai', async route => {
      if (++voiceRequests === 1) await route.fulfill({ json: { transcript: 'Test answer', response: 'Test response', provider: 'openai', model: 'test', context: { sourceId: 'test', videoTime: 0 } } });
    });
    await send.evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByRole('article', { name: 'Voice result' })).toBeVisible();
    const voiceSelectors = ['#voice .panel-content', '#voice .analysis-result', '#voice .task-status', '#voice .voice-review'];
    const voiceIdle = await bounds(page, voiceSelectors);
    await send.evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByRole('button', { name: 'Cancel voice request' })).toBeVisible();
    unchanged(await bounds(page, voiceSelectors), voiceIdle);
    await page.getByRole('button', { name: 'Cancel voice request' }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(send).toBeEnabled();
    unchanged(await bounds(page, voiceSelectors), voiceIdle);
    // Analysis keeps the existing result visible while its replacement is pending.
    const analysis = await bounds(page, ['#analysis .panel-content', '#analysis .analysis-result', '#analysis .task-status']);
    await page.route('**/api/analyze/openai', () => {});
    await page.locator('#analysis button[type=submit]').evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByRole('button', { name: 'Cancel analysis' })).toBeVisible();
    unchanged(await bounds(page, ['#analysis .panel-content', '#analysis .analysis-result', '#analysis .task-status']), analysis);
    await page.getByRole('button', { name: 'Cancel analysis' }).evaluate(button => (button as HTMLButtonElement).click());
    unchanged(await bounds(page, ['#analysis .panel-content', '#analysis .analysis-result', '#analysis .task-status']), analysis);
  });
}
