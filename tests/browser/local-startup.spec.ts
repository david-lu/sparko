import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`local startup renders with pulled Vercel settings at ${width}px`, async ({ page, request, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [], failedScripts: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.request().resourceType() === 'script' && !response.ok()) failedScripts.push(new URL(response.url()).pathname);
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Make videos pop.' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
    const status = await request.get('/api/status');
    expect(await status.json()).toMatchObject({ uploadMode: 'local', providers: { openai: false, gemini: false, comfy: false } });
    // Same-origin browser modules load while cross-site requests remain blocked.
    expect((await request.get('/src/main.tsx', { headers: { Origin: baseURL! } })).status()).toBe(200);
    expect((await request.get('/src/main.tsx', { headers: { Origin: 'https://untrusted.example' } })).status()).toBe(403);
    expect((await request.get('/api/status', { headers: { Host: 'untrusted.example' } })).status()).toBe(403);
    await page.getByRole('button', { name: /^New project/ }).click();
    await expect(page.locator('.menu-document')).toHaveText('Untitled project');
    await expect(page.locator('.story-canvas')).toBeVisible();
    expect(errors).toEqual([]);
    expect(failedScripts).toEqual([]);
  });
}
