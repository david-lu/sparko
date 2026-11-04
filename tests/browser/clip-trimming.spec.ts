import { readFile } from 'node:fs/promises';
import { test, expect, openVideo, readProject, saveAndReopen, type Page } from './fixtures';
import { writeClipMetadata } from '../../src/media/clipMetadata';
import { clipMetadata } from '../fixtures/clip-metadata';

async function preferences(page:Page) {
  await page.locator('.playback-options>summary').click();
  await page.getByRole('menuitem',{name:'Preferences…',exact:true}).click();
  return page.getByRole('dialog',{name:'Preferences',exact:true});
}
async function dragHandle(page:Page,side:'start'|'end',seconds:number,cancel=false) {
  const clip=page.locator('.story-clip.selected'),handle=clip.getByRole('slider',{name:new RegExp(`^Trim ${side} of `)});
  await handle.scrollIntoViewIfNeeded();
  const bounds=(await handle.boundingBox())!,pixels=(await clip.boundingBox())!.width/Number(await clip.getAttribute('data-media-duration'));
  // Grab below the connection socket that sits halfway up the full-height edge.
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height*.75);await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width/2+seconds*pixels,bounds.y+bounds.height*.75,{steps:5});
  if(cancel)await page.keyboard.press('Escape');
  await page.mouse.up();
}

for(const width of [1440,390]) test(`clip handles trim nondestructively, undo, cancel, and preserve time preferences at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await openVideo(page);await page.locator('.story-clip-title').click();
  const node=async()=>(await readProject(page)).storyFlow.nodes[0];
  const original=await node(),workspace=await page.locator('.story-scroll').boundingBox(),toolbar=await page.locator('.story-toolbar').boundingBox();
  const scrub=page.locator('.story-filmstrip'),time=page.locator('.story-playhead>span');
  await dragHandle(page,'end',-1);
  await expect.poll(async()=>(await node()).source.outFrame).toBe(72);
  expect((await node()).x).toBe(original.x);
  await scrub.focus();await scrub.press('Home');await scrub.press('Shift+ArrowRight');await expect(time).toHaveText('00:01.000');
  await dragHandle(page,'start',.5);
  await expect.poll(async()=>(await node()).source.inFrame).toBe(12);
  expect((await node()).x).toBe(original.x+16);
  expect((await node()).source).toMatchObject({assetId:original.source.assetId,inFrame:12,outFrame:72});
  await expect(time).toHaveText('00:01.000');
  expect(await page.locator('.story-scroll').boundingBox()).toEqual(workspace);expect(await page.locator('.story-toolbar').boundingBox()).toEqual(toolbar);
  await scrub.focus();await scrub.press('Home');await expect(time).toHaveText('00:00.500');
  await scrub.press('Shift+ArrowRight');await expect(time).toHaveText('00:01.500');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await node()).source.inFrame).toBe(0);
  expect((await node()).source.outFrame).toBe(72);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(async()=>(await node()).source.inFrame).toBe(12);
  const beforeCancel=await node();await dragHandle(page,'end',-.5,true);expect(await node()).toEqual(beforeCancel);
  await page.getByRole('slider',{name:/^Trim end of /}).press('End');await expect.poll(async()=>(await node()).source.outFrame).toBe(96);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await node()).source.outFrame).toBe(72);
  await scrub.focus();await scrub.press('Home');await scrub.press('Shift+ArrowRight');
  let dialog=await preferences(page);await expect(dialog.getByLabel('Playhead time',{exact:true})).toHaveValue('internal');
  await dialog.getByLabel('Playhead time',{exact:true}).selectOption('elapsed');await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await expect(time).toHaveText('00:01.000');
  await saveAndReopen(page);await page.locator('.story-clip-title').click();await scrub.press('Home');
  await expect(time).toHaveText('00:00.000');expect((await node()).source).toMatchObject({inFrame:12,outFrame:72});
  dialog=await preferences(page);await expect(dialog.getByLabel('Playhead time',{exact:true})).toHaveValue('elapsed');
  await dialog.getByRole('button',{name:'Reset default',exact:true}).click();await expect(dialog.getByLabel('Playhead time',{exact:true})).toHaveValue('internal');
  await dialog.getByRole('button',{name:'Done',exact:true}).click();await expect(time).toHaveText('00:00.500');
  await page.screenshot({path:`test-results/clip-trim-${width}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(errors).toEqual([]);
});

test('generated clips trim the playable body and display the full render’s internal time',async({page})=>{
  const original=new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')],{type:'video/mp4'});
  const blob=await writeClipMetadata(original,clipMetadata,new AbortController().signal);
  await page.goto('/');await page.getByLabel('Choose video file',{exact:true}).setInputFiles({name:'generated.mp4',mimeType:'video/mp4',buffer:Buffer.from(await blob.arrayBuffer())});
  await expect(page.locator('.story-clip.type-simple')).toHaveCount(1);await page.locator('.story-clip-title').click();
  const scrub=page.locator('.story-filmstrip'),time=page.locator('.story-playhead>span');
  await scrub.press('Home');await expect(time).toHaveText('00:01.000');
  const initial=await readProject(page),node=async()=>(await readProject(page)).storyFlow.nodes[0];
  await dragHandle(page,'start',.5);await expect.poll(async()=>(await node()).trim?.inFrame).toBe(12);
  await scrub.press('Home');await expect(time).toHaveText('00:01.500');
  await dragHandle(page,'end',-.5);await expect.poll(async()=>(await node()).trim?.outFrame).toBe(36);
  expect((await readProject(page)).interstitials[0].result).toEqual(initial.interstitials[0].result);
  await expect(page.locator('.story-clip')).toHaveAttribute('data-duration','1');
  await page.getByRole('slider',{name:/^Trim start of /}).press('End');await expect.poll(async()=>(await node()).trim?.inFrame).toBe(35);
  await expect(page.locator('.story-clip')).toHaveAttribute('data-duration',String(1/24));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await node()).trim?.inFrame).toBe(12);
  await saveAndReopen(page);expect((await node()).trim).toEqual({inFrame:12,outFrame:36});
  await page.locator('.story-clip-title').click();await scrub.press('Home');await expect(time).toHaveText('00:01.500');
});
