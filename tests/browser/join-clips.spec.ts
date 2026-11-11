import { readFile } from 'node:fs/promises';
import { test, expect, openVideo, readProject, saveAndReopen, fitAll, type Page } from './fixtures';
import { writeClipMetadata } from '../../src/media/clipMetadata';
import { clipMetadata } from '../fixtures/clip-metadata';

async function splitSelected(page:Page) {
  const count=await page.locator('.story-clip').count(),strip=page.locator('.story-clip.selected .story-filmstrip');
  await strip.press('Home');await strip.press('Shift+ArrowRight');await strip.press('s');
  await expect(page.locator('.story-clip')).toHaveCount(count+1);
}
async function selectAll(page:Page) {
  const titles=page.locator('.story-clip-title'),count=await titles.count();
  await titles.nth(count-1).press('Enter');
  for(let i=count-2;i>=0;i--)await titles.nth(i).click({modifiers:['Shift']});
  await expect(page.locator('.story-clip.selected')).toHaveCount(count);
}

for(const width of [1440,390])test(`joins a selected chain in graph order with undo and a custom failure popup at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});const errors:string[]=[],nativeDialogs:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{nativeDialogs.push(dialog.message());void dialog.dismiss();});
  await openVideo(page);await page.locator('.story-clip-title').click();
  const original=(await readProject(page)).storyFlow,viewport=await page.locator('.story-scroll').boundingBox();
  const join=page.getByRole('button',{name:'Join selected clips',exact:true});
  await expect(join).toHaveAttribute('aria-disabled','true');await join.click({force:true});
  const dialog=page.getByRole('dialog',{name:'Can’t join clips'});
  await expect(dialog).toBeVisible();await expect(dialog).toContainText('Select at least two clips');
  expect((await readProject(page)).storyFlow).toEqual(original);
  expect(await page.locator('.story-scroll').boundingBox()).toEqual(viewport);
  await page.screenshot({path:`test-results/join-error-${width}.png`});
  await dialog.getByRole('button',{name:'OK',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Clip graph',{exact:true})).toBeFocused();
  await splitSelected(page);await page.locator('.story-clip-title').last().press('Enter');await splitSelected(page);
  await fitAll(page);const before=(await readProject(page)).storyFlow;
  await selectAll(page);await expect(join).toHaveAttribute('aria-disabled','false');await page.locator('.story-clip-title').first().click({button:'right'});
  await page.getByRole('menuitem',{name:'Join selected clips',exact:true}).click();
  await expect(page.locator('.story-clip')).toHaveCount(1);
  await expect.poll(async()=>(await readProject(page)).storyFlow.nodes[0].source).toEqual(original.nodes[0].source);
  expect((await readProject(page)).storyFlow.edges).toEqual([]);
  await expect(page.locator('.story-playhead>span')).toHaveText('00:00.000');
  // Undo, redo and persistence run once, at full width.
  if (width === 1440) {
    await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(3);
    expect((await readProject(page)).storyFlow).toEqual(before);
    await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(1);
    await saveAndReopen(page);expect((await readProject(page)).storyFlow.nodes[0].source).toMatchObject({inFrame:0,outFrame:96});
  }
  await page.locator('.story-clip-title').click();await page.screenshot({path:`test-results/joined-clips-${width}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(nativeDialogs).toEqual([]);expect(errors).toEqual([]);
});

for (const width of [1440])test(`lists all join failures, updates availability, and restores a gap at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  await openVideo(page);await page.locator('.story-clip-title').click();await splitSelected(page);await fitAll(page);
  await page.locator('.story-crossfade').click();
  await page.locator('.story-crossfade').click({button:'right'});await page.getByRole('menuitem',{name:'Disconnect',exact:true}).click();
  await selectAll(page);const disconnected=(await readProject(page)).storyFlow;
  await expect(page.getByRole('button',{name:'Join selected clips',exact:true})).toHaveAttribute('aria-disabled','true');
  await page.getByRole('button',{name:'Join selected clips',exact:true}).click({force:true});
  let dialog=page.getByRole('dialog',{name:'Can’t join clips'});await expect(dialog).toContainText('not connected in one chain');
  expect((await readProject(page)).storyFlow).toEqual(disconnected);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-crossfade')).toHaveCount(1);
  await page.locator('.story-clip-title').first().press('Enter');
  await page.getByLabel('Source out',{exact:true}).fill('4');await page.getByLabel('Source in',{exact:true}).fill('3');
  await page.getByRole('checkbox',{name:'Loop',exact:true}).check();
  await page.locator('.story-clip-title').last().press('Enter');await page.getByLabel('Source out',{exact:true}).fill('2');
  await selectAll(page);const reversed=(await readProject(page)).storyFlow;
  await page.getByRole('button',{name:'Join selected clips',exact:true}).click({force:true});
  dialog=page.getByRole('dialog',{name:'Can’t join clips'});await expect(dialog).toContainText('starts at or after');
  await expect(dialog).toContainText('Loop or Conditional');await expect(dialog.getByRole('listitem')).toHaveCount(2);
  await page.screenshot({path:`test-results/join-all-reasons-${width}.png`});
  expect((await readProject(page)).storyFlow).toEqual(reversed);await dialog.getByRole('button',{name:'OK',exact:true}).click();
  await page.locator('.story-clip-title').first().press('Enter');await page.getByRole('checkbox',{name:'Loop',exact:true}).uncheck();
  await page.getByLabel('Source in',{exact:true}).fill('0');await page.getByLabel('Source out',{exact:true}).fill('.5');
  await selectAll(page);await page.getByRole('button',{name:'Join selected clips',exact:true}).click();
  await expect(page.locator('.story-clip')).toHaveCount(1);
  expect((await readProject(page)).storyFlow.nodes[0].source).toMatchObject({inFrame:0,outFrame:48});
});

test('joins split generated clips using their saved render and internal timestamps',async({page})=>{
  const media=new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')],{type:'video/mp4'});
  const blob=await writeClipMetadata(media,clipMetadata,new AbortController().signal);
  await page.goto('/');await page.getByLabel('Choose video file',{exact:true}).setInputFiles({name:'generated.mp4',mimeType:'video/mp4',buffer:Buffer.from(await blob.arrayBuffer())});
  await expect(page.locator('.story-clip.type-simple')).toHaveCount(1);await page.locator('.story-clip-title').click();
  const original=await readProject(page);await splitSelected(page);await fitAll(page);await selectAll(page);
  await page.getByRole('button',{name:'Join selected clips',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(1);
  await expect(page.locator('.story-playhead>span')).toHaveText('00:01.000');
  const result=await readProject(page);expect(result.storyFlow.nodes[0].interstitialId).toBe(original.storyFlow.nodes[0].interstitialId);
  expect(result.storyFlow.nodes[0].trim).toBeUndefined();expect(result.interstitials[0].result).toEqual(original.interstitials[0].result);
  await saveAndReopen(page);await expect(page.locator('.story-clip.type-simple')).toHaveCount(1);
});
