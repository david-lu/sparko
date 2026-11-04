import { readFile } from 'node:fs/promises';
import { addDraft, dragIntoView, expect, fitAll, openVideo, readProject, saveAndReopen, test, type Page } from './fixtures';

const settings=(page:Page)=>page.getByRole('region',{name:'Project settings',exact:true});
const slot=(page:Page)=>settings(page).getByRole('group',{name:'Start video',exact:true});
async function beginClipDrag(page:Page,id:string){
  const title=page.locator(`[data-node-id="${id}"] .story-clip-title`);
  await title.scrollIntoViewIfNeeded();const box=(await title.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+10,box.y+box.height/2,{steps:3});
  await expect(settings(page)).toBeVisible();await slot(page).scrollIntoViewIfNeeded();
  const target=(await slot(page).boundingBox())!;
  await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:8});
  await page.mouse.move(target.x+target.width/2,target.y+target.height/2);
  await expect(slot(page)).toHaveClass(/is-dragging/);
}

test('project settings show the start video, and the context action is exclusive, undoable and saved',async({page})=>{
  await openVideo(page);await expect(settings(page)).toBeVisible();await expect(slot(page)).toContainText('interstitial-reference.mp4');
  await addDraft(page,'Opening scene');await expect(settings(page)).toHaveCount(0);await fitAll(page);
  const before=(await readProject(page)).storyFlow,candidate=before.nodes.at(-1);
  await page.locator(`[data-node-id="${candidate.id}"] .story-clip-title`).click({button:'right'});
  await page.getByRole('menuitem',{name:'Set as start video',exact:true}).click();
  expect((await readProject(page)).storyFlow).toEqual({...before,entryId:candidate.id});
  await expect(page.locator('.story-clip[data-start="true"]')).toHaveCount(1);
  await expect(page.locator('.story-clip[data-start="true"]')).toHaveAttribute('data-node-id',candidate.id);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await readProject(page)).storyFlow).toEqual(before);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await fitAll(page);await expect(slot(page)).toContainText('Opening scene');
  await page.getByRole('button',{name:'Show in timeline',exact:true}).click();await expect(page.locator('.story-clip.selected')).toHaveAttribute('data-node-id',candidate.id);
  await page.locator('.story-clip.selected .story-clip-title').click({button:'right'});await expect(page.getByRole('menuitem',{name:'Start video',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
  await saveAndReopen(page);await fitAll(page);await expect(slot(page)).toContainText('Opening scene');
  expect((await readProject(page)).storyFlow.entryId).toBe(candidate.id);
});

for(const width of [1440,390])test(`timeline clips drop into project settings without moving the timeline at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await openVideo(page);await addDraft(page,'New opening');await fitAll(page);
  const before=(await readProject(page)).storyFlow,candidate=before.nodes.at(-1);
  await beginClipDrag(page,candidate.id);await page.mouse.up();
  await expect(settings(page)).toBeVisible();await expect(slot(page)).toContainText('New opening');
  expect((await readProject(page)).storyFlow).toEqual({...before,entryId:candidate.id});
  await page.getByRole('button',{name:'Undo',exact:true}).click();await fitAll(page);
  await beginClipDrag(page,candidate.id);await page.keyboard.press('Escape');await page.mouse.up();
  expect((await readProject(page)).storyFlow).toEqual(before);
  await fitAll(page);await expect(slot(page)).toContainText('interstitial-reference.mp4');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`test-results/project-inspector-${width}.png`,fullPage:true});
  await settings(page).screenshot({path:`test-results/project-settings-${width}.png`});
});

test('a Library video becomes the start with one undo, and an existing clip is reused',async({page})=>{
  await openVideo(page);const buffer=await readFile('tests/fixtures/interstitial-reference.mp4');
  await page.getByLabel('Import library assets',{exact:true}).setInputFiles({name:'Opening.mp4',mimeType:'video/mp4',buffer});
  const libraryVideo=page.getByRole('button',{name:'Library asset Opening.mp4',exact:true});await expect(libraryVideo).toBeVisible();await fitAll(page);
  const before=(await readProject(page)).storyFlow;
  await dragIntoView(page,libraryVideo,slot(page));await expect(slot(page)).toContainText('Opening.mp4');
  const after=(await readProject(page)).storyFlow;expect(after.nodes).toHaveLength(before.nodes.length+1);expect(after.entryId).toBe(after.nodes.at(-1).id);
  await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await readProject(page)).storyFlow).toEqual(before);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await fitAll(page);
  const original=page.getByRole('button',{name:'Library asset interstitial-reference.mp4',exact:true});
  await dragIntoView(page,original,slot(page));await expect(slot(page)).toContainText('interstitial-reference.mp4');
  expect((await readProject(page)).storyFlow).toEqual({...after,entryId:before.entryId});
});

test('ambiguous Library videos and invalid drops keep the current start and feedback layout stable',async({page})=>{
  await openVideo(page);await page.locator('.story-clip-title').click();await page.getByRole('button',{name:'Duplicate selected clips',exact:true}).click();await fitAll(page);
  const before=(await readProject(page)).storyFlow,reveal=page.getByRole('button',{name:'Show in timeline',exact:true}),box=await reveal.boundingBox();
  await dragIntoView(page,page.getByRole('button',{name:'Library asset interstitial-reference.mp4',exact:true}),slot(page));
  await expect(settings(page).getByRole('status')).toContainText('Several timeline clips');expect((await readProject(page)).storyFlow).toEqual(before);
  expect(await reveal.boundingBox()).toEqual(box);
  const invalid=await page.evaluateHandle(()=>{const data=new DataTransfer();data.setData('application/x-sparko-clip',JSON.stringify({assetId:'missing'}));return data;});
  await slot(page).dispatchEvent('drop',{dataTransfer:invalid});await expect(settings(page).getByRole('status')).toContainText('Choose a video');
  expect((await readProject(page)).storyFlow).toEqual(before);expect(await reveal.boundingBox()).toEqual(box);
});
