import { test, expect, fitAll, type Page } from './fixtures';

const open=async(page:Page)=>{await page.goto('/'); await expect(page.getByRole('button', { name: /^New project/ })).toBeEnabled(); await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);};
const preferences=async(page:Page)=>{
  await page.locator('.playback-options>summary').click();await page.getByRole('menuitem',{name:'Preferences…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preferences',exact:true});await expect(dialog).toBeVisible();return dialog;
};
const zoom=async(page:Page,delta:number,meta=false)=>{
  const canvas=page.locator('.story-scroll'),clip=page.locator('.story-clip'),before=(await clip.boundingBox())!,view=(await canvas.boundingBox())!,anchor=Math.floor(view.x+view.width*.37);
  const prevented=await canvas.evaluate((el,{delta,meta,anchor})=>{const r=el.getBoundingClientRect();return !el.dispatchEvent(new WheelEvent('wheel',{deltaY:delta,ctrlKey:!meta,metaKey:meta,clientX:anchor,clientY:Math.floor(r.y+r.height*.4),bubbles:true,cancelable:true}));},{delta,meta,anchor});
  expect(prevented).toBe(true);await expect.poll(async()=>(await clip.boundingBox())!.width).not.toBe(before.width);
  const after=(await clip.boundingBox())!;expect((anchor-after.x)/after.width).toBeCloseTo((anchor-before.x)/before.width,3);expect(after.height).toBe(before.height);
  return after.width/before.width;
};

for(const width of [1440,390])test(`pinch sensitivity applies live, persists, and resets without moving controls at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000});await open(page);
  expect(await zoom(page,-40)).toBeCloseTo(Math.exp(.24),2);await fitAll(page);
  const workspace=await page.locator('.workspace-grid').boundingBox(),clip=await page.locator('.story-clip').boundingBox();
  let dialog=await preferences(page),slider=dialog.getByRole('slider',{name:'Pinch zoom sensitivity',exact:true});
  await expect(slider).toHaveValue('3');expect(await page.locator('.workspace-grid').boundingBox()).toEqual(workspace);
  const card=(await page.locator('.preferences-card').boundingBox())!;expect(card.x).toBeGreaterThanOrEqual(0);expect(card.x+card.width).toBeLessThanOrEqual(width);
  await slider.press('Home');await slider.press('ArrowRight');await slider.press('ArrowRight');await expect(slider).toHaveValue('1');
  await page.screenshot({path:`test-results/preferences-${width}.png`,fullPage:true});await dialog.getByRole('button',{name:'Done',exact:true}).click();
  expect(await page.locator('.story-clip').boundingBox()).toEqual(clip);expect(await page.locator('.workspace-grid').boundingBox()).toEqual(workspace);
  expect(await zoom(page,-40)).toBeCloseTo(Math.exp(.08),2);await fitAll(page);
  dialog=await preferences(page);slider=dialog.getByRole('slider',{name:'Pinch zoom sensitivity',exact:true});await slider.press('End');await expect(slider).toHaveValue('5');await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  expect(await zoom(page,-40,true)).toBeCloseTo(Math.exp(.4),2);
  const film=page.locator('.story-clip'),beforePan=(await film.boundingBox())!;await page.locator('.story-scroll').hover({position:{x:20,y:20}});await page.mouse.wheel(100,70);await expect.poll(async()=>(await film.boundingBox())!.x).toBeLessThan(beforePan.x);expect((await film.boundingBox())!.width).toBe(beforePan.width);
  await open(page);dialog=await preferences(page);slider=dialog.getByRole('slider',{name:'Pinch zoom sensitivity',exact:true});await expect(slider).toHaveValue('5');
  await dialog.getByRole('button',{name:'Reset default',exact:true}).click();await expect(slider).toHaveValue('3');await dialog.getByRole('button',{name:'Close preferences',exact:true}).click();
  await expect(page.locator('.playback-options>summary')).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
