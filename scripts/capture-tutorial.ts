/** Capture the real editor with a disposable example project and DOM annotations.
 * Run with the dev server at localhost:3000: node --import tsx scripts/capture-tutorial.ts
 * All API calls are mocked; this never submits a generation or touches saved user projects.
 */
import { chromium, expect, type Locator } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fitAll } from '../tests/browser/fixtures';

type Rect = { x: number; y: number; width: number; height: number };
type Mark = { target: Locator; label: string; x: number; y: number };
const directory = 'src/app/tutorial/images';
await mkdir(directory, { recursive: true });
// Publish together after capture so Vite cannot reload the editor mid-screenshot.
const staging = await mkdtemp(join(tmpdir(), 'sparko-tutorial-'));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
const dimensions: Record<string, { width: number; height: number }> = {};
page.setDefaultTimeout(15_000);
// The guide is not used during capture; bootstrap its assets without importing them.
await page.route('**/src/app/HelpTutorial.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: 'export default function HelpTutorial(){return null}' }));
await page.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/status') return route.fulfill({ json: { uploadMode: 'local', requiresPassword: false, providers: { openai: false, gemini: false, comfy: true }, models: { openai: '', gemini: '' }, defaultVideo: { name: '', url: '', size: 0 } } });
  if (path === '/api/comfy/status') return route.fulfill({ json: { ready: true } });
  return route.fulfill({ status: 404, json: { error: 'No provider requests in tutorial capture.' } });
});
await page.addInitScript(() => {
  localStorage.setItem('sparko:side-width', '350');
  localStorage.setItem('sparko:story-height', '400');
  localStorage.setItem('sparko:panel-layout', JSON.stringify({ panels: [
    { id: 'library', lane: 0, visible: true, collapsed: false, size: 1 },
    { id: 'create', lane: 0, visible: false, collapsed: false, size: 1 },
    { id: 'inspector', lane: 0, visible: false, collapsed: false, size: 1 },
  ], columns: [50, 50] }));
});

async function bounds(...targets: Locator[]): Promise<Rect> {
  const boxes = await Promise.all(targets.map(async target => {
    const box = await target.boundingBox(); if (!box) throw new Error('Missing capture target'); return box;
  }));
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
}
function expand(box: Rect, left = 24, top = 66, right = 24, bottom = 32): Rect {
  const x = Math.max(0, Math.floor(box.x - left)), y = Math.max(0, Math.floor(box.y - top));
  return { x, y, width: Math.min(1280 - x, Math.ceil(box.x + box.width + right - x)), height: Math.min(1000 - y, Math.ceil(box.y + box.height + bottom - y)) };
}
async function capture(id: string, clip: Rect, marks: Mark[]) {
  const notes = await Promise.all(marks.map(async mark => ({ ...mark, target: await bounds(mark.target) })));
  // tsx preserves local function names with this helper when serializing callbacks.
  await page.evaluate('globalThis.__name = value => value');
  await page.evaluate(({ notes, clip }) => {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.id = 'tutorial-annotations';
    svg.setAttribute('width', String(innerWidth)); svg.setAttribute('height', String(innerHeight));
    svg.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:visible';
    const element = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
      const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value)); parent.append(node); return node;
    };
    const marker = element('marker', { id: 'tutorial-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, element('defs', {}));
    element('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#ffd78d' }, marker);
    for (const { target, label, x, y } of notes) {
      const labelX = clip.x + x, labelY = clip.y + y, width = label.length * 8.1 + 24, height = 34;
      const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
      const startX = Math.max(labelX + 10, Math.min(labelX + width - 10, center.x));
      const startY = center.y > labelY + height ? labelY + height : center.y < labelY ? labelY : labelY + height / 2;
      const endX = center.x < labelX ? target.x + target.width + 6 : center.x > labelX + width ? target.x - 6 : center.x;
      const endY = center.y > labelY + height ? target.y - 6 : center.y < labelY ? target.y + target.height + 6 : center.y;
      element('rect', { x: target.x - 3, y: target.y - 3, width: target.width + 6, height: target.height + 6, rx: 5, fill: 'none', stroke: '#ffd78d', 'stroke-width': 3 });
      element('path', { d: `M ${startX} ${startY} L ${endX} ${endY}`, fill: 'none', stroke: '#181610', 'stroke-width': 6 });
      element('path', { d: `M ${startX} ${startY} L ${endX} ${endY}`, fill: 'none', stroke: '#ffd78d', 'stroke-width': 3, 'marker-end': 'url(#tutorial-arrow)' });
      element('rect', { x: labelX, y: labelY, width, height, rx: 6, fill: '#ffd78d', stroke: '#181610', 'stroke-width': 1 });
      const text = element('text', { x: labelX + 12, y: labelY + 22, fill: '#211b10', 'font-family': 'Arial, sans-serif', 'font-weight': 700, 'font-size': 15 }); text.textContent = label;
    }
    document.body.append(svg);
  }, { notes, clip });
  await page.screenshot({ path: `${staging}/${id}.png`, clip, animations: 'disabled' });
  await page.locator('#tutorial-annotations').evaluate(element => element.remove());
  const png = await readFile(`${staging}/${id}.png`);
  dimensions[id] = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  console.log(`Captured ${id}`);
}
async function panels(visible: string[]) {
  await page.locator('.window-menu summary').click();
  for (const name of ['Library', 'Add clips', 'Inspector']) {
    const item = page.getByRole('menuitemcheckbox', { name, exact: true });
    if ((await item.getAttribute('aria-checked') === 'true') !== visible.includes(name)) await item.click();
  }
  await page.keyboard.press('Escape');
}

try {
  await page.goto('http://127.0.0.1:3000');
  await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled();
  await page.getByLabel('Choose video file', { exact: true }).setInputFiles({ name: 'Example video.mp4', mimeType: 'video/mp4', buffer: await readFile('tests/fixtures/interstitial-reference.mp4') });
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await expect(page.locator('.story-clip .video-filmstrip img').first()).toBeVisible();
  await panels(['Library']);
  const library = await bounds(page.locator('[data-panel-id=library]'));
  await capture('import', { x: library.x - 220, y: library.y, width: library.width + 220, height: 250 }, [
    { target: page.getByRole('button', { name: 'Import assets', exact: true }), label: 'Import your video', x: 12, y: 110 },
  ]);
  const film = page.getByRole('slider', { name: 'Scrub Example video.mp4', exact: true });
  await film.focus(); await film.press('Shift+ArrowRight'); await film.press('Shift+ArrowRight');
  await capture('playhead', expand(await bounds(page.locator('.story-clip')), 80, 80, 180, 45), [
    { target: page.locator('.story-playhead'), label: 'Choose the insertion point', x: 15, y: 10 },
  ]);
  await page.locator('.story-clip-title').click({ button: 'right' });
  const cut = page.getByRole('menuitem', { name: /Cut at playhead/ });
  await expect(cut).toBeEnabled();
  await capture('cut', expand(await bounds(cut), 24, 70, 24, 45), [
    { target: cut, label: 'Choose Cut at playhead', x: 16, y: 12 },
  ]);
  await cut.click(); await expect(page.locator('.story-clip')).toHaveCount(2);
  await panels(['Inspector']);
  for (const [index, name] of ['Before the cut', 'After the cut'].entries()) {
    await page.locator('.story-clip-title').nth(index).click();
    await page.getByLabel('Clip name', { exact: true }).fill(name); await page.getByLabel('Clip name', { exact: true }).press('Enter');
  }
  await panels(['Add clips']); await fitAll(page);
  const splitClip = expand(await bounds(page.locator('.story-clip').first(), page.locator('.story-clip').last()), 30, 70, 30, 80);
  await capture('split', splitClip, [
    { target: page.locator('.story-clip').first(), label: 'First piece', x: 14, y: 12 },
    { target: page.locator('.story-clip').last(), label: 'Second piece', x: splitClip.width - 160, y: 12 },
    { target: page.locator('.story-crossfade'), label: 'Connecting transition', x: splitClip.width / 2 - 95, y: splitClip.height - 42 },
  ]);
  const add = page.getByRole('button', { name: 'Add interstitial', exact: true });
  await capture('add', expand(await bounds(page.locator('[data-panel-id=create] .sidePanelSectionHeader'), add), 215, 10, 5, 28), [
    { target: add, label: 'Drag this card', x: 12, y: 35 },
  ]);
  const template = page.getByRole('button', { name: 'Add template Question & response', exact: true });
  await capture('templates', expand(await bounds(page.locator('[data-panel-id=create] .sidePanelSectionHeader'), page.getByRole('button', { name: 'Add template Simple scene', exact: true })), 220, 10, 5, 20), [
    { target: template, label: 'Drag a template', x: 12, y: 160 },
  ]);
  const transition = page.locator('.story-crossfade'), target = await bounds(transition);
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await add.dispatchEvent('dragstart', { dataTransfer });
  await transition.dispatchEvent('dragover', { dataTransfer, clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 });
  await expect(page.locator('.story-status')).toContainText('Release to replace transition');
  await capture('drop', expand(await bounds(page.locator('.story-clip').first(), page.locator('.story-clip').last()), 30, 85, 30, 55), [
    { target: transition, label: 'Drop onto this connection', x: 120, y: 12 },
  ]);
  await transition.dispatchEvent('drop', { dataTransfer, clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 });
  await expect(page.locator('.story-clip')).toHaveCount(3);
  await panels(['Inspector']);
  await page.getByLabel('Clip name', { exact: true }).fill('New interstitial'); await page.getByLabel('Clip name', { exact: true }).press('Enter');
  await panels(['Inspector']);
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await fitAll(page);
  await capture('inserted', expand(await bounds(page.locator('.story-clip.type-source').first(), page.locator('.story-clip.type-source').last(), page.locator('.story-clip.type-simple')), 25, 70, 25, 35), [
    { target: page.locator('.story-clip.type-simple'), label: 'Your new interstitial', x: 200, y: 12 },
  ]);
  await page.locator('.story-clip.type-simple .story-clip-title').click();
  await page.getByRole('checkbox', { name: 'Use start reference', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Use end reference', exact: true }).check();
  await page.getByLabel('Interstitial prompt', { exact: true }).fill('Continue the scene with a brief pause, then return to the same pose.');
  await page.getByRole('spinbutton', { name: 'Duration', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Duration', exact: true }).press('Escape');
  const start = page.getByRole('group', { name: 'Start reference', exact: true }), end = page.getByRole('group', { name: 'End reference', exact: true });
  await capture('references', expand(await bounds(start, end), 230, 32, 12, 45), [
    { target: start, label: 'Start: first piece', x: 12, y: 5 },
    { target: end, label: 'End: second piece', x: 12, y: 90 },
  ]);
  const generate = page.getByRole('button', { name: 'Generate', exact: true }); await expect(generate).toBeEnabled();
  const settings = expand(await bounds(page.locator('.inspector-prompt'), generate), 230, 30, 12, 24);
  await capture('generate', settings, [
    { target: page.getByLabel('Interstitial prompt', { exact: true }), label: '1. Describe the scene', x: 10, y: 20 },
    { target: page.getByRole('spinbutton', { name: 'Duration', exact: true }), label: '2. Set the duration', x: 10, y: 140 },
    { target: generate, label: '3. Click Generate', x: 10, y: settings.height - 55 },
  ]);
  await page.locator('.file-menu>summary').filter({ hasText: /^File$/ }).click();
  await capture('save', { x: 0, y: 0, width: 500, height: 230 }, [
    { target: page.getByRole('menuitem', { name: 'Save project', exact: true }), label: 'Save your project', x: 270, y: 75 },
  ]);
  await page.keyboard.press('Escape'); await page.locator('.window-menu summary').click();
  await capture('workspace', { x: 105, y: 0, width: 570, height: 320 }, [
    { target: page.getByRole('menuitemcheckbox', { name: 'Add clips', exact: true }), label: 'Show the Add clips panel', x: 265, y: 80 },
    { target: page.getByRole('menuitemcheckbox', { name: 'Lock workspace', exact: true }), label: 'Keep your layout fixed', x: 265, y: 220 },
  ]);
} finally {
  await browser.close();
}
for (const id of Object.keys(dimensions)) await copyFile(`${staging}/${id}.png`, `${directory}/${id}.png`);
await writeFile(`${directory}/dimensions.json`, JSON.stringify(dimensions, null, 2) + '\n');
await rm(staging, { recursive: true });
