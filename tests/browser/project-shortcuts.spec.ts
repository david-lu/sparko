import { test, expect, openVideo, type Page } from './fixtures';

const archivedClipName = (page: Page, name: string) => page.evaluate(async fileName => {
  try {
    const { unpackProject } = await import('/src/features/project/archive.ts' as string);
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle(fileName)).getFile();
    return (await unpackProject(file, new AbortController().signal, () => undefined)).project.storyFlow.nodes[0].name;
  } catch (error) {
    if (['NotReadableError', 'NotFoundError'].includes((error as DOMException).name)) return '';
    throw error;
  }
}, name);

for (const modifier of ['Control', 'Meta']) test(`${modifier} save shortcuts commit edits, update the current file, and save a separate copy`, async ({ page }) => {
  await openVideo(page);
  await page.evaluate(() => {
    (window as any).savePickerCalls = 0;
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => {
      const name = ++(window as any).savePickerCalls === 1 ? 'First.sparko' : 'Copy.sparko';
      return (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
    } });
  });
  await page.locator('.story-clip-title').click();
  const name = page.getByLabel('Clip name', { exact: true });
  await name.fill('First edit');
  await page.keyboard.press(`${modifier}+s`);
  await expect(page.locator('.menu-document')).toHaveText('First.sparko');
  await expect.poll(() => archivedClipName(page, 'First.sparko')).toBe('First edit');

  await name.fill('Separate copy');
  await page.keyboard.press(`${modifier}+Shift+s`);
  await expect(page.locator('.menu-document')).toHaveText('Copy.sparko');
  await expect.poll(() => archivedClipName(page, 'Copy.sparko')).toBe('Separate copy');
  expect(await archivedClipName(page, 'First.sparko')).toBe('First edit');

  await name.fill('Updated copy');
  await page.keyboard.press(`${modifier}+s`);
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
  await expect.poll(() => archivedClipName(page, 'Copy.sparko')).toBe('Updated copy');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.keyboard.press(`${modifier}+s`);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).savePickerCalls)).toBe(2);
  await page.getByText('File', { exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Save project', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Control+S Meta+S');
  await expect(page.getByRole('menuitem', { name: 'Save as new file', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+S Meta+Shift+S');
});

test('save shortcuts prevent duplicate pickers and recover after cancellation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^New project/ }).click();
  await expect(page.locator('.workspace-grid')).toBeVisible();
  await page.evaluate(() => {
    (window as any).savePickerCalls = 0;
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: () => {
      (window as any).savePickerCalls++;
      return new Promise((_, reject) => { (window as any).cancelSavePicker = () => reject(new DOMException('Cancelled', 'AbortError')); });
    } });
  });
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Meta+s');
  await page.keyboard.press('Control+Shift+s');
  expect(await page.evaluate(() => (window as any).savePickerCalls)).toBe(1);
  await page.evaluate(() => (window as any).cancelSavePicker());
  await page.keyboard.press('Meta+Shift+s');
  expect(await page.evaluate(() => (window as any).savePickerCalls)).toBe(2);
  await page.evaluate(() => (window as any).cancelSavePicker());
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('save shortcuts download a project when the native file picker is unavailable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^New project/ }).click();
  await expect(page.locator('.workspace-grid')).toBeVisible();
  await page.evaluate(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }));
  for (const shortcut of ['Control+s', 'Meta+Shift+s']) {
    const downloading = page.waitForEvent('download');
    await page.keyboard.press(shortcut);
    expect((await downloading).suggestedFilename()).toBe('Untitled project.sparko');
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled();
  }
});

for (const width of [1440, 600]) test(`unchanged saves skip writes and loading UI at ${width}px, including after reopening`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await openVideo(page);
  await page.evaluate(() => {
    (window as any).projectWrites = 0;
    (window as any).fileWrites = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'projects') (window as any).projectWrites++;
      return put.apply(this, args);
    };
    const createWritable = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function (...args) {
      (window as any).fileWrites++;
      return createWritable.apply(this, args);
    };
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () =>
      (await navigator.storage.getDirectory()).getFileHandle('Unchanged.sparko', { create: true }) });
  });
  await page.keyboard.press('Control+s');
  await expect(page.locator('.menu-document')).toHaveText('Unchanged.sparko');
  await expect(page.locator('.project-status')).toHaveCount(0);
  const counts = () => page.evaluate(() => ({ project: (window as any).projectWrites, file: (window as any).fileWrites }));
  const saved = await counts();
  expect(saved.file).toBe(1);
  await page.locator('.story-clip-title').click();
  const name = page.getByLabel('Clip name', { exact: true });
  const originalName = await name.inputValue();
  await name.fill(originalName); await name.press('Enter');
  const before = await page.locator('.story-scroll').boundingBox();
  await page.evaluate(() => {
    (window as any).showedSaveProgress = false;
    new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node instanceof Element &&
        (node.matches('.project-status') || node.querySelector('.project-status'))))) (window as any).showedSaveProgress = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.keyboard.press('Control+s'); await page.keyboard.press('Meta+s');
  expect(await counts()).toEqual(saved);
  expect(await page.evaluate(() => (window as any).showedSaveProgress)).toBe(false);
  expect(await page.locator('.story-scroll').boundingBox()).toEqual(before);

  await name.fill('Changed'); await name.press('Enter'); await name.blur();
  await page.keyboard.press('Control+z');
  await expect(name).toHaveValue(originalName);
  await page.keyboard.press('Control+s');
  expect((await counts()).file).toBe(1);

  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close project', exact: true }).click();
  await expect(page.getByRole('button', { name: /^New project/ })).toBeVisible();
  await page.getByRole('region', { name: 'Recent projects' }).getByRole('button', { name: 'Open', exact: true }).first().click();
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await expect(page.locator('.project-status')).toHaveCount(0);
  await page.keyboard.press('Control+s');
  expect((await counts()).file).toBe(1);
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close project', exact: true }).click();
  await expect(page.getByRole('button', { name: /^New project/ })).toBeVisible();
});
