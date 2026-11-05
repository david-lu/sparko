import { test, expect, openVideo, readProject, type Page } from './fixtures';

async function timelineMenu(page: Page) {
  const canvas = page.locator('.story-scroll');
  await canvas.click({ button: 'right', position: { x: 12, y: 12 } });
  const menu = page.getByRole('menu', { name: 'Timeline actions', exact: true });
  await expect(menu).toBeVisible(); return menu;
}

for (const width of [1440, 390]) test(`select orphaned clips includes disconnected chains and cycles without editing the graph at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await openVideo(page);
  let menu = await timelineMenu(page);
  await expect(menu.getByRole('menuitem', { name: 'Select orphaned clips', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  const bytes = await page.evaluate(async () => {
    const { readActiveProject, readAsset } = await import('/src/features/project/database.ts' as string);
    const { packProject } = await import('/src/features/project/archive.ts' as string);
    const project = await readActiveProject(), original = project.storyFlow.nodes[0];
    project.storyFlow = { version: 1, entryId: 'start', templates: [], nodes:
      ['start', 'next', 'isolated', 'chain-a', 'chain-b', 'cycle-a', 'cycle-b', 'upstream'].map((id, i) => ({
        ...original, id, name: id, x: i < 2 ? 40 + i * 260 : 9000 + i * 260, y: i < 2 ? 90 : 9000,
      })), edges: [['start', 'next'], ['chain-a', 'chain-b'], ['cycle-a', 'cycle-b'], ['cycle-b', 'cycle-a'], ['upstream', 'start']].map(([from, to], i) => ({
        id: `edge-${i}`, from, to, event: 'next', label: 'Next', values: [],
      })) };
    const blob = await packProject(project, [await readAsset(project.source.assetId)], new AbortController().signal, () => {});
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'Orphans.sparko', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.locator('.story-clip')).toHaveCount(8);
  const before = (await readProject(page)).storyFlow;
  const positions = () => page.locator('.story-clip,.story-toolbar').evaluateAll(elements => elements.map(element => {
    const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  const geometry = await positions();
  menu = await timelineMenu(page);
  const action = menu.getByRole('menuitem', { name: 'Select orphaned clips', exact: true });
  await expect(action).toBeEnabled(); await expect(action).toBeInViewport();
  await menu.screenshot({ path: `test-results/orphaned-clips-menu-${width}.png` });
  await action.focus(); await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0); await expect(page.locator('.story-scroll')).toBeFocused();
  expect(await page.locator('.story-clip.selected').evaluateAll(elements => elements.map(element => element.getAttribute('data-node-id')).sort()))
    .toEqual(['chain-a', 'chain-b', 'cycle-a', 'cycle-b', 'isolated', 'upstream']);
  await expect(page.locator('.story-status [role=status]')).toContainText('6 orphaned clips selected');
  expect((await readProject(page)).storyFlow).toEqual(before);
  expect(await positions()).toEqual(geometry);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
