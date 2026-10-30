import {test,expect,type Page} from './fixtures';
import {readFile} from 'node:fs/promises';

const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});
const bounds=(page:Page)=>page.locator('.workspace-grid').evaluate(root=>['.video-stage','.story-canvas','.sidebar'].map(selector=>{const r=root.querySelector(selector)!.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));

for(const width of [1440,390])test(`drops multiple videos into an empty timeline at the pointer without moving the layout at ${width}px`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:width===390?844:1000});
  await page.goto('/');await page.getByRole('button',{name:/^New project/}).click();await expect(page.locator('.story-scroll')).toBeVisible();
  const idle=await bounds(page);expect((await saved(page)).source.assetId).toBeUndefined();
  await page.evaluate(async()=>{
    const {MediaEngine}=await import('/src/media/MediaEngine.ts' as string),inspect=MediaEngine.prototype.inspect;
    const gate=new Promise<void>(resolve=>{(window as any).finishImport=resolve;});MediaEngine.prototype.inspect=async function(){await gate;return inspect.call(this);};
  });
  const canvas=page.locator('.story-scroll'),rect=(await canvas.boundingBox())!,point={x:rect.x+30,y:rect.y+20};
  const bytes=Array.from(await readFile('tests/fixtures/interstitial-reference.mp4'));
  const transfer=await page.evaluateHandle(({bytes})=>{const transfer=new DataTransfer();for(const name of ['First.mp4','Second.mp4'])transfer.items.add(new File([Uint8Array.from(bytes)],name,{type:'video/mp4'}));return transfer;},{bytes});
  await canvas.dispatchEvent('dragover',{dataTransfer:transfer,clientX:point.x,clientY:point.y});await expect(page.getByText('Import clips here',{exact:true})).toBeVisible();
  await canvas.dispatchEvent('drop',{dataTransfer:transfer,clientX:point.x,clientY:point.y});await expect(page.locator('.project-status')).toBeVisible();expect(await bounds(page)).toEqual(idle);
  await page.screenshot({path:`test-results/import-loading-${width}.png`,fullPage:true});
  await page.evaluate(()=>(window as any).finishImport());await expect(page.locator('.story-clip')).toHaveCount(2);await expect(page.locator('.project-status')).toHaveCount(0);
  expect(await bounds(page)).toEqual(idle);await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  const project=await saved(page);expect(project.storyFlow.edges).toEqual([]);expect(project.storyFlow.entryId).toBe(project.storyFlow.nodes[0].id);
  expect(project.storyFlow.nodes.map((n:any)=>n.name)).toEqual(['First.mp4','Second.mp4']);expect(new Set(project.storyFlow.nodes.map((n:any)=>n.source.assetId)).size).toBe(2);
  expect(project.library).toHaveLength(2);expect(project.name).toBe('Untitled project');await expect(page.locator('.menu-document')).toHaveText('Untitled project');
  const clip=page.locator('.story-clip').first();await expect.poll(async()=>{const r=(await clip.boundingBox())!;return Math.abs(r.x-point.x)+Math.abs(r.y-point.y);}).toBeLessThan(2);
  expect((await clip.boundingBox())!.height).toBe(76);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:`test-results/import-complete-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(0);await expect(page.getByRole('button',{name:'Play',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(2);await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Play video',exact:true}).click();await page.locator('.video-stage').hover();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await page.getByRole('button',{name:'Pause',exact:true}).click();
  expect(errors).toEqual([]);
});

test('empty projects can be saved, reopened, and populated through the import button',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:/^New project/}).click();await expect(page.locator('.story-scroll')).toBeVisible();
  const download=page.waitForEvent('download');await page.getByText('File',{exact:true}).click();await page.getByRole('menuitem',{name:'Export project',exact:true}).click();
  const path=testInfo.outputPath('empty.sparko');await (await download).saveAs(path);
  await page.getByText('File',{exact:true}).click();await page.getByRole('menuitem',{name:'Close project',exact:true}).click();await expect(page.getByRole('button',{name:/^New project/})).toBeVisible();
  await page.getByLabel('Choose project file',{exact:true}).setInputFiles(path);await expect(page.locator('.story-scroll')).toBeVisible();await expect(page.locator('.story-clip')).toHaveCount(0);
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Import videos',exact:true}).click();await (await chooser).setFiles('tests/fixtures/interstitial-reference.mp4');
  await expect(page.locator('.story-clip')).toHaveCount(1);await expect(page.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await page.locator('.story-clip-title').click();await page.getByRole('button',{name:'Delete selected clips',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(0);
  await expect(page.getByText('Drop video files here',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(1);expect(errors).toEqual([]);
});
