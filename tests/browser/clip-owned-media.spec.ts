import { readFile } from 'node:fs/promises';
import { test, expect, openVideo, readProject, saveAndReopen } from './fixtures';
import { writeClipMetadata } from '../../src/media/clipMetadata';
import { clipMetadata } from '../fixtures/clip-metadata';

for(const width of [1440,390])test(`timeline image generation owns its recipe and keeps layout stable at ${width}px`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let complete=false,fail=false,submissions=0;
  await page.route('**/api/status',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({json:{...body,providers:{...body.providers,fal:true}}});});
  await page.route('**/api/library-generations',route=>{submissions++;return route.fulfill({json:{requestId:'request_123'}});});
  await page.route('**/api/library-generations/nano-banana-2/request_123',route=>route.request().method()==='DELETE'?route.fulfill({json:{cancelled:true}}):fail?route.fulfill({status:500,json:{error:'Test generation failed'}}):route.fulfill({json:{phase:complete?'ready':'rendering',count:1}}));
  await page.setViewportSize({width,height:1000});await openVideo(page);
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d')!;x.fillStyle='#289ab1';x.fillRect(0,0,320,180);return c.toDataURL().split(',')[1];}),'base64');
  await page.route('**/api/library-generations/nano-banana-2/request_123/content/0',route=>route.fulfill({contentType:'image/png',body:png}));
  await page.getByRole('button',{name:'Library menu',exact:true}).click();await expect(page.getByRole('menuitem',{name:'Create generation',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
  await page.locator('.story-scroll').click({button:'right',position:{x:12,y:12}});
  await page.getByRole('menuitem',{name:'Add image',exact:true}).click();
  await expect(page.locator('.story-clip')).toHaveCount(2);await expect(page.getByLabel('Generation prompt',{exact:true})).toBeVisible();
  await page.getByLabel('Generation prompt',{exact:true}).fill('The saved render prompt');
  const geometry=()=>page.locator('.clip-inspector').evaluate(el=>{const top=el.getBoundingClientRect().top;return ['.asset-render-info','.clip-generation-editor textarea','.asset-generate-actions','.asset-generation-feedback'].map(q=>{const r=el.querySelector(q)!.getBoundingClientRect();return [Math.round(r.top-top),Math.round(r.height)];});});
  const before=await geometry();await page.getByRole('button',{name:'Generate image',exact:true}).click();await expect.poll(()=>submissions).toBe(1);
  expect(await geometry()).toEqual(before);await expect(page.locator('[data-library-type=generation]')).toHaveCount(0);
  await page.getByLabel('Generation prompt',{exact:true}).fill('Next attempt prompt');complete=true;
  await expect.poll(async()=> (await readProject(page)).clipGenerations[0].phase).toBe('ready');
  expect(await geometry()).toEqual(before);await expect(page.getByRole('region',{name:'Generation info'})).toContainText('The saved render prompt');
  const current=await readProject(page),generated=current.storyFlow.nodes.find((n:any)=>n.generationId),assetId=generated.source.assetId;
  expect(current.library.find((a:any)=>a.assetId===assetId).generation.settings.prompt).toBe('The saved render prompt');
  await page.getByRole('button',{name:'Duplicate clip',exact:true}).click();
  const duplicated=await readProject(page),copies=duplicated.storyFlow.nodes.filter((n:any)=>n.generationId);
  expect(copies).toHaveLength(2);expect(new Set(copies.map((n:any)=>n.generationId)).size).toBe(2);expect(copies.map((n:any)=>n.source.assetId)).toEqual([assetId,assetId]);
  await page.getByLabel('Generation prompt',{exact:true}).fill('Duplicate render prompt');await page.getByRole('button',{name:'Generate image',exact:true}).click();
  await expect.poll(async()=> (await readProject(page)).clipGenerations[1].phase).toBe('ready');
  const regenerated=await readProject(page);expect(regenerated.storyFlow.nodes.find((n:any)=>n.id===generated.id).source.assetId).toBe(assetId);
  expect(regenerated.storyFlow.nodes.at(-1).source.assetId).not.toBe(assetId);
  // A failed retry retains the current media and the same control positions.
  const ready=await geometry();fail=true;await page.getByRole('button',{name:'Generate image',exact:true}).click();
  await expect.poll(async()=> (await readProject(page)).clipGenerations[1].phase).toBe('error');expect(await geometry()).toEqual(ready);
  const copyAsset=regenerated.storyFlow.nodes.at(-1).source.assetId;
  await page.getByRole('button',{name:'Delete selected clips',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(2);
  expect((await readProject(page)).library.some((a:any)=>a.assetId===copyAsset)).toBe(true);
  await page.locator(`[data-asset-id="${assetId}"]`).click();await expect(page.getByRole('region',{name:'Generation info'})).toContainText('The saved render prompt');
  await expect(page.getByLabel('Generation prompt',{exact:true})).toHaveCount(0);await expect(page.locator('.asset-inspector').getByRole('slider',{name:/volume/i})).toHaveCount(0);
  await expect(page.locator(`[data-asset-id="${assetId}"]`).getByRole('img',{name:'Image',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if(width===1440){await saveAndReopen(page);const saved=await readProject(page);expect(saved.clipGenerations).toHaveLength(1);await page.locator(`[data-asset-id="${saved.storyFlow.nodes.find((n:any)=>n.generationId).source.assetId}"]`).click();await expect(page.getByRole('region',{name:'Generation info'})).toContainText('The saved render prompt');}
  await page.screenshot({path:`test-results/clip-media-${width}.png`,fullPage:true});expect(errors).toEqual([]);
});

test('volume belongs to each clip while Library downloads preserve original bytes',async({page})=>{
  await openVideo(page);await page.locator('.story-clip-title').click();await page.getByRole('button',{name:'Duplicate clip',exact:true}).click();
  const slider=page.getByRole('slider',{name:'Clip volume',exact:true});await slider.fill('25');await slider.blur();
  const project=await readProject(page);expect(project.storyFlow.nodes.map((n:any)=>n.volume??1)).toEqual([1,.25]);expect(project.library[0]).not.toHaveProperty('volume');
  await page.getByRole('button',{name:'Mute clip',exact:true}).click();await expect(slider).toHaveValue('0');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(slider).toHaveValue('25');
  await page.getByRole('button',{name:'Reveal in Library',exact:true}).click();await expect(slider).toHaveCount(0);
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:/Download/,exact:false}).click();const download=await downloading;
  expect(await readFile((await download.path())!)).toEqual(await readFile('tests/fixtures/interstitial-reference.mp4'));
  await saveAndReopen(page);expect((await readProject(page)).storyFlow.nodes.map((n:any)=>n.volume??1)).toEqual([1,.25]);
});

test('imported video provenance is visible in Library and every timeline placement',async({page})=>{
  await openVideo(page);const blob=await writeClipMetadata(new Blob([await readFile('tests/fixtures/interstitial-reference.mp4')],{type:'video/mp4'}),clipMetadata,new AbortController().signal);
  await page.getByLabel('Import library assets',{exact:true}).setInputFiles({name:'Generated.mp4',mimeType:'video/mp4',buffer:Buffer.from(await blob.arrayBuffer())});
  await expect(page.getByRole('region',{name:'Generation info'})).toContainText(clipMetadata.prompt);
  await page.getByRole('button',{name:'Add to timeline',exact:true}).click();await expect(page.getByRole('region',{name:'Generation info'})).toContainText(clipMetadata.prompt);
  await page.getByRole('button',{name:'Delete selected clips',exact:true}).click();await page.getByRole('button',{name:'Library asset Generated.mp4',exact:true}).click();await expect(page.getByRole('region',{name:'Generation info'})).toContainText(clipMetadata.prompt);
});

test('audio clips play and save with independent clip volume',async({page})=>{
  await openVideo(page);await page.getByLabel('Import library assets',{exact:true}).setInputFiles('tests/fixtures/voice-answer.wav');
  await page.getByRole('button',{name:'Add to timeline',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(2);
  await page.getByRole('slider',{name:'Clip volume',exact:true}).fill('40');await page.getByRole('slider',{name:'Clip volume',exact:true}).blur();
  const project=await readProject(page);expect(project.storyFlow.nodes[1]).toMatchObject({volume:.4,source:{kind:'audio'}});
  await saveAndReopen(page);expect((await readProject(page)).storyFlow.nodes[1]).toMatchObject({volume:.4,source:{kind:'audio'}});
});

test('legacy projects migrate Library drafts and per-asset volume without losing placements',async({page})=>{
  await openVideo(page);
  const bytes=await page.evaluate(async()=>{
    const {readActiveProject,readAsset}=await import('/src/features/project/database.ts' as string);
    const {packProject}=await import('/src/features/project/archive.ts' as string);
    const {assetIds}=await import('/src/features/project/types.ts' as string);
    const {newAssetGeneration}=await import('/shared/asset-generation.ts' as string);
    const project=await readActiveProject(),first=project.storyFlow.nodes[0];
    delete project.mediaModelVersion;delete project.clipGenerations;delete first.volume;
    project.storyFlow.nodes.push({...first,id:crypto.randomUUID(),name:'Second placement',y:first.y+145});
    project.library[0].volume=.3;project.assetGenerations=[newAssetGeneration('image')];
    const blob=await packProject(project,await Promise.all(assetIds(project).map(readAsset)),new AbortController().signal,()=>{});
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.getByLabel('Choose project file',{exact:true}).setInputFiles({name:'legacy.sparko',mimeType:'application/zip',buffer:Buffer.from(bytes)});
  await expect(page.locator('.story-clip')).toHaveCount(3);
  const migrated=await readProject(page);expect(migrated.mediaModelVersion).toBe(1);expect(migrated.assetGenerations).toBeUndefined();
  expect(migrated.storyFlow.nodes.slice(0,2).map((n:any)=>n.volume)).toEqual([.3,.3]);expect(migrated.library[0]).not.toHaveProperty('volume');
  await page.getByRole('button',{name:'Select Untitled image',exact:true}).click();await expect(page.getByLabel('Generation prompt',{exact:true})).toBeVisible();
  await saveAndReopen(page);expect((await readProject(page)).storyFlow.nodes).toHaveLength(3);
});

test('an empty project starts playback from its first generated image and retains it across undo',async({page})=>{
  await page.route('**/api/status',async route=>{const response=await route.fetch(),body=await response.json();await route.fulfill({json:{...body,providers:{...body.providers,fal:true}}});});
  await page.goto('/');await page.getByRole('button',{name:/^New project/}).click();
  const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;c.getContext('2d')!.fillRect(0,0,320,180);return c.toDataURL().split(',')[1];}),'base64');
  await page.route('**/api/library-generations',route=>route.fulfill({json:{requestId:'request_123'}}));
  await page.route('**/api/library-generations/nano-banana-2/request_123',route=>route.fulfill({json:{phase:'ready',count:1}}));
  await page.route('**/api/library-generations/nano-banana-2/request_123/content/0',route=>route.fulfill({contentType:'image/png',body:png}));
  await page.getByRole('button',{name:'Add image',exact:true}).press('Enter');await page.getByLabel('Generation prompt',{exact:true}).fill('First image');
  await page.getByRole('button',{name:'Generate image',exact:true}).click();await expect.poll(async()=>(await readProject(page)).clipGenerations[0].phase).toBe('ready');
  await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  const undone=await readProject(page);expect(undone.storyFlow.nodes[0].source.assetId).toBe(undone.library[0].assetId);
  await saveAndReopen(page);expect((await readProject(page)).library[0].generation.settings.prompt).toBe('First image');
});
