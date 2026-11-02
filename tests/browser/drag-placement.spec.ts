import { saveSelectionAsTemplate, fitAll,test,expect,type Page} from './fixtures';
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

test('library dragging previews the exact zoomed position, preserves the view, and cancels cleanly',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  const canvas=page.locator('.story-scroll'),source=page.locator('.story-clip.type-source');
  await page.getByRole('button',{name:'Zoom out story',exact:true}).click();await canvas.hover();await page.mouse.wheel(-380,-110);
  const initial=await saved(page),view=await camera(page),sourceRect=await source.boundingBox(),toolbar=await page.locator('.story-toolbar').boundingBox();
  const simple=page.getByRole('button',{name:'Add interstitial',exact:true});
  await simple.click();await expect(page.locator('.story-clip')).toHaveCount(1);await expect(page.locator('.story-status')).toContainText('Drag an interstitial');
  const bounds=(await canvas.boundingBox())!,x=bounds.x+100,y=bounds.y+45;
  await begin(page,simple,x,y);const ghost=page.locator('.story-drop-preview');await expect(ghost).toHaveCount(1);await at(ghost,x,y);
  expect((await ghost.boundingBox())!.height).toBe(76);expect(await page.locator('.story-toolbar').boundingBox()).toEqual(toolbar);
  await page.screenshot({path:'test-results/drag-placement-preview.png',fullPage:true});await page.mouse.up();
  const clip=page.locator('.story-clip.type-simple');await expect(clip).toHaveCount(1);await at(clip,x,y);await expect(ghost).toHaveCount(0);
  expect(await source.boundingBox()).toEqual(sourceRect);expect(await camera(page)).toEqual(view);
  const project=await saved(page);expect(project.storyFlow.nodes[0]).toEqual(initial.storyFlow.nodes[0]);expect(project.storyFlow.nodes[1].x).toBeLessThan(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(clip).toHaveCount(0);
  await begin(page,page.getByRole('button',{name:'Add template Question & response',exact:true}),x,y);
  await expect(ghost).toHaveCount(4);await expect(page.locator('.story-group-preview')).toContainText('Question & response');await page.keyboard.press('Escape');await page.mouse.up();await expect(ghost).toHaveCount(0);await expect(page.locator('.story-group-preview')).toHaveCount(0);
  expect((await saved(page)).storyFlow).toEqual(initial.storyFlow);expect(await camera(page)).toEqual(view);
  expect(errors).toEqual([]);
});

test('wire drops attach at the pointer and template drops preserve existing positions and routing',async({page})=>{
  await open(page);const film=page.locator('.story-filmstrip').first();await film.focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');
  await fitAll(page);const initial=await saved(page),view=await camera(page);
  const wire=page.locator('.story-crossfade').first(),rect=(await wire.boundingBox())!,x=rect.x+rect.width/2,y=rect.y-8;
  await begin(page,page.getByRole('button',{name:'Add interstitial',exact:true}),x,y);await expect(page.locator('.story-status')).toContainText('replace transition and connect both sides');
  await expect(page.locator('.story-edge.drop-target')).toHaveAttribute('data-edge-id',initial.storyFlow.edges[0].id);
  await expect(page.locator('.story-transition-drop-label')).toHaveText('Replace transition');
  await at(page.locator('.story-drop-preview'),x,y);await page.mouse.up();const loop=page.locator('.story-clip.type-simple');await expect(loop).toHaveCount(1);await at(loop,x,y);
  let project=await saved(page);expect(project.storyFlow.nodes.slice(0,2)).toEqual(initial.storyFlow.nodes);expect(await camera(page)).toEqual(view);
  const added=project.storyFlow.nodes.at(-1);expect(project.storyFlow.edges.map((e:any)=>[e.from,e.to])).toEqual([[initial.storyFlow.edges[0].from,added.id],[added.id,initial.storyFlow.edges[0].to]]);
  expect(added.referenceId).toBe(initial.storyFlow.edges[0].from);
  await expect(page.locator('.story-edge.drop-target,.story-transition-drop-label')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(loop).toHaveCount(0);
  const canvas=page.locator('.story-scroll'),bounds=(await canvas.boundingBox())!;
  await begin(page,page.getByRole('button',{name:'Add template Question & response',exact:true}),bounds.x+30,bounds.y+25);
  const ghostRects=await page.locator('.story-drop-preview').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  expect(ghostRects).toHaveLength(4);const groupRect=await page.locator('.story-group-preview').boundingBox();await page.mouse.up();await expect(page.locator('.story-clip')).toHaveCount(6);
  const clipRects=await page.locator('.story-clip:not(.type-source)').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  expect(clipRects).toEqual(ghostRects);expect(await page.locator('.story-group').boundingBox()).toEqual(groupRect);await expect(page.locator('.story-group-preview')).toHaveCount(0);project=await saved(page);expect(project.storyFlow.nodes.slice(0,2)).toEqual(initial.storyFlow.nodes);expect(project.storyFlow.edges[0]).toEqual(initial.storyFlow.edges[0]);expect(await camera(page)).toEqual(view);
});

for(const width of [1440,390])test(`template drops replace a highlighted transition and reconnect every branch at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1000});await open(page);
  await page.locator('.story-filmstrip').focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');await fitAll(page);
  const initial=await saved(page),connection=initial.storyFlow.edges[0],view=await camera(page);
  const canvas=page.locator('.story-scroll'),bounds=(await canvas.boundingBox())!,toolbar=await page.locator('.story-toolbar').boundingBox(),status=await page.locator('.story-status').boundingBox();
  const rect=(await page.locator('.story-crossfade').first().boundingBox())!,x=rect.x+rect.width/2,y=rect.y+rect.height+8;
  await begin(page,page.getByRole('button',{name:'Add template Question & response',exact:true}),x,y);
  await expect(page.locator('.story-edge.drop-target')).toHaveAttribute('data-edge-id',connection.id);
  await expect(page.locator('.story-transition-drop-label')).toBeVisible();
  expect((await saved(page)).storyFlow).toEqual(initial.storyFlow);
  expect(await canvas.boundingBox()).toEqual(bounds);expect(await page.locator('.story-toolbar').boundingBox()).toEqual(toolbar);expect(await page.locator('.story-status').boundingBox()).toEqual(status);
  await page.screenshot({path:`test-results/transition-drop-${width}.png`,fullPage:true});
  await page.mouse.move(bounds.x+8,bounds.y+bounds.height-8,{steps:5});await page.mouse.move(bounds.x+8,bounds.y+bounds.height-8);
  await expect(page.locator('.story-edge.drop-target,.story-transition-drop-label')).toHaveCount(0);
  await page.mouse.move(x,y,{steps:5});await page.mouse.move(x,y);await expect(page.locator('.story-edge.drop-target')).toHaveCount(1);
  await page.mouse.up();await expect(page.locator('.story-clip')).toHaveCount(6);
  await expect(page.locator('.story-edge.drop-target,.story-transition-drop-label,.story-drop-preview')).toHaveCount(0);
  const graph=(await saved(page)).storyFlow,added=graph.nodes.slice(2),entry=added.find((n:any)=>n.name==='Ask a question');
  expect(graph.nodes.slice(0,2)).toEqual(initial.storyFlow.nodes);expect(await camera(page)).toEqual(view);
  expect(graph.edges.some((e:any)=>e.id===connection.id||e.from===connection.from&&e.to===connection.to)).toBe(false);
  expect(graph.edges.find((e:any)=>e.from===connection.from)).toMatchObject({to:entry.id,event:connection.event,label:connection.label,crossfade:connection.crossfade});
  expect(entry.referenceId).toBe(connection.from);
  const exits=graph.edges.filter((e:any)=>e.to===connection.to);
  expect(exits).toHaveLength(2);expect(exits.map((e:any)=>added.find((n:any)=>n.id===e.from).name).sort()).toEqual(['Celebrate','Encourage']);
  expect(await canvas.boundingBox()).toEqual(bounds);expect(await page.locator('.story-status').boundingBox()).toEqual(status);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(2);expect((await saved(page)).storyFlow).toEqual(initial.storyFlow);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('.story-clip')).toHaveCount(6);expect((await saved(page)).storyFlow).toEqual(graph);
});

test('cancelled transition replacements and media drops leave the original connection intact',async({page})=>{
  await open(page);await page.locator('.story-filmstrip').focus();await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('s');await fitAll(page);
  const initial=await saved(page),rect=(await page.locator('.story-crossfade').first().boundingBox())!,x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await begin(page,page.getByRole('button',{name:'Add interstitial',exact:true}),x,y);await expect(page.locator('.story-edge.drop-target')).toHaveCount(1);
  await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.story-edge.drop-target,.story-transition-drop-label,.story-drop-preview')).toHaveCount(0);
  expect((await saved(page)).storyFlow).toEqual(initial.storyFlow);
  await begin(page,page.locator('.library-media button').first(),x,y);await expect(page.locator('.story-status')).toContainText('add a separate clip');
  await expect(page.locator('.story-edge.drop-target,.story-transition-drop-label')).toHaveCount(0);
  await page.mouse.up();await expect(page.locator('.story-clip')).toHaveCount(3);expect((await saved(page)).storyFlow.edges).toEqual(initial.storyFlow.edges);
});

test('narrow library drops and saved templates use the same drag placement',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);const canvas=page.locator('.story-scroll'),toolbar=await page.locator('.story-toolbar').boundingBox();
  const bounds=(await canvas.boundingBox())!;await begin(page,page.getByRole('button',{name:'Add interstitial',exact:true}),bounds.x+200,bounds.y+30);await page.mouse.up();await expect(page.locator('.story-clip')).toHaveCount(2);
  await at(page.locator('.story-clip.type-simple'),bounds.x+200,bounds.y+30);
  expect(await page.locator('.story-toolbar').boundingBox()).toEqual(toolbar);
  await saveSelectionAsTemplate(page);await page.getByLabel('Template name',{exact:true}).fill('Saved scene');await page.getByRole('button',{name:'Save template',exact:true}).click();
  const savedTemplate=page.getByRole('button',{name:'Add template Saved scene',exact:true});
  await savedTemplate.click();await expect(page.locator('.story-clip')).toHaveCount(2);
  await begin(page,savedTemplate,bounds.x+20,bounds.y+190);
  await at(page.locator('.story-drop-preview'),bounds.x+20,bounds.y+190);const beforeDropToolbar=await page.locator('.story-toolbar').boundingBox();
  await page.mouse.up();await expect(page.locator('.story-clip')).toHaveCount(3);
  await at(page.locator('.story-clip.type-simple').last(),bounds.x+20,bounds.y+190);
  expect(await page.locator('.story-toolbar').boundingBox()).toEqual(beforeDropToolbar);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/drag-placement-mobile.png',fullPage:true});
});
