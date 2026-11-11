/** Capture the tutorial pictures and the README screenshots from the real editor.
 * Run with the dev server running: node --import tsx scripts/capture-tutorial.ts
 * SPARKO_URL selects another server (default http://127.0.0.1:3000).
 * Footage comes from examples/sample.sparko (run `git lfs pull` first); without it a plain test clip is used
 * and the README screenshots are skipped.
 * All API calls are mocked; this never submits a generation or touches saved user projects.
 */
import { chromium, expect, type Locator } from '@playwright/test';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
import { openAsBlob } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fitAll } from '../tests/browser/fixtures';

type Rect = { x: number; y: number; width: number; height: number };
type Mark = { target: Locator; label: string; x: number; y: number };
const url = process.env.SPARKO_URL || 'http://127.0.0.1:3000';
const sample = 'examples/sample.sparko', sampleScene = 'assets/34f3046d-cc07-49a2-b409-67cee9b0428b';
// A Git LFS pointer is a few hundred bytes; the real archive is far larger.
const hasSample = await stat(sample).then(file => file.size > 1_000_000, () => false);
async function exampleVideo() {
  if (!hasSample) return readFile('tests/fixtures/interstitial-reference.mp4');
  const zip = new ZipReader(new BlobReader(await openAsBlob(sample)));
  try {
    const entry = (await zip.getEntries()).find(item => item.filename === sampleScene);
    if (!entry || entry.directory) throw new Error(`${sample} has no ${sampleScene}`);
    return Buffer.from(await (await entry.getData(new BlobWriter())).arrayBuffer());
  } finally { await zip.close(); }
}
const status = { uploadMode: 'local', requiresPassword: false, providers: { openai: true, gemini: false, comfy: true, fal: true, elevenlabs: true }, models: { openai: '', gemini: '' }, defaultVideo: { name: '', url: '', size: 0 } };
const directory = 'src/app/tutorial/images', readmeDirectory = 'docs/images';
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
  if (path === '/api/status') return route.fulfill({ json: status });
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
  await page.goto(url);
  await page.getByRole('button', { name: /^New project/ }).click();
  const importButton = page.getByRole('button', { name: 'Import videos or images', exact: true });
  await expect(importButton).toBeVisible();
  await capture('import', expand(await bounds(page.locator('.story-empty')), 260, 60, 260, 90), [
    { target: importButton, label: 'Or click to choose a video', x: 20, y: 250 },
  ]);
  const chooser = page.waitForEvent('filechooser');
  await importButton.click();
  await (await chooser).setFiles({ name: 'Example video.mp4', mimeType: 'video/mp4', buffer: await exampleVideo() });
  await expect(page.locator('.story-clip')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('.story-clip .video-filmstrip img').first()).toBeVisible();
  await panels(['Library']);
  const film = page.getByRole('slider', { name: 'Scrub Example video.mp4', exact: true });
  await film.focus();
  for (let second = 0; second < (hasSample ? 4 : 2); second++) await film.press('Shift+ArrowRight');
  await capture('playhead', expand(await bounds(page.locator('.story-clip')), 80, 80, 180, 45), [
    { target: page.locator('.story-playhead'), label: 'Choose the insertion point', x: 15, y: 10 },
  ]);
  await page.locator('.story-clip-title').click({ button: 'right' });
  const cut = page.getByRole('menuitem', { name: /Cut at playhead/ });
  await expect(cut).toBeEnabled();
  await capture('cut', expand(await bounds(cut), 24, 150, 60, 45), [
    { target: cut, label: 'Choose Cut at playhead', x: 16, y: 12 },
  ]);
  await cut.click(); await expect(page.locator('.story-clip')).toHaveCount(2);
  await panels(['Inspector']); await fitAll(page);
  for (const [index, name] of ['Before the cut', 'After the cut'].entries()) {
    await page.locator('.story-clip-title').nth(index).click();
    await page.getByLabel('Clip name', { exact: true }).fill(name); await page.getByLabel('Clip name', { exact: true }).press('Enter');
  }
  await panels(['Add clips']); await fitAll(page);
  const splitClip = expand(await bounds(page.locator('.story-clip').first(), page.locator('.story-clip').last()), 30, 70, 30, 80);
  await capture('split', splitClip, [
    { target: page.locator('.story-clip').first(), label: 'First piece', x: 14, y: 12 },
    { target: page.locator('.story-clip').last(), label: 'Second piece', x: splitClip.width - 160, y: 12 },
    { target: page.locator('.story-crossfade'), label: 'Connecting line', x: splitClip.width / 2 - 70, y: splitClip.height - 42 },
  ]);
  const add = page.getByRole('button', { name: 'Add video', exact: true });
  const createHeader = page.locator('[data-panel-id=create] .sidePanelSectionHeader');
  await capture('add', expand(await bounds(createHeader, add), 215, 10, 5, 28), [
    { target: add, label: 'Drag this card', x: 12, y: 35 },
  ]);
  const addImage = page.getByRole('button', { name: 'Add image', exact: true }), addAudio = page.getByRole('button', { name: 'Add audio', exact: true });
  await capture('media', expand(await bounds(createHeader, addAudio), 240, 10, 5, 28), [
    { target: addImage, label: 'Make a picture', x: 12, y: 60 },
    { target: addAudio, label: 'Make speech or sound', x: 12, y: 150 },
  ]);
  const template = page.getByRole('button', { name: 'Add template Question & response', exact: true });
  await capture('templates', expand(await bounds(createHeader, page.getByRole('button', { name: 'Add template Simple scene', exact: true })), 220, 10, 5, 20), [
    { target: template, label: 'Drag a template', x: 12, y: 160 },
  ]);
  const transition = page.locator('.story-crossfade'), target = await bounds(transition);
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await add.dispatchEvent('dragstart', { dataTransfer });
  await transition.dispatchEvent('dragover', { dataTransfer, clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 });
  await expect(page.locator('.story-status')).toContainText('Release to replace transition');
  await capture('drop', expand(await bounds(page.locator('.story-clip').first(), page.locator('.story-clip').last()), 30, 85, 30, 55), [
    { target: transition, label: 'Drop onto this line', x: 120, y: 12 },
  ]);
  await transition.dispatchEvent('drop', { dataTransfer, clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 });
  await expect(page.locator('.story-clip')).toHaveCount(3);
  await page.getByRole('button', { name: 'Auto layout', exact: true }).click();
  await fitAll(page);
  const scene = page.locator('.story-clip.type-simple');
  await capture('inserted', expand(await bounds(page.locator('.story-clip.type-source').first(), page.locator('.story-clip.type-source').last(), scene), 25, 70, 25, 35), [
    { target: scene, label: 'Your new scene', x: 200, y: 12 },
  ]);
  await panels(['Inspector']);
  await scene.locator('.story-clip-title').click();
  const prompt = page.getByLabel('Video prompt', { exact: true });
  await prompt.fill('She looks up from the screen, smiles, and waves at the camera.');
  const timeline = page.getByRole('button', { name: 'Edit generation timeline', exact: true });
  const generate = page.getByRole('button', { name: 'Generate', exact: true }); await expect(generate).toBeEnabled();
  await generate.scrollIntoViewIfNeeded();
  const settings = expand(await bounds(page.locator('.inspector-prompt'), generate), 230, 30, 12, 24);
  await capture('generate', settings, [
    { target: prompt, label: '1. Describe the scene', x: 10, y: 20 },
    { target: timeline, label: '2. Open Timeline', x: 10, y: Math.max(140, (await bounds(timeline)).y - settings.y) },
    { target: generate, label: '3. Click Generate', x: 10, y: settings.height - 55 },
  ]);
  await timeline.click();
  const editor = page.getByRole('region', { name: 'Generation timeline', exact: true });
  const start = editor.getByRole('checkbox', { name: 'Reference start video', exact: true }), end = editor.getByRole('checkbox', { name: 'Reference end video', exact: true });
  await expect(start).toBeChecked(); await expect(end).toBeChecked();
  const duration = editor.getByRole('spinbutton', { name: 'Duration', exact: true }).last();
  // Show the first piece in the preview instead of the still-empty generated section.
  const ruler = editor.getByRole('slider', { name: 'Timeline ruler', exact: true });
  await ruler.focus(); await ruler.press('Home'); await ruler.press('Shift+ArrowRight');
  await page.waitForTimeout(1500);
  const editorBox = await bounds(editor);
  await capture('references', { x: Math.floor(editorBox.x), y: Math.floor(editorBox.y), width: Math.ceil(editorBox.width), height: Math.ceil(editorBox.height) }, [
    { target: start, label: 'Start: matches the first piece', x: editorBox.width - 590, y: 105 },
    { target: end, label: 'End: matches the second piece', x: editorBox.width - 590, y: 200 },
    { target: duration, label: 'Length of the new scene', x: editorBox.width - 480, y: (await bounds(duration)).y - editorBox.y - 70 },
  ]);
  await page.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
  await panels(['Add clips', 'Inspector']);
  await addImage.focus(); await addImage.press('Enter');
  await panels(['Inspector']);
  const imagePrompt = page.getByLabel('Generation prompt', { exact: true });
  await imagePrompt.fill('A friendly robot waving in a bright workshop, flat cartoon style.');
  const model = page.getByLabel('Generation model', { exact: true }), generateImage = page.getByRole('button', { name: 'Generate image', exact: true });
  const imageSettings = expand(await bounds(model, imagePrompt), 230, 30, 12, 30);
  await capture('image', imageSettings, [
    { target: model, label: '1. Pick a model', x: 10, y: 10 },
    { target: imagePrompt, label: '2. Describe the picture', x: 10, y: imageSettings.height - 110 },
  ]);
  void generateImage;
  await page.keyboard.press('Mod+Z').catch(() => {});
  await fitAll(page);
  const addCharacter = page.getByRole('button', { name: 'Add character', exact: true });
  await addCharacter.scrollIntoViewIfNeeded();
  await capture('characters', expand(await bounds(addCharacter), 420, 30, 12, 110), [
    { target: addCharacter, label: 'Add a character', x: 10, y: 60 },
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
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(640, 500);
  await capture('preview', { x: 0, y: 0, width: 1280, height: 760 }, [
    { target: page.getByRole('button', { name: 'Edit', exact: true }), label: 'Go back to editing', x: 860, y: 70 },
  ]);
} catch (error) {
  console.error(`Capture failed; partial pictures are in ${staging}`);
  throw error;
} finally {
  await browser.close();
}
for (const id of Object.keys(dimensions)) await copyFile(`${staging}/${id}.png`, `${directory}/${id}.png`);
await writeFile(`${directory}/dimensions.json`, JSON.stringify(dimensions, null, 2) + '\n');
await rm(staging, { recursive: true });

// README screenshots: the bundled sample project in the whole window, taken after the pictures above are published
// so the Help & tutorial screenshot shows them.
if (hasSample) {
  await mkdir(readmeDirectory, { recursive: true });
  const readmeBrowser = await chromium.launch({ channel: 'chrome' });
  try {
    const readme = await readmeBrowser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    readme.setDefaultTimeout(15_000);
    await readme.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/status') return route.fulfill({ json: { ...status, defaultProject: { url: '/media/sample.sparko' } } });
      if (path === '/api/comfy/status') return route.fulfill({ json: { ready: true } });
      return route.fulfill({ status: 404, json: { error: 'No provider requests in tutorial capture.' } });
    });
    const shot = async (id: string) => { await readme.screenshot({ path: `${readmeDirectory}/${id}.png`, animations: 'disabled' }); console.log(`Captured ${readmeDirectory}/${id}.png`); };
    await readme.goto(url);
    await readme.getByRole('button', { name: /^Sample project/ }).click();
    await expect(readme.locator('.story-clip').first()).toBeVisible({ timeout: 120_000 });
    await expect(readme.locator('.story-clip .video-filmstrip img').last()).toBeVisible({ timeout: 60_000 });
    await expect(readme.locator('.story-clip').filter({ hasText: 'Loading clip' })).toHaveCount(0, { timeout: 180_000 });
    const generated = readme.locator('.story-clip.type-simple .story-clip-title').first();
    await generated.click();
    await readme.waitForTimeout(3000);
    await shot('editor');
    await readme.getByRole('button', { name: 'Edit generation timeline', exact: true }).click();
    const generationTimeline = readme.getByRole('region', { name: 'Generation timeline', exact: true });
    await generationTimeline.getByRole('button', { name: 'Generated', exact: true }).click();
    await readme.waitForTimeout(3000);
    await shot('generation-timeline');
    await readme.getByRole('button', { name: 'Close generation timeline', exact: true }).click();
    await readme.locator('.window-menu summary').click();
    await readme.getByRole('menuitem', { name: 'Help & tutorial', exact: true }).click();
    const help = readme.getByRole('dialog', { name: 'Help & tutorial', exact: true });
    for (let step = 1; step < 6; step++) await help.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => help.locator('.help-picture img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await shot('tutorial');
    await help.getByRole('button', { name: 'Back to editor', exact: true }).click();
    await readme.getByRole('button', { name: 'Preview', exact: true }).click();
    await readme.mouse.move(720, 500);
    await readme.waitForTimeout(3000);
    await shot('preview');
  } finally {
    await readmeBrowser.close();
  }
}
