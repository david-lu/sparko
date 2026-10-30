import {test,expect,type Page} from './fixtures';
import {readFile} from 'node:fs/promises';
const open=async(page:Page)=>{await page.goto('/');await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);};
const saved=(page:Page)=>page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('sparko-projects');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const all=await new Promise<any[]>((resolve)=>{const r=db.transaction('projects').objectStore('projects').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return all.find(p=>p.id.startsWith('draft:'));});

test('library media survives deleting its clip, is reusable without arrows, and survives an archive',async({page,browser})=>{
  await open(page);const buffer=await readFile('tests/fixtures/interstitial-reference.mp4');
  await page.getByLabel('Import videos as clips',{exact:true}).setInputFiles({name:'Library footage.mp4',mimeType:'video/mp4',buffer});await expect(page.locator('.story-clip')).toHaveCount(2);
  await page.getByRole('button',{name:'Collapse Library panel',exact:true}).click();
  await page.locator('.story-scroll').focus();await page.keyboard.press('Delete');await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.getByRole('button',{name:'Expand Library panel',exact:true}).click();
  const asset=page.getByRole('button',{name:'Library asset Library footage.mp4',exact:true});await expect(asset).toContainText('Unused');
  await page.getByLabel('Search library').fill('Library footage');await expect(page.locator('.library-media button')).toHaveCount(1);await asset.dblclick();await expect(page.locator('.story-clip')).toHaveCount(2);expect((await saved(page)).storyFlow.edges).toHaveLength(0);
  await page.locator('.story-scroll').focus();await page.keyboard.press('Delete');await expect(page.locator('.story-clip')).toHaveCount(1);
  await page.locator('summary').filter({hasText:/^File$/}).click();const downloadEvent=page.waitForEvent('download');await page.getByRole('menuitem',{name:'Export project',exact:true}).click();const download=await downloadEvent;
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3000'}),restored=await context.newPage();await restored.goto('/');await restored.getByLabel('Choose project file',{exact:true}).setInputFiles({name:'Library.sparko',mimeType:'application/zip',buffer:await readFile((await download.path())!)});
  await expect(restored.locator('.story-clip')).toHaveCount(1,{timeout:60000});const restoredAsset=restored.getByRole('button',{name:'Library asset Library footage.mp4',exact:true});await expect(restoredAsset).toContainText('Unused');
  const before=await saved(restored);const transfer=await restored.evaluateHandle(id=>{const data=new DataTransfer();data.setData('application/x-sparko-clip',JSON.stringify({assetId:id}));return data;},before.library.find((item:any)=>item.name==='Library footage.mp4').assetId);
  await restored.locator('.story-scroll').dispatchEvent('drop',{dataTransfer:transfer,clientX:400,clientY:700});await expect(restored.locator('.story-clip')).toHaveCount(2);expect((await saved(restored)).storyFlow.edges).toHaveLength(0);
  await context.close();
});

test('animation panels reorder, snap, resize, cancel, persist, and reset while the player remains above the timeline',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  const library=page.getByRole('button',{name:'Move Library panel',exact:true}),inspector=page.getByRole('button',{name:'Move Inspector panel',exact:true});
  const start=await library.boundingBox(),end=await page.locator('[data-panel-id=inspector]').boundingBox();await page.mouse.move(start!.x+60,start!.y+15);await page.mouse.down();await page.mouse.move(end!.x+60,end!.y+end!.height-20,{steps:8});await expect(page.locator('.sidePanelInsertionIndicator')).toHaveCount(1);await page.mouse.up();
  expect(await page.locator('.sidePanelSection').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-panel-id')))).toEqual(['inspector','library']);
  const dock=await library.boundingBox();await page.mouse.move(dock!.x+30,dock!.y+15);await page.mouse.down();await page.mouse.move(1438,dock!.y+15,{steps:8});await expect(page.locator('.sidePanelStack.is-drop-right')).toHaveCount(1);await page.mouse.up();await expect(page.locator('.sidePanelLane')).toHaveCount(2);
  const separator=page.getByRole('separator',{name:'Library and Inspector columns',exact:true});await separator.focus();const width=await page.locator('[data-panel-id=library]').boundingBox();await page.keyboard.press('ArrowLeft');expect((await page.locator('[data-panel-id=library]').boundingBox())!.width).toBeGreaterThan(width!.width);
  const before=await page.evaluate(()=>localStorage.getItem('sparko:panel-layout'));const handle=await separator.boundingBox();await page.mouse.move(handle!.x+4,handle!.y+40);await page.mouse.down();await page.mouse.move(handle!.x+70,handle!.y+40,{steps:6});await page.keyboard.press('Escape');await page.mouse.up();expect(await page.evaluate(()=>localStorage.getItem('sparko:panel-layout'))).toBe(before);
  const h=await library.boundingBox();await page.mouse.move(h!.x+30,h!.y+15);await page.mouse.down();await page.mouse.move(h!.x-120,h!.y+15,{steps:6});await page.keyboard.press('Escape');await page.mouse.up();expect(await page.evaluate(()=>localStorage.getItem('sparko:panel-layout'))).toBe(before);
  await page.reload();await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.sidePanelLane')).toHaveCount(2);
  await page.screenshot({path:'test-results/library-panels-docked.png',fullPage:true});
  await page.locator('.panel-workspace-menu summary').click();await page.getByRole('button',{name:'Reset workspace',exact:true}).click();await expect(page.locator('.sidePanelLane')).toHaveCount(1);
  const player=await page.locator('.video-stage').boundingBox(),timeline=await page.locator('.story-canvas').boundingBox();expect(player!.y+player!.height).toBeLessThanOrEqual(timeline!.y);
  await page.screenshot({path:'test-results/library-panels-default.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Collapse Library panel',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect.poll(async()=>(await page.locator('.sidebar').boundingBox())!.height).toBeGreaterThanOrEqual(700);
  await page.locator('.sidebar').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/library-panels-mobile.png',fullPage:true});expect(errors).toEqual([]);
});
