import { test as base } from '@playwright/test';
import path from 'node:path';
export { expect, type Page } from '@playwright/test';

// Prepare the real episode once per worker. Each test still gets isolated browser storage.
export const test = base.extend<{}, { preparedDefault: string }>({
  preparedDefault: [async ({ browser }, use, worker) => {
    const page = await browser.newPage();
    let prepared: string;
    try {
      await page.route('**/__prepare-test-video', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Prepare test video</title>' }));
      await page.goto('http://127.0.0.1:3000/__prepare-test-video');
      await page.evaluate(async () => {
        const { prepareVideo } = await import('/src/media/prepareVideo.ts' as string);
        const source = await (await fetch('/media/episode_mock.mp4')).blob();
        const blob = await prepareVideo(source, new AbortController().signal, () => undefined);
        (window as any).preparedUrl = URL.createObjectURL(blob);
      });
      const downloaded = page.waitForEvent('download');
      await page.evaluate(() => {
        const link = document.createElement('a'); link.href = (window as any).preparedUrl;
        link.download = 'episode_mock.24fps.mp4'; link.click();
      });
      prepared = path.join(worker.project.outputDir, `episode-24fps-worker-${worker.workerIndex}.mp4`);
      await (await downloaded).saveAs(prepared);
    } finally { await page.close(); }
    const url = new URL(path.relative(process.cwd(), prepared).split(path.sep).map(encodeURIComponent).join('/'), 'http://127.0.0.1:3000/').href;
    await use(url);
  }, { scope: 'worker', timeout: 180_000 }],
  page: async ({ page, preparedDefault }, use) => {
    await page.route('**/media/episode_mock.mp4', route => route.continue({ url: preparedDefault }));
    await use(page);
  },
});
