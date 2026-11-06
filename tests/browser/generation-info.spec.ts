import { readFile } from 'node:fs/promises';
import { test, expect, openVideo, readProject, showGenerationInfo } from './fixtures';
import { writeClipMetadata } from '../../src/media/clipMetadata';
import { clipMetadata } from '../fixtures/clip-metadata';

for (const width of [1440, 390]) test(`generation details belong to the compact generated output at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  await page.locator('.story-clip-title').click();
  await expect(page.locator('.asset-generation-info')).toHaveCount(0);
  await expect(page.getByText('Render info', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal in Library', exact: true }).click();
  await expect(page.locator('.asset-generation-info')).toHaveCount(0);
  await expect(page.getByText('No generation information was saved with this media.', { exact: true })).toHaveCount(0);

  const metadata = { ...clipMetadata, seed: 42 };
  const blob = await writeClipMetadata(new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')], { type: 'video/mp4' }), metadata, new AbortController().signal);
  await page.getByLabel('Import videos onto timeline', { exact: true }).setInputFiles({ name: 'Generated.mp4', mimeType: 'video/mp4', buffer: Buffer.from(await blob.arrayBuffer()) });
  const output = page.locator('.inspector-output');
  await expect(output).toHaveCount(1); await expect(output).not.toHaveAttribute('open');
  expect((await output.boundingBox())!.height).toBeLessThanOrEqual(30);
  await expect(page.getByText('Render info', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Generation info', includeHidden: true })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Generation info', includeHidden: true })).toBeHidden();
  await output.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/compact-generation-closed-${width}.png`, fullPage: true });

  await showGenerationInfo(page);
  await expect(output.getByLabel('Generation seed', { exact: true })).toHaveText('42');
  await expect(output.getByRole('region', { name: 'Generation info', exact: true })).toContainText('Comfy · H3');
  await expect(output.locator('.interstitial-prompt-details')).toHaveCount(1);
  await expect(output.locator('.interstitial-prompt-details pre')).toHaveText(metadata.prompt);
  await expect(output.getByRole('region', { name: 'Video breakdown', exact: true })).toBeVisible();
  expect((await output.getByRole('region', { name: 'Generation info', exact: true }).boundingBox())!.height).toBeLessThan(150);
  await page.getByLabel('Video prompt', { exact: true }).fill('A future generation prompt');
  await expect(output.locator('.interstitial-prompt-details pre')).toHaveText(metadata.prompt);
  const assetId = (await readProject(page)).interstitials[0].result.assetId;
  await page.getByRole('button', { name: 'Reveal in Library', exact: true }).click();
  await expect(output).not.toHaveAttribute('open');
  expect((await output.boundingBox())!.height).toBeLessThanOrEqual(30);
  await expect(await showGenerationInfo(page)).toContainText(metadata.prompt);
  await expect(page.locator('.asset-generation-info')).toHaveCount(1);
  expect((await readProject(page)).library.find((a: any) => a.assetId === assetId).generation.result.prompt).toBe(metadata.prompt);
  await output.locator('summary').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/compact-generation-library-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
