import {test,expect,type Page} from './fixtures';
import type {Locator} from '@playwright/test';

const open=async(page:Page)=>{await page.goto('/');await page.getByLabel('Choose video file',{exact:true}).setInputFiles('tests/fixtures/interstitial-reference.mp4');await expect(page.locator('.story-clip')).toHaveCount(1);};
const saved=(page:Page)=>page.evaluate(async()=>{const {readActiveProject}=await import('/src/features/project/database.ts' as string);return readActiveProject();});
const camera=(page:Page)=>page.locator('.story-scroll').evaluate(el=>{const style=(el as HTMLElement).style;return {x:parseFloat(style.backgroundPositionX),y:parseFloat(style.backgroundPositionY),zoom:parseInt(document.querySelector('.story-zoom')!.textContent!)/100};});
const begin=async(page:Page,source:Locator,x:number,y:number)=>{
  await source.scrollIntoViewIfNeeded();const rect=(await source.boundingBox())!;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width/2+10,rect.y+rect.height/2+10,{steps:3});
  await page.mouse.move(x,y,{steps:8});await page.mouse.move(x,y);
};
const at=async(clip:Locator,x:number,y:number)=>{await expect.poll(async()=>{const r=(await clip.boundingBox())!;return Math.abs(r.x-x)+Math.abs(r.y-y);}).toBeLessThan(2);};

test('toolbar dragging previews the exact zoomed position, preserves the view, and cancels cleanly',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  const canvas=page.locator('.story-scroll'),source=page.locator('.story-clip.type-source');
  await page.getByRole('button',{name:'Zoom out story',exact:true}).click();await canvas.hover();await page.mouse.wheel(-380,-110);
  const initial=await saved(page),view=await camera(page),sourceRect=await source.boundingBox(),toolbar=await page.locator('.story-toolbar').boundingBox();
  await page.locator('.story-menu summary').filter({hasText:'Interstitial'}).click();const simple=page.getByRole('button',{name:/Simple Play once/});
  await simple.click();await expect(page.locator('.story-clip')).toHaveCount(1);await expect(page.locator('.story-status')).toContainText('Drag an interstitial');
  const bounds=(await canvas.boundingBox())!,x=bounds.x+100,y=bounds.y+45;
  await begin(page,simple,x,y);const ghost=page.locator('.story-drop-preview');await expect(ghost).toHaveCount(1);await at(ghost,x,y);
  expect((await ghost.boundingBox())!.height).toBe(76);expect(await page.locator('.story-toolbar').boundingBox()).toEqual(toolbar);
  await page.screenshot({path:'test-results/drag-placement-preview.png',fullPage:true});await page.mouse.up();
  const clip=page.locator('.story-clip.type-simple');await expect(clip).toHaveCount(1);await at(clip,x,y);await expect(ghost).toHaveCount(0);
  expect(await source.boundingBox()).toEqual(sourceRect);expect(await camera(page)).toEqual(view);
  const project=await saved(page);expect(project.storyFlow.nodes[0]).toEqual(initial.storyFlow.nodes[0]);expect(project.storyFlow.nodes[1].x).toBeLessThan(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(clip).toHaveCount(0);
  await page.locator('.story-menu summary').filter({hasText:'Templates'}).click();
  await begin(page,page.locator('.story-menu-popover').getByRole('button',{name:/Question & response/}),x,y);
  await expect(ghost).toHaveCount(4);await page.keyboard.press('Escape');await page.mouse.up();await expect(ghost).toHaveCount(0);
  expect((await saved(page)).storyFlow).toEqual(initial.storyFlow);expect(await camera(page)).toEqual(view);
  expect(errors).toEqual([]);
});

test('wire drops attach at the pointer and template drops preserve existing positions and routing',async({page})=>{
  await open(page);const film=page.locator('.story-filmstrip').first();await film.focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');
  await page.getByRole('button',{name:'Fit all',exact:true}).click();const initial=await saved(page),view=await camera(page);
  const wire=page.locator('.story-crossfade').first(),rect=(await wire.boundingBox())!,x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await begin(page,page.getByRole('button',{name:'Add looped interstitial',exact:true}),x,y);await expect(page.locator('.story-status')).toContainText('insert into this connection');
  await at(page.locator('.story-drop-preview'),x,y);await page.mouse.up();const loop=page.locator('.story-clip.type-looped');await expect(loop).toHaveCount(1);await at(loop,x,y);
  let project=await saved(page);expect(project.storyFlow.nodes.slice(0,2)).toEqual(initial.storyFlow.nodes);expect(await camera(page)).toEqual(view);
  const added=project.storyFlow.nodes.at(-1);expect(project.storyFlow.edges.map((e:any)=>[e.from,e.to])).toEqual([[initial.storyFlow.edges[0].from,added.id],[added.id,initial.storyFlow.edges[0].to]]);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(loop).toHaveCount(0);
  const canvas=page.locator('.story-scroll'),bounds=(await canvas.boundingBox())!;
  await begin(page,page.getByRole('button',{name:'Add template Question & response',exact:true}),bounds.x+30,bounds.y+25);
  const ghostRects=await page.locator('.story-drop-preview').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  expect(ghostRects).toHaveLength(4);await page.mouse.up();await expect(page.locator('.story-clip')).toHaveCount(6);
  const clipRects=await page.locator('.story-clip:not(.type-source)').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  expect(clipRects).toEqual(ghostRects);project=await saved(page);expect(project.storyFlow.nodes.slice(0,2)).toEqual(initial.storyFlow.nodes);expect(project.storyFlow.edges[0]).toEqual(initial.storyFlow.edges[0]);expect(await camera(page)).toEqual(view);
});

test('narrow toolbar drops and saved templates use the same drag placement',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);const canvas=page.locator('.story-scroll'),toolbar=await page.locator('.story-toolbar').boundingBox();
  await page.locator('.story-menu summary').filter({hasText:'Interstitial'}).click();
  const bounds=(await canvas.boundingBox())!;await begin(page,page.getByRole('button',{name:/Simple Play once/}),bounds.x+200,bounds.y+30);await page.mouse.up();await expect(page.locator('.story-clip')).toHaveCount(2);
  await at(page.locator('.story-clip.type-simple'),bounds.x+200,bounds.y+30);
  expect(await page.locator('.story-toolbar').boundingBox()).toEqual(toolbar);
  await page.locator('.story-menu summary').filter({hasText:'Templates'}).click();await page.getByRole('button',{name:'Save selected clips as template'}).click();await page.getByLabel('Template name',{exact:true}).fill('Saved scene');await page.getByRole('button',{name:'Save template',exact:true}).click();
  await page.locator('.story-menu summary').filter({hasText:'Templates'}).click();const savedTemplate=page.locator('.story-template-row').getByRole('button',{name:'Saved scene',exact:true});
  await savedTemplate.click();await expect(page.locator('.story-clip')).toHaveCount(2);
  await begin(page,savedTemplate,bounds.x+20,bounds.y+190);
  await at(page.locator('.story-drop-preview'),bounds.x+20,bounds.y+190);const beforeDropToolbar=await page.locator('.story-toolbar').boundingBox();
  await page.mouse.up();await expect(page.locator('.story-clip')).toHaveCount(3);
  await at(page.locator('.story-clip.type-simple').last(),bounds.x+20,bounds.y+190);
  expect(await page.locator('.story-toolbar').boundingBox()).toEqual(beforeDropToolbar);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/drag-placement-mobile.png',fullPage:true});
});
