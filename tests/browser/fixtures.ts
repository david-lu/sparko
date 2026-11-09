import { expect, type Locator, type Page } from '@playwright/test';
export { test, expect, type Page } from '@playwright/test';

export const readProject = (page: Page) => page.evaluate(async () => {
  const { readActiveProject } = await import('/src/features/project/database.ts' as string);
  return readActiveProject();
});

export async function openGenerationTimeline(page: Page) {
  const timeline = page.getByRole('region', { name: 'Generation timeline', exact: true });
  if (!await timeline.count()) await page.getByRole('button', { name: 'Edit generation timeline', exact: true }).click();
  await expect(timeline).toBeVisible();
  return timeline;
}

export async function closeGenerationTimeline(page: Page) {
  await page.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Generation timeline', exact: true })).toHaveCount(0);
}

export async function setVideoReference(page: Page, side: 'start' | 'end', enabled: boolean) {
  const timeline = await openGenerationTimeline(page);
  await timeline.getByRole('checkbox', { name: `Reference ${side} video`, exact: true }).setChecked(enabled);
  await closeGenerationTimeline(page);
}

export async function showImageReferences(page: Page) {
  const timeline = await openGenerationTimeline(page);
  const images = timeline.locator('.generation-image-references');
  if (await images.getAttribute('open') === null) await images.locator(':scope > summary').click();
  return images;
}

export async function showGenerationInfo(page: Page) {
  const output = page.locator('.inspector-output');
  if (await output.getAttribute('open') === null) await output.locator(':scope > summary').click();
  const details = output.locator('.generated-output-details');
  if (await details.count() && await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
  const prompt = output.locator('.interstitial-prompt-details');
  if (await prompt.getAttribute('open') === null) await prompt.locator(':scope > summary').click();
  return output.getByRole('region', { name: 'Generation info', exact: true });
}

export async function openVideo(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
}

/** Start the native drag before scrolling the stacked workspace to its target.
 * Scrolling first can move the pressed source out from under the pointer. */
export async function dragIntoView(page: Page, source: Locator, target: Locator, position?: { x: number; y: number }) {
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 3 });
  await target.scrollIntoViewIfNeeded();
  const to = (await target.boundingBox())!;
  const x = to.x + (position?.x ?? to.width / 2), y = to.y + (position?.y ?? to.height / 2);
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.move(x, y);
  await page.mouse.up();
}

export async function seekSource(page: Page, seconds: number) {
  const filmstrip = page.locator('.story-clip.type-source .story-filmstrip').first();
  await filmstrip.press('Home');
  for (let second = 0; second < Math.floor(seconds); second++) await filmstrip.press('Shift+ArrowRight');
  for (let frame = 0; frame < Math.round((seconds % 1) * 24); frame++) await filmstrip.press('ArrowRight');
  await expect(filmstrip).toHaveAttribute('aria-valuenow', String(Math.round(seconds * 24) / 24));
}

export async function addDraft(page: Page, name = 'New scene') {
  const count = await page.locator('.story-clip').count();
  await page.getByRole('button', { name: 'Add video', exact: true }).press('Enter');
  await expect(page.locator('.story-clip')).toHaveCount(count + 1);
  if (name !== 'New scene') {
    await page.getByLabel('Clip name', { exact: true }).fill(name);
    await page.getByLabel('Clip name', { exact: true }).press('Enter');
  }
  return page.locator('.story-clip.selected');
}

export async function addBridge(page: Page) {
  const source = page.locator('.story-filmstrip').first();
  await source.focus(); await source.press('Home');
  await source.press('Shift+ArrowRight'); await source.press('Shift+ArrowRight'); await source.press('s');
  await expect(page.locator('.story-clip')).toHaveCount(2);
  await page.locator('.story-crossfade').press('Enter');
  await page.getByRole('button', { name: 'Add video', exact: true }).press('Enter');
  await expect(page.locator('.story-clip')).toHaveCount(3);
}

export async function addQuestionTemplate(page: Page) {
  const count = await page.locator('.story-clip').count();
  await page.getByRole('button', { name: 'Add template Question & response', exact: true }).press('Enter');
  await expect(page.locator('.story-clip')).toHaveCount(count + 4);
  await fitAll(page);
}

export async function saveAndReopen(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async ({ suggestedName }: { suggestedName: string }) =>
      (await navigator.storage.getDirectory()).getFileHandle(suggestedName, { create: true }) });
  });
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save project', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { listRecentFiles } = await import('/src/features/project/database.ts' as string);
    return (await listRecentFiles()).length;
  })).toBeGreaterThan(0);
  await expect(page.locator('.project-status')).toHaveCount(0);
  await page.reload();
  await page.getByRole('region', { name: 'Recent projects' }).getByRole('button', { name: 'Open', exact: true }).first().click();
  await expect(page.locator('.story-canvas')).toBeVisible();
}
export async function fitAll(page:Page){
  const canvas=page.locator('.story-scroll');
  const point=await canvas.evaluate(el=>{const r=el.getBoundingClientRect();for(let y=8;y<r.height-8;y+=24)for(let x=8;x<r.width-8;x+=24){const hit=document.elementFromPoint(r.left+x,r.top+y);if(hit===el||hit?.classList.contains('story-world')||hit?.classList.contains('story-edges'))return {x,y};}throw new Error('No timeline background available to deselect');});
  await canvas.click({position:point});await page.getByRole('button',{name:'Fit',exact:true}).click();
}

export async function openTemplateMenu(page:Page){
  await page.locator('.story-scroll').click({button:'right',position:{x:12,y:12}});
  await page.getByRole('menuitem',{name:'Add template',exact:true}).click();
}
export async function saveSelectionAsTemplate(page:Page){
  const group=page.locator('.story-group.selected .story-group-header');
  if(await group.count())await group.click({button:'right'});
  else await page.locator('.story-clip.selected .story-clip-title').first().click({button:'right'});
  await page.getByRole('menuitem',{name:/^Save (group )?as template$/}).click();
}
