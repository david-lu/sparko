import { expect, test, type Page } from '@playwright/test';
import type { Pin } from '../../src/features/timeline/pins';

const savedPins = (page: Page): Promise<Pin[]> => page.evaluate(() => JSON.parse(localStorage.getItem('sparko:pins:v1:default:episode_mock.mp4') || '[]'));
const videoTime = (page: Page) => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime);
const paused = (page: Page) => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused);
async function addPin(page: Page, time: number) {
  await page.getByRole('slider', { name: 'Video timeline' }).fill(String(time));
  await page.getByRole('button', { name: /Pin current time/ }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.duration)).toBeGreaterThan(0);
});

test('pins drag without seeking, reorder, persist, and delete directly on the timeline', async ({ page }) => {
  await addPin(page, 20);
  await page.getByRole('textbox', { name: 'Pin 1 label' }).fill('Opening');
  await addPin(page, 60);
  const duration = await page.locator('video').evaluate((video: HTMLVideoElement) => video.duration);
  const track = (await page.locator('.timeline-track').boundingBox())!;
  const marker = page.getByRole('button', { name: /^Go to Opening at/ });
  const pin = (await marker.boundingBox())!;
  await page.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2); await page.mouse.down();
  await page.mouse.move(track.x + track.width * 80 / duration, pin.y + pin.height / 2, { steps: 12 });
  await expect(page.locator('.pin-drag-time')).toBeVisible();
  expect((await savedPins(page))[0].time).toBe(20);
  await page.mouse.up();
  const pins = await savedPins(page);
  expect(pins.map(pin => pin.label)).toEqual(['Pin 2', 'Opening']);
  expect(pins[1].time).toBeCloseTo(80, 1);
  expect(await videoTime(page)).toBeCloseTo(60, 1);
  await page.reload();
  await expect(marker).toHaveText('2');
  await marker.hover();
  await page.getByRole('button', { name: 'Delete Opening', exact: true }).click();
  await expect(page.locator('.timeline-pin')).toHaveCount(1);
  expect((await savedPins(page)).map(pin => pin.label)).toEqual(['Pin 2']);
  await page.locator('.timeline-pin').focus(); await page.keyboard.press('Delete');
  await expect(page.getByText('No pins yet')).toBeVisible();
  await page.reload(); await expect(page.locator('.timeline-pin')).toHaveCount(0);
});

test('zoom anchors the pointer, scrolls within one page, and pins use the zoomed time scale', async ({ page }) => {
  await addPin(page, 30);
  const scroll = page.getByLabel('Scrollable timeline');
  const metrics = () => scroll.evaluate(element => ({ width: element.clientWidth, total: element.scrollWidth, left: element.scrollLeft }));
  const duration = await page.locator('video').evaluate((video: HTMLVideoElement) => video.duration);
  expect((await metrics()).total).toBe((await metrics()).width);
  await expect(page.getByRole('button', { name: 'Zoom out timeline' })).toBeDisabled();
  const box = (await scroll.boundingBox())!;
  const anchorX = box.width * 0.4;
  await page.mouse.move(box.x + anchorX, box.y + 5);
  const before = await metrics();
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -350); await page.keyboard.up('Control');
  await expect.poll(async () => (await metrics()).total).toBeGreaterThan(before.total);
  const zoomed = await metrics();
  expect((zoomed.left + anchorX) / zoomed.total).toBeCloseTo(anchorX / before.total, 2);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await metrics()).left).toBeGreaterThan(zoomed.left + 100);
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth * 0.2; });
  const marker = page.locator('.timeline-pin');
  const pin = (await marker.boundingBox())!;
  const track = (await page.locator('.timeline-track').boundingBox())!;
  await page.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2); await page.mouse.down();
  await page.mouse.move(track.x + track.width * 40 / duration, pin.y + pin.height / 2, { steps: 8 }); await page.mouse.up();
  expect((await savedPins(page))[0].time).toBeCloseTo(40, 1);
  expect(await videoTime(page)).toBeCloseTo(30, 1);
  await page.screenshot({ path: 'test-results/timeline-zoomed.png' });
  await page.getByRole('button', { name: 'Fit timeline' }).click();
  await expect(scroll).toHaveAttribute('data-zoom', '1');
  expect(await metrics()).toEqual({ width: before.width, total: before.width, left: 0 });
  await page.mouse.move(box.x + anchorX, box.y + 5);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, 1000); await page.keyboard.up('Control');
  await expect(scroll).toHaveAttribute('data-zoom', '1');
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
  const initialHeight = await page.locator('.timeline-section').evaluate(element => element.getBoundingClientRect().height);
  const initialTrackHeight = await page.locator('.timeline-track').evaluate(element => element.getBoundingClientRect().height);
  await page.getByRole('slider', { name: 'Timeline zoom', exact: true }).fill('4');
  await expect(scroll).toHaveAttribute('data-zoom', '4');
  expect(await page.locator('.timeline-section').evaluate(element => element.getBoundingClientRect().height)).toBe(initialHeight);
  expect(await page.locator('.timeline-track').evaluate(element => element.getBoundingClientRect().height)).toBe(initialTrackHeight);
  expect(await scroll.evaluate(element => element.scrollHeight)).toBe(await scroll.evaluate(element => element.clientHeight));
  await page.getByRole('slider', { name: 'Timeline zoom', exact: true }).fill('1');
  expect((await metrics()).total).toBe((await metrics()).width);
});

test('pin drag cancellation, bounds, keyboard adjustments and edge scrolling', async ({ page }) => {
  await addPin(page, 20);
  const marker = page.locator('.timeline-pin');
  let box = (await marker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2); await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await savedPins(page))[0].time).toBe(20);
  expect(await videoTime(page)).toBeCloseTo(20, 1);
  await marker.focus(); await page.keyboard.press('ArrowRight');
  expect((await savedPins(page))[0].time).toBeCloseTo(20.04, 2);
  await page.keyboard.press('Shift+ArrowLeft');
  expect((await savedPins(page))[0].time).toBeCloseTo(19.04, 2);
  await page.keyboard.press('Home'); expect((await savedPins(page))[0].time).toBe(0);
  await page.keyboard.press('End');
  const duration = await page.locator('video').evaluate((video: HTMLVideoElement) => video.duration);
  expect((await savedPins(page))[0].time).toBeCloseTo(duration, 3);
  expect(await videoTime(page)).toBeCloseTo(20, 1);
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Zoom in timeline' }).click();
  await page.getByRole('button', { name: 'Zoom in timeline' }).click();
  const scroll = page.getByLabel('Scrollable timeline');
  await scroll.evaluate(element => { element.scrollLeft = 0; });
  const viewport = (await scroll.boundingBox())!;
  box = (await marker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(viewport.x + viewport.width - 2, box.y + box.height / 2, { steps: 10 });
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
  await page.mouse.up();
  expect((await savedPins(page))[0].time).toBeGreaterThan(duration / 2.25);
});

test('Space toggles playback from controls and the timeline, but preserves text editing', async ({ page }) => {
  await addPin(page, 20);
  for (const control of [page.getByRole('button', { name: 'Add pin P' }), page.locator('.timeline-pin'), page.getByRole('tab', { name: 'Describe' }), page.getByRole('slider', { name: 'Video timeline' }), page.getByRole('button', { name: 'Zoom in timeline' })]) {
    await control.focus();
    await page.keyboard.press('Space'); await expect.poll(() => paused(page)).toBe(false);
    await page.keyboard.press('Space'); await expect.poll(() => paused(page)).toBe(true);
  }
  await expect(page.locator('.timeline-pin')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: /Pins/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Scrollable timeline')).toHaveAttribute('data-zoom', '1');
  const label = page.getByRole('textbox', { name: 'Pin 1 label' });
  await label.fill('Scene'); await label.press('End'); await label.press('Space');
  await expect(label).toHaveValue('Scene '); expect(await paused(page)).toBe(true);
  await page.getByRole('tab', { name: 'Describe' }).click();
  const focus = page.getByPlaceholder('e.g. Describe the action and camera movement');
  await focus.fill('Action'); await focus.press('Space');
  await expect(focus).toHaveValue('Action '); expect(await paused(page)).toBe(true);
  await page.getByRole('spinbutton', { name: 'Analysis start' }).focus(); await page.keyboard.press('Space');
  expect(await paused(page)).toBe(true);
});

test.describe('touch timeline', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('moves and deletes pins with touch while retaining a single-page layout', async ({ page }) => {
    await addPin(page, 25);
    const pin = (await page.locator('.timeline-pin').boundingBox())!;
    const track = (await page.locator('.timeline-track').boundingBox())!;
    const duration = await page.locator('video').evaluate((video: HTMLVideoElement) => video.duration);
    const cdp = await page.context().newCDPSession(page);
    const y = pin.y + pin.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pin.x + pin.width / 2, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: track.x + track.width * 60 / duration, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await savedPins(page))[0].time).toBeCloseTo(60, 0);
    expect(await videoTime(page)).toBeCloseTo(25, 1);
    await page.getByRole('button', { name: 'Delete Pin 1', exact: true }).tap();
    await page.screenshot({ path: 'test-results/timeline-touch.png' });
    await expect(page.locator('.timeline-pin')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
  });
});
