import { readFile } from 'node:fs/promises';
import { expect, openVideo, readProject, test, type Page } from './fixtures';
import { writeClipMetadata } from '../../src/media/clipMetadata';
import { clipMetadata } from '../fixtures/clip-metadata';

async function dragTime(page:Page,seconds:number,cancel=false) {
  const label=page.getByRole('slider',{name:/^Playhead of /}),clip=page.locator('.story-clip.playing');
  const box=(await label.boundingBox())!,scale=(await clip.boundingBox())!.width/Number(await clip.getAttribute('data-media-duration'));
  const before=await label.textContent(),x=box.x+box.width*.2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await expect(label).toHaveText(before!);
  await page.mouse.move(x+seconds*scale,y,{steps:5});
  if(cancel)await page.keyboard.press('Escape');
  await page.mouse.up();
}

for(const width of [1440,390])test(`time label scrubs without jumping, respects trims and zoom, and cancels at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await openVideo(page);await page.locator('.story-clip-title').press('Enter');
  await page.getByLabel('Source in',{exact:true}).fill('.5');await page.getByLabel('Source out',{exact:true}).fill('3.5');
  const label=page.getByRole('slider',{name:/^Playhead of /});await label.press('Home');
  await expect(label).toHaveText('00:00.500');const graph=(await readProject(page)).storyFlow;
  // Preferences can scroll the stacked workspace; compare layout in workspace coordinates.
  const layout=()=>page.locator('.story-scroll,.story-toolbar').evaluateAll(nodes=>nodes.map(el=>{
    const r=el.getBoundingClientRect(),workspace=el.closest('.workspace-grid')!,origin=workspace.getBoundingClientRect();
    return {x:r.x-origin.x+workspace.scrollLeft,y:r.y-origin.y+workspace.scrollTop,width:r.width,height:r.height};
  }));
  const before=await layout();
  await dragTime(page,1);await expect(label).toHaveText('00:01.500');
  await page.getByRole('button',{name:'Zoom out story',exact:true}).click();
  await dragTime(page,.5);await expect(label).toHaveText('00:02.000');
  await dragTime(page,.5,true);await expect(label).toHaveText('00:02.000');
  await dragTime(page,4);await expect(label).toHaveText('00:03.458');
  await dragTime(page,-4);await expect(label).toHaveText('00:00.500');
  await label.press('Shift+ArrowRight');await expect(label).toHaveText('00:01.500');
  await page.locator('.playback-options>summary').click();await page.getByRole('menuitem',{name:'Preferences…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preferences',exact:true});await dialog.getByLabel('Playhead time',{exact:true}).selectOption('elapsed');
  await dialog.getByRole('button',{name:'Done',exact:true}).click();await expect(label).toHaveText('00:01.000');
  await dragTime(page,.5);await expect(label).toHaveText('00:01.500');
  expect((await readProject(page)).storyFlow).toEqual(graph);
  expect(await layout()).toEqual(before);
  expect(errors).toEqual([]);
  await page.screenshot({path:`test-results/playhead-drag-${width}.png`});
});

test('generated playhead dragging uses the playable body and retained internal time',async({page})=>{
  const media=new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')],{type:'video/mp4'});
  const blob=await writeClipMetadata(media,clipMetadata,new AbortController().signal);
  await page.goto('/');await page.getByLabel('Choose video file',{exact:true}).setInputFiles({name:'generated.mp4',mimeType:'video/mp4',buffer:Buffer.from(await blob.arrayBuffer())});
  await expect(page.locator('.story-clip.type-simple')).toHaveCount(1);await page.locator('.story-clip-title').press('Enter');
  const label=page.getByRole('slider',{name:/^Playhead of /}),graph=(await readProject(page)).storyFlow;
  await label.press('Home');await expect(label).toHaveText('00:01.000');
  await dragTime(page,.5);await expect(label).toHaveText('00:01.500');
  await dragTime(page,3);await expect(label).toHaveText('00:02.958');
  await dragTime(page,-3);await expect(label).toHaveText('00:01.000');
  expect((await readProject(page)).storyFlow).toEqual(graph);
});
